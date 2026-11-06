import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { forShop } from "../models/preorder.server";
import { releaseFor } from "../models/release.server";
import { cancelLink } from "../release/link.server";
import type { ShopifyGateway } from "./gateway";
import {
  UNRESOLVED_TAG,
  desiredOrderMetafields,
  desiredOrderTags,
  metafieldMatches,
} from "./orderFields";

// Den anden halvdel af synkroniseringen: bringer én ordres metafelter og
// tags i overensstemmelse med dens tildelinger. Samme regler som
// syncVariant: læs først, skriv kun det, der afviger, og lad aldrig en fejl
// gå stille forbi (den kastes videre til køen, som viser den i admin).

export async function syncOrder({
  shop,
  orderId,
  gateway,
  client = db,
}: {
  shop: string;
  orderId: string;
  gateway: ShopifyGateway;
  client?: PrismaClient;
}): Promise<void> {
  const rows = await forShop(shop, client).orders.allocationsForOrder(orderId);
  // Ingen tildelinger nogensinde: ordren er ikke en forudbestilling.
  if (rows.length === 0) return;

  const order = await gateway.readOrder(orderId);
  if (!order) throw new Error("Ordren findes ikke længere i Shopify.");

  // Kundens annulleringslink (preaura.cancel_url), så butikken kan vise det
  // i sine notifikationer og på ordrestatussiden. Kun mens der er
  // reserverede enheder; ellers røres det ikke.
  const wantedFields = desiredOrderMetafields(rows);
  if (rows.some((r) => r.status === "ACTIVE") && !order.snapshot.cancelled) {
    const link = await cancelLinkOrNull(
      shop,
      orderId,
      order.snapshot.createdAt,
      client,
    );
    if (link) {
      await ensureCancelUrlDefinition(shop, gateway);
      wantedFields.push({ key: "cancel_url", type: "url", value: link });
    }
  }
  const fields = wantedFields.filter(
    (field) => !metafieldMatches(field, order.metafields[field.key] ?? null),
  );
  if (fields.length > 0) await gateway.setOrderMetafields(orderId, fields);

  const wanted = desiredOrderTags(rows);
  const missing = wanted.filter((tag) => !order.tags.includes(tag));
  if (missing.length > 0) await gateway.addOrderTags(orderId, missing);

  if (!wanted.includes(UNRESOLVED_TAG) && order.tags.includes(UNRESOLVED_TAG)) {
    await gateway.removeOrderTags(orderId, [UNRESOLVED_TAG]);
  }
}

/**
 * Linket kræver krypteringsnøglen. Mangler den, springes linket over — det
 * må aldrig forhindre, at datoen og tagget kommer på ordren.
 */
async function cancelLinkOrNull(
  shop: string,
  orderId: string,
  createdAt: string,
  client: PrismaClient,
) {
  try {
    const settings = await releaseFor(shop, client).settings();
    return cancelLink(shop, orderId, new Date(createdAt), settings);
  } catch {
    return null;
  }
}

/** Butikker, hvor definitionen er på plads i denne proces. */
const definedShops = new Set<string>();

/**
 * Uden en definition viser Shopify ikke metafeltet på ordresiden. Oprettes
 * én gang pr. butik pr. proces; en fejl her må ikke stoppe synkroniseringen.
 */
async function ensureCancelUrlDefinition(
  shop: string,
  gateway: ShopifyGateway,
) {
  if (definedShops.has(shop)) return;
  try {
    await gateway.ensureOrderMetafieldDefinition({
      key: "cancel_url",
      type: "url",
      name: "Annulleringslink (PREAURA)",
      description:
        "Kundens link til at annullere forudbestillingen. Brug det i dine notifikationer: {{ order.metafields.preaura.cancel_url }}",
    });
    definedShops.add(shop);
  } catch (error) {
    console.error(
      `Definitionen af preaura.cancel_url for ${shop} fejlede:`,
      error,
    );
  }
}
