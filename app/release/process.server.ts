import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import type { OrderSnapshot } from "../models/preorder.server";
import { releaseFor, type LineTarget } from "../models/release.server";

// Frigivelse af reserverede enheder — ÉN mekanisme med flere udløsere:
//
//   - kunden annullerer (link) og anmodningen er godkendt,
//   - butikken annullerer eller refunderer i Shopify (allerede dækket: den
//     webhook går direkte til afstemningen),
//   - en betaling er afvist og stadig ubetalt, når fristen er udløbet.
//
// Appen frigiver aldrig en enhed i sit eget regnskab alene. Den ændrer
// ordren i Shopify — annullerer den helt eller nedsætter antallet — og
// lader derefter den eksisterende afstemning (orders.apply) bringe
// tildelingerne i overensstemmelse med ordren. Der er altså kun én vej, der
// frigiver, og den følger altid Shopify. Derfor:
//
//   - Præcis én gang: målet er et ANTAL (ikke «træk 2 fra»). Er ordren
//     allerede der, skrives intet; afstemningen er idempotent. Dobbeltklik,
//     gentagne webhooks og et link åbnet to gange giver samme resultat.
//   - Kører under køens lås (processShopQueue), så den aldrig løber om kap
//     med behandlingen af den samme ordre.
//   - Appen udbetaler aldrig penge: Shopify-ordren annulleres/rettes uden
//     refundering. Refundering sker i Shopify efter butikkens eget valg.

export type ReleaseDeps = {
  readOrder(orderId: string): Promise<OrderSnapshot | null>;
  cancelOrder(
    orderId: string,
    reason: "CUSTOMER" | "DECLINED" | "STAFF",
  ): Promise<void>;
  setOrderLineQuantities(orderId: string, targets: LineTarget[]): Promise<void>;
  /** Den eksisterende afstemning for én ordre (orders.apply + synkronisering). */
  reconcile(orderId: string): Promise<void>;
  hasAccess(): Promise<boolean>;
};

/**
 * Bringer ordren i Shopify ned på målene. Linjer, der ikke nævnes, røres
 * ikke. Ender alle ordrens linjer på 0, annulleres hele ordren.
 */
export async function applyTargets(
  order: OrderSnapshot,
  targets: LineTarget[],
  reason: "CUSTOMER" | "DECLINED" | "STAFF",
  deps: Pick<ReleaseDeps, "cancelOrder" | "setOrderLineQuantities">,
) {
  if (order.cancelled) return "already" as const;
  const wanted = new Map(targets.map((t) => [t.lineId, t.quantity]));
  const changes: LineTarget[] = [];
  for (const line of order.lines) {
    const target = wanted.get(line.id);
    if (target == null) continue;
    // Allerede sendte enheder kan ikke annulleres.
    const sent =
      line.unfulfilled != null ? line.quantity - line.unfulfilled : 0;
    const quantity = Math.max(0, sent, Math.min(target, line.quantity));
    if (quantity < line.quantity) changes.push({ lineId: line.id, quantity });
  }
  if (changes.length === 0) return "already" as const;
  const after = order.lines.map((line) => {
    const change = changes.find((c) => c.lineId === line.id);
    return change ? change.quantity : line.quantity;
  });
  if (after.every((q) => q === 0)) {
    await deps.cancelOrder(order.id, reason);
    return "cancelled" as const;
  }
  await deps.setOrderLineQuantities(order.id, changes);
  return "reduced" as const;
}

export async function processReleases({
  shop,
  deps,
  client = db,
  now = () => new Date(),
}: {
  shop: string;
  deps: ReleaseDeps;
  client?: PrismaClient;
  now?: () => Date;
}) {
  const release = releaseFor(shop, client);
  const totals = { cancellations: 0, payments: 0, failed: 0 };
  const [approved, due] = await Promise.all([
    release.cancellations.approved(),
    release.payments.due(now()),
  ]);
  if (approved.length === 0 && due.length === 0) return totals;
  // Uden abonnement venter alt — intet slettes, intet frigives.
  if (!(await deps.hasAccess())) return totals;

  for (const request of approved) {
    try {
      const order = await deps.readOrder(request.orderId);
      if (!order) throw new Error("Ordren findes ikke i Shopify.");
      await applyTargets(
        order,
        request.lines,
        request.source === "STAFF" ? "STAFF" : "CUSTOMER",
        deps,
      );
      await deps.reconcile(request.orderId);
      await release.cancellations.markDone(request.id, now());
      totals.cancellations += 1;
    } catch (error) {
      await release.cancellations.recordFailure(request.id, message(error));
      totals.failed += 1;
    }
  }

  for (const issue of due) {
    try {
      await release.payments.markReleasing(issue.id);
      const order = await deps.readOrder(issue.orderId);
      if (!order) throw new Error("Ordren findes ikke i Shopify.");
      if (order.payment?.paid) {
        // Kunden nåede at betale: intet frigives.
        await release.payments.close(issue.id, "PAID", now());
        await deps.reconcile(issue.orderId);
        continue;
      }
      if (!order.cancelled) {
        await deps.cancelOrder(order.id, "DECLINED");
      }
      await deps.reconcile(issue.orderId);
      await release.payments.markReleased(issue.id, now());
      totals.payments += 1;
    } catch (error) {
      await release.payments.recordFailure(issue.id, message(error));
      totals.failed += 1;
    }
  }
  return totals;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Ukendt fejl.";
}
