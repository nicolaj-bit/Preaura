import type { PrismaClient } from "@prisma/client";
import db from "../db.server";

// Databeskyttelse: kunders dataanmodninger og sletning.
//
// Hvad PREAURA gemmer om en kunde: ingenting, der identificerer kunden. Køen
// gemmer kun ordrens id (se app/lib/webhookPayload.ts). Tildelingerne
// gemmer ordrens id og nummer, antal og den lovede dato — ikke navn, mail
// eller adresse. De er butikkens regnskab over pladserne i leverancerne og
// bliver derfor stående ved customers/redact; uden dem ville appen sælge
// pladserne igen. Ved shop/redact slettes alt om butikken.

const ORDER_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "REFUNDS_CREATE",
];

const RETENTION_DAYS = 30;

/** Et Shopify-id som tal eller gid → gid for en ordre. */
export function orderGid(id: unknown) {
  if (typeof id === "string" && id.startsWith("gid://shopify/Order/")) {
    return id;
  }
  if (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id))) {
    return `gid://shopify/Order/${id}`;
  }
  return null;
}

export type StoredOrderData = {
  orderId: string;
  orderName: string;
  lines: {
    quantity: number;
    status: string;
    promisedDate: string | null;
    orderedAt: string | null;
  }[];
};

export function complianceFor(shop: string, client: PrismaClient = db) {
  if (!shop) throw new Error("complianceFor kræver en butik.");

  /** Ordre-id'er, en kø-hændelse handler om. */
  function eventOrderId(payload: string) {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      return (
        orderGid(parsed.admin_graphql_api_id) ??
        orderGid(parsed.id) ??
        orderGid(parsed.order_id)
      );
    } catch {
      return null;
    }
  }

  return {
    /** Det, PREAURA gemmer om ordrerne — til en kundes dataanmodning. */
    async storedForOrders(orderIds: string[]): Promise<StoredOrderData[]> {
      if (orderIds.length === 0) return [];
      const rows = await client.allocation.findMany({
        where: { shop, orderId: { in: orderIds } },
        orderBy: [{ orderId: "asc" }, { allocatedAt: "asc" }],
      });
      const byOrder = new Map<string, StoredOrderData>();
      for (const row of rows) {
        const order = byOrder.get(row.orderId) ?? {
          orderId: row.orderId,
          orderName: row.orderName,
          lines: [],
        };
        order.lines.push({
          quantity: row.quantity,
          status: row.status,
          promisedDate: row.promisedDate,
          orderedAt: row.orderCreatedAt?.toISOString() ?? null,
        });
        byOrder.set(row.orderId, order);
      }
      return [...byOrder.values()];
    },

    async recordDataRequest(input: {
      customerId: string;
      shopifyRequestId: string | null;
      orderIds: string[];
      data: StoredOrderData[];
    }) {
      return client.dataRequest.create({
        data: {
          shop,
          customerId: input.customerId,
          shopifyRequestId: input.shopifyRequestId,
          orderIds: JSON.stringify(input.orderIds),
          data: JSON.stringify(input.data),
        },
      });
    },

    async dataRequests() {
      const rows = await client.dataRequest.findMany({
        where: { shop },
        orderBy: { receivedAt: "desc" },
      });
      return rows.map((row) => ({
        ...row,
        orderIds: JSON.parse(row.orderIds) as string[],
        data: JSON.parse(row.data) as StoredOrderData[],
      }));
    },

    async countUnansweredDataRequests() {
      return client.dataRequest.count({ where: { shop, answeredAt: null } });
    },

    async markAnswered(id: string) {
      const result = await client.dataRequest.updateMany({
        where: { shop, id, answeredAt: null },
        data: { answeredAt: new Date() },
      });
      return result.count;
    },

    /**
     * customers/redact: kundens dataanmodninger og de behandlede
     * kø-hændelser for kundens ordrer slettes. Tildelingerne bliver stående
     * (se øverst i filen).
     */
    async redactCustomer(input: { customerId: string; orderIds: string[] }) {
      const orders = new Set(input.orderIds);
      const events = await client.webhookEvent.findMany({
        where: {
          shop,
          topic: { in: ORDER_TOPICS },
          status: { not: "PENDING" },
        },
        select: { id: true, payload: true },
      });
      const eventIds = events
        .filter((event) => {
          const orderId = eventOrderId(event.payload);
          return orderId != null && orders.has(orderId);
        })
        .map((event) => event.id);

      const [requests, removed] = await client.$transaction([
        client.dataRequest.deleteMany({
          where: { shop, customerId: input.customerId },
        }),
        client.webhookEvent.deleteMany({
          where: { shop, id: { in: eventIds } },
        }),
      ]);
      return { dataRequests: requests.count, events: removed.count };
    },

    /**
     * shop/redact: alt om butikken slettes. Kommer 48 timer efter, appen er
     * afinstalleret. Det er den eneste gang, tildelinger slettes.
     */
    async redactShop() {
      const where = { where: { shop } };
      // Tildelinger før leverancer (fremmednøglen forbyder det omvendte).
      await client.$transaction([
        client.allocation.deleteMany(where),
        client.delivery.deleteMany(where),
        client.sellingPlanRef.deleteMany(where),
        client.modeChange.deleteMany(where),
        client.variantPlan.deleteMany(where),
        client.shopSetting.deleteMany(where),
        client.dataRequest.deleteMany(where),
        client.session.deleteMany(where),
        client.webhookEvent.deleteMany(where),
        client.queueLock.deleteMany(where),
      ]);
    },
  };
}

/**
 * Sletter behandlede kø-hændelser og besvarede dataanmodninger, der er
 * ældre end 30 dage, for alle butikker. Fejlede hændelser bliver stående,
 * til de er behandlet.
 */
export async function purgeOldData(
  client: PrismaClient = db,
  now = new Date(),
) {
  const before = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [events, requests] = await client.$transaction([
    client.webhookEvent.deleteMany({
      where: {
        status: { in: ["DONE", "SKIPPED"] },
        processedAt: { lt: before },
      },
    }),
    client.dataRequest.deleteMany({ where: { answeredAt: { lt: before } } }),
  ]);
  return { events: events.count, dataRequests: requests.count };
}
