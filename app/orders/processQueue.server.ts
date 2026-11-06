import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { forShop, type OrderSnapshot } from "../models/preorder.server";
import { EVENT_STATUS, queueFor } from "../models/queue.server";
import { complianceFor, orderGid } from "../models/compliance.server";
import { releaseFor, type LineTarget } from "../models/release.server";
import { processReleases } from "../release/process.server";

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
// - Compliance-hændelser (GDPR) behandles først og kræver ikke adgang til
//   Shopify — de kommer ofte, efter appen er afinstalleret.

const ORDER_TOPICS = new Set([
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "REFUNDS_CREATE",
  // Betalingsforsøg (også afviste opkrævninger ved afsendelse).
  "ORDER_TRANSACTIONS_CREATE",
]);

const INVENTORY_TOPIC = "INVENTORY_LEVELS_UPDATE";

export const COMPLIANCE_TOPICS = [
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
];

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
  /**
   * Frigivelse (annullering og afvist betaling). Uden disse udføres ingen
   * frigivelser i denne kørsel — de venter til næste.
   */
  cancelOrder?(
    orderId: string,
    reason: "CUSTOMER" | "DECLINED" | "STAFF",
  ): Promise<void>;
  setOrderLineQuantities?(
    orderId: string,
    targets: LineTarget[],
  ): Promise<void>;
  hasAccess?(): Promise<boolean>;
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
  if (
    event.topic === "REFUNDS_CREATE" ||
    event.topic === "ORDER_TRANSACTIONS_CREATE"
  ) {
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

/**
 * Behandler butikkens kø. Uden deps (appen har ikke adgang til butikken,
 * fx efter afinstallation) behandles kun compliance-hændelserne; resten
 * venter.
 */
export async function processShopQueue({
  shop,
  deps,
  client = db,
}: {
  shop: string;
  deps: QueueDeps | null;
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
      const compliance = await queue.pending(100, COMPLIANCE_TOPICS);
      if (compliance.length > 0) {
        const result = await processCompliance(shop, compliance, client);
        totals.done += result.done;
        totals.failed += result.failed;
        if (result.shopRedacted) return { ran: true, ...totals };
        continue;
      }
      if (!deps) break;

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
          await processOrder(orderId, data, deps, shop, client);
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

    // Frigivelser (godkendte annulleringer, afviste betalinger efter
    // fristen) — under samme lås som ordrerne, så de aldrig løber om kap.
    if (deps?.cancelOrder && deps.setOrderLineQuantities && deps.hasAccess) {
      await queue.renewLock(holder);
      const d = deps;
      await processReleases({
        shop,
        client,
        deps: {
          readOrder: d.readOrder,
          cancelOrder: d.cancelOrder!,
          setOrderLineQuantities: d.setOrderLineQuantities!,
          hasAccess: d.hasAccess!,
          reconcile: (orderId) => processOrder(orderId, data, d, shop, client),
        },
      });
    }
  } finally {
    await queue.releaseLock(holder);
  }
  return { ran: true, ...totals };
}

async function processCompliance(
  shop: string,
  events: Event[],
  client: PrismaClient,
) {
  const queue = queueFor(shop, client);
  const compliance = complianceFor(shop, client);
  const result = { done: 0, failed: 0, shopRedacted: false };

  // shop/redact sletter alt om butikken — også resten af køen.
  if (events.some((e) => e.topic === "SHOP_REDACT")) {
    await compliance.redactShop();
    result.done += events.length;
    result.shopRedacted = true;
    return result;
  }

  for (const event of events) {
    try {
      const payload = JSON.parse(event.payload) as {
        customer?: { id?: unknown; email_hash?: unknown };
        orders_requested?: unknown[];
        orders_to_redact?: unknown[];
        data_request?: { id?: unknown };
      };
      const customerId =
        payload.customer?.id != null ? String(payload.customer.id) : null;
      if (!customerId) throw new Error("Hændelsen indeholder ingen kunde.");
      const emailHash =
        typeof payload.customer?.email_hash === "string" &&
        payload.customer.email_hash
          ? payload.customer.email_hash
          : null;
      const orderIds = (
        (event.topic === "CUSTOMERS_REDACT"
          ? payload.orders_to_redact
          : payload.orders_requested) ?? []
      )
        .map(orderGid)
        .filter((id): id is string => id != null);

      if (event.topic === "CUSTOMERS_DATA_REQUEST") {
        await compliance.recordDataRequest({
          customerId,
          shopifyRequestId:
            payload.data_request?.id != null
              ? String(payload.data_request.id)
              : null,
          orderIds,
          data: await compliance.storedForOrders(orderIds),
          waitlist: await compliance.waitlistForEmailHash(emailHash),
        });
      } else {
        await compliance.redactCustomer({ customerId, orderIds, emailHash });
      }
      await queue.markDone([event.id]);
      result.done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ukendt fejl.";
      await queue.markFailed([event.id], message);
      result.failed += 1;
    }
  }
  return result;
}

async function processOrder(
  orderId: string,
  data: ReturnType<typeof forShop>,
  deps: QueueDeps,
  shop: string,
  client: PrismaClient,
) {
  const order = await deps.readOrder(orderId);
  if (!order) throw new Error("Ordren findes ikke i Shopify.");

  const { variantIds } = await data.orders.apply(order);
  // Afvist betaling ved afsendelse: opret, luk eller lad sagen være.
  await releaseFor(shop, client).payments.observe(order);

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
