import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { forShop, type OrderSnapshot } from "../models/preorder.server";
import { EVENT_STATUS, queueFor } from "../models/queue.server";

// Behandling af ordre-hændelser i køen → tildelinger.
//
// - Hver hændelse peger på én ordre. Ordren læses frisk fra Shopify, og
//   tildelingerne bringes i overensstemmelse med den. Derfor er det ligegyldigt,
//   om en webhook kommer to gange, eller om "updated" kommer før "create".
// - Ordrer behandles i den rækkefølge, kunderne bestilte (ordrens
//   oprettelsestidspunkt), ikke i den rækkefølge webhooks kom frem.
// - Kun én behandler arbejder på en butik ad gangen (en lås i databasen), så
//   to ordrer aldrig læser det samme resterende antal samtidig.
// - Appen skriver kun til Shopify gennem synkroniseringen (syncVariant og
//   syncOrder), som behandleren får udefra.
// - En hændelse, der fejler, markeres FAILED med fejlbeskeden og vises i admin.

const ORDER_TOPICS = new Set([
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "REFUNDS_CREATE",
]);

const INVENTORY_TOPIC = "INVENTORY_LEVELS_UPDATE";

/** Lagervarens id ud fra en inventory_levels/update-hændelse. */
function inventoryItemRef(event: Event) {
  try {
    const payload = JSON.parse(event.payload) as {
      inventory_item_id?: unknown;
    };
    return payload.inventory_item_id != null
      ? `gid://shopify/InventoryItem/${payload.inventory_item_id}`
      : null;
  } catch {
    return null;
  }
}

export type QueueDeps = {
  readOrder(orderId: string): Promise<OrderSnapshot | null>;
  /** Synkroniserer en variants lager og selling plans. Fejl gemmes på varianten. */
  syncVariant(variantId: string): Promise<unknown>;
  /** Synkroniserer ordrens metafelter og tags. Kaster ved fejl. */
  syncOrder(orderId: string): Promise<void>;
};

type Event = { id: string; topic: string; payload: string; receivedAt: Date };

/** Ordrens id og bestillingstidspunkt ud fra webhookens indhold. */
export function orderRef(event: Event) {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return null;
  }
  if (event.topic === "REFUNDS_CREATE") {
    if (payload.order_id == null) return null;
    return {
      orderId: `gid://shopify/Order/${payload.order_id}`,
      sortKey: event.receivedAt.getTime(),
    };
  }
  const id =
    typeof payload.admin_graphql_api_id === "string"
      ? payload.admin_graphql_api_id
      : payload.id != null
        ? `gid://shopify/Order/${payload.id}`
        : null;
  if (!id) return null;
  const created = Date.parse(String(payload.created_at ?? ""));
  return {
    orderId: id,
    sortKey: Number.isNaN(created) ? event.receivedAt.getTime() : created,
  };
}

export type QueueRunResult =
  { ran: false } | { ran: true; done: number; failed: number; skipped: number };

export async function processShopQueue({
  shop,
  deps,
  client = db,
}: {
  shop: string;
  deps: QueueDeps;
  client?: PrismaClient;
}): Promise<QueueRunResult> {
  const queue = queueFor(shop, client);
  const data = forShop(shop, client);
  const holder = randomUUID();

  if (!(await queue.acquireLock(holder))) return { ran: false };

  const totals = { done: 0, failed: 0, skipped: 0 };
  try {
    // Fortsæt, så længe der kommer nye hændelser ind.
    for (let round = 0; round < 50; round++) {
      const events = await queue.pending();
      if (events.length === 0) break;

      const inventory = events.filter((e) => e.topic === INVENTORY_TOPIC);
      const other = events.filter(
        (e) => !ORDER_TOPICS.has(e.topic) && e.topic !== INVENTORY_TOPIC,
      );
      if (other.length > 0) {
        await queue.markSkipped(
          other.map((e) => e.id),
          "Emnet behandles ikke af appen endnu.",
        );
        totals.skipped += other.length;
      }

      // Saml hændelserne pr. ordre, og tag ordrerne i bestillingsrækkefølge.
      const byOrder = new Map<string, { sortKey: number; ids: string[] }>();
      const unreadable: string[] = [];
      for (const event of events.filter((e) => ORDER_TOPICS.has(e.topic))) {
        const ref = orderRef(event);
        if (!ref) {
          unreadable.push(event.id);
          continue;
        }
        const group = byOrder.get(ref.orderId) ?? {
          sortKey: ref.sortKey,
          ids: [],
        };
        group.sortKey = Math.min(group.sortKey, ref.sortKey);
        group.ids.push(event.id);
        byOrder.set(ref.orderId, group);
      }
      if (unreadable.length > 0) {
        await queue.markFailed(unreadable, "Hændelsen indeholder ingen ordre.");
        totals.failed += unreadable.length;
      }

      const ordered = [...byOrder.entries()].sort(
        (a, b) => a[1].sortKey - b[1].sortKey,
      );
      for (const [orderId, group] of ordered) {
        await queue.renewLock(holder);
        try {
          await processOrder(orderId, data, deps);
          await queue.markDone(group.ids);
          totals.done += group.ids.length;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Ukendt fejl.";
          await queue.markFailed(group.ids, message);
          totals.failed += group.ids.length;
        }
      }

      // Lagerændringer EFTER ordrerne i samme omgang: så er salg allerede
      // talt med, før appen vurderer, om varianten skal skifte tilstand. Et
      // køb i selve skiftesekundet kan dermed ikke tælle to gange.
      const byVariant = new Map<string, string[]>();
      const notOurs: string[] = [];
      for (const event of inventory) {
        const itemId = inventoryItemRef(event);
        const plan = itemId
          ? await data.variantPlans.findByInventoryItem(itemId)
          : null;
        if (!plan || !plan.preorderEnabled) {
          notOurs.push(event.id);
          continue;
        }
        byVariant.set(plan.variantId, [
          ...(byVariant.get(plan.variantId) ?? []),
          event.id,
        ]);
      }
      if (notOurs.length > 0) {
        // Varer, appen ikke styrer: intet at gøre.
        await queue.markDone(notOurs);
        totals.done += notOurs.length;
      }
      for (const [variantId, ids] of byVariant) {
        await queue.renewLock(holder);
        try {
          // Fejl i synkroniseringen gemmes på varianten og vises i admin.
          await deps.syncVariant(variantId);
          await queue.markDone(ids);
          totals.done += ids.length;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Ukendt fejl.";
          await queue.markFailed(ids, message);
          totals.failed += ids.length;
        }
      }
    }
  } finally {
    await queue.releaseLock(holder);
  }
  return { ran: true, ...totals };
}

async function processOrder(
  orderId: string,
  data: ReturnType<typeof forShop>,
  deps: QueueDeps,
) {
  const order = await deps.readOrder(orderId);
  if (!order) throw new Error("Ordren findes ikke i Shopify.");

  const { variantIds } = await data.orders.apply(order);

  // Shopifys lager skal igen svare til det resterende. Fejler det, står
  // fejlen på varianten i admin; tildelingen er gemt uanset.
  for (const variantId of variantIds) {
    await deps.syncVariant(variantId);
  }
  try {
    await deps.syncOrder(orderId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    throw new Error(
      `Ordren er tildelt, men leveringsdato og tag kunne ikke skrives på ordren i Shopify: ${message}`,
    );
  }
}

export { EVENT_STATUS };
