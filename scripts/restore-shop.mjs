#!/usr/bin/env node
// Gendanner ÉN butiks data fra en sikkerhedskopi, uden at røre de andre
// butikker. Se docs/backup.md for hele fremgangsmåden.
//
// Kilden er en database, Render har gendannet fra sin point-in-time recovery
// (en ny, separat instans). Målet er den kørende database. Alt sker i én
// transaktion: lykkes noget ikke, er målet uændret.
//
//   SOURCE_DATABASE_URL=... DATABASE_URL=... \
//     node scripts/restore-shop.mjs --shop butik.myshopify.com \
//       --since 2026-11-17T08:00:00Z [--apply]
//
// Uden --apply vises kun, hvad der ville ske.
//
// Det, der gendannes, er appens egne data om butikken: indstillinger,
// varianter, leverancer, tildelinger, selling plan-referencer, skift mellem
// lager og forudbestilling, integrationer, udgående hændelser, ventelisten,
// annulleringer og afviste betalinger.
//
// Det, der IKKE gendannes, med vilje:
// - Session: butikkens adgang til Shopify. Den nuværende er den gyldige.
// - WebhookEvent: køen. Den nuværende kø er sandheden om, hvad Shopify har
//   sendt; den bruges nedenfor til at genudføre ordrer og sletninger.
// - DataRequest og AccessLog: compliance og revisionsspor rulles aldrig
//   tilbage.
// - Abonnementet: det ligger hos Shopify og læses derfra.
//
// Efter kopieringen sættes to slags hændelser i kø igen:
// - Ordrehændelser modtaget efter --since: de er ikke med i kopien. Køen
//   læser hver ordre frisk fra Shopify og afstemmer (idempotent).
// - Alle kundesletninger (customers/redact) i køen: data, der er slettet
//   efter kopien blev taget, slettes igen. Slettede data vender ikke tilbage.

import { PrismaClient } from "@prisma/client";

/** Tabellerne, der gendannes, i den rækkefølge de kan indsættes. */
export const RESTORED_TABLES = [
  "shopSetting",
  "integrationSetting",
  "variantPlan",
  "modeChange",
  "delivery",
  "sellingPlanRef",
  "allocation",
  "outboxEvent",
  "outboxDelivery",
  "waitlistEntry",
  "waitlistWatch",
  "waitlistStat",
  "cancellationRequest",
  "paymentIssue",
];

const ORDER_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_EDITED",
  "ORDERS_CANCELLED",
  "ORDERS_PAID",
  "ORDER_TRANSACTIONS_CREATE",
  "REFUNDS_CREATE",
  // Lagerændringer i perioden: appen vurderer lager og tilstand igen.
  "INVENTORY_LEVELS_UPDATE",
];

/**
 * @param {{ source: PrismaClient, target: PrismaClient, shop: string,
 *   since: Date, apply?: boolean }} input
 */
export async function restoreShop({ source, target, shop, since, apply }) {
  if (!shop || !shop.endsWith(".myshopify.com")) {
    throw new Error("--shop skal være butikkens myshopify-domæne.");
  }
  if (!(since instanceof Date) || Number.isNaN(since.getTime())) {
    throw new Error("--since skal være tidspunktet, kopien er fra (ISO 8601).");
  }

  // Kun en butik, der har appen installeret nu, gendannes. En afinstalleret
  // butik slettes helt efter 48 timer (shop/redact) og må aldrig komme
  // tilbage fra en kopi.
  const installed = await target.session.count({ where: { shop } });
  const redacting = await target.webhookEvent.count({
    where: { shop, topic: "SHOP_REDACT" },
  });
  if (installed === 0 || redacting > 0) {
    throw new Error(
      `${shop} har ikke appen installeret (eller er ved at blive slettet) og gendannes ikke.`,
    );
  }

  const rows = {};
  for (const table of RESTORED_TABLES) {
    rows[table] = await source[table].findMany({ where: { shop } });
  }
  const summary = Object.fromEntries(
    RESTORED_TABLES.map((t) => [t, rows[t].length]),
  );

  const orderEvents = await target.webhookEvent.count({
    where: { shop, topic: { in: ORDER_TOPICS }, receivedAt: { gte: since } },
  });
  const redactEvents = await target.webhookEvent.count({
    where: { shop, topic: "CUSTOMERS_REDACT" },
  });
  if (!apply) {
    return { applied: false, rows: summary, orderEvents, redactEvents };
  }

  await target.$transaction(
    async (tx) => {
      // Slettes i omvendt rækkefølge (børn før forældre).
      for (const table of [...RESTORED_TABLES].reverse()) {
        await tx[table].deleteMany({ where: { shop } });
      }
      for (const table of RESTORED_TABLES) {
        if (rows[table].length > 0) {
          await tx[table].createMany({ data: rows[table] });
        }
      }
      // Ordrer efter kopien og alle kundesletninger behandles igen.
      await tx.webhookEvent.updateMany({
        where: {
          shop,
          OR: [
            { topic: { in: ORDER_TOPICS }, receivedAt: { gte: since } },
            { topic: "CUSTOMERS_REDACT" },
          ],
        },
        data: { status: "PENDING", attempts: 0, lastError: null },
      });
    },
    { timeout: 120_000 },
  );
  return { applied: true, rows: summary, orderEvents, redactEvents };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl || !targetUrl) {
    throw new Error("Sæt SOURCE_DATABASE_URL (kopien) og DATABASE_URL (målet).");
  }
  if (sourceUrl === targetUrl) {
    throw new Error("Kilde og mål er den samme database.");
  }
  const source = new PrismaClient({ datasourceUrl: sourceUrl });
  const target = new PrismaClient({ datasourceUrl: targetUrl });
  try {
    const result = await restoreShop({
      source,
      target,
      shop: arg("--shop"),
      since: new Date(arg("--since") ?? ""),
      apply: process.argv.includes("--apply"),
    });
    console.info(JSON.stringify(result, null, 2));
    if (!result.applied) {
      console.info("Intet er ændret. Kør igen med --apply for at gendanne.");
    }
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
