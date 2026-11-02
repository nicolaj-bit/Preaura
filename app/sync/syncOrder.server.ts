import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { forShop } from "../models/preorder.server";
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

  const fields = desiredOrderMetafields(rows).filter(
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
