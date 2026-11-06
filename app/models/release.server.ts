import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import type { OrderSnapshot } from "./preorder.server";

// Eneste adgang til CancellationRequest og PaymentIssue og til butikkens
// indstillinger for annullering og afvist betaling. Alt filtreres på butik.
//
// Her frigives INTET. Tabellerne holder styr på, hvad der er bedt om og
// hvornår; selve frigivelsen sker i app/release/process.server.ts gennem
// Shopify og den eksisterende afstemning (orders.apply).

export type CancelWindow = "UNTIL_FULFILLED" | "DAYS";
export type CancelApproval = "MANUAL" | "AUTO";

export type ReleaseSettings = {
  cancelWindow: CancelWindow;
  /** Mindst 1: annullering kan ikke slås fra. */
  cancelDays: number;
  cancelApproval: CancelApproval;
  cancelAutoDays: number;
  paymentGraceDays: number;
};

export const RELEASE_LIMITS = {
  cancelDays: { min: 1, max: 365 },
  cancelAutoDays: { min: 1, max: 365 },
  paymentGraceDays: { min: 1, max: 60 },
} as const;

/**
 * Målet for én ordrelinje: det antal, linjen skal ende på. from: antallet,
 * da der blev bedt om det (kun til visning i admin).
 */
export type LineTarget = { lineId: string; quantity: number; from?: number };

const DAY = 24 * 60 * 60 * 1000;
/** Fejler en godkendt annullering så mange gange, gives der op (vises i admin). */
export const MAX_ATTEMPTS = 5;

export function releaseFor(shop: string, client: PrismaClient = db) {
  if (!shop) throw new Error("releaseFor kræver en butik.");

  return {
    async settings(): Promise<ReleaseSettings> {
      const row = await client.shopSetting.upsert({
        where: { shop },
        create: { shop },
        update: {},
      });
      return {
        cancelWindow: row.cancelWindow === "DAYS" ? "DAYS" : "UNTIL_FULFILLED",
        cancelDays: Math.max(1, row.cancelDays),
        cancelApproval: row.cancelApproval === "AUTO" ? "AUTO" : "MANUAL",
        cancelAutoDays: Math.max(1, row.cancelAutoDays),
        paymentGraceDays: Math.max(1, row.paymentGraceDays),
      };
    },

    async updateSettings(input: ReleaseSettings) {
      const data = {
        cancelWindow: input.cancelWindow,
        cancelDays: Math.max(1, input.cancelDays),
        cancelApproval: input.cancelApproval,
        cancelAutoDays: Math.max(1, input.cancelAutoDays),
        paymentGraceDays: Math.max(1, input.paymentGraceDays),
      };
      await client.shopSetting.upsert({
        where: { shop },
        create: { shop, ...data },
        update: data,
      });
    },

    /** Ordrens aktive tildelinger pr. linje (til annulleringssiden). */
    async activeByLine(orderId: string) {
      const rows = await client.allocation.findMany({
        where: { shop, orderId, status: "ACTIVE" },
        select: { orderLineId: true, quantity: true, promisedDate: true },
      });
      const byLine = new Map<string, { quantity: number; dates: string[] }>();
      for (const row of rows) {
        const line = byLine.get(row.orderLineId) ?? { quantity: 0, dates: [] };
        line.quantity += row.quantity;
        if (row.promisedDate) line.dates.push(row.promisedDate);
        byLine.set(row.orderLineId, line);
      }
      return byLine;
    },

    /** Hvornår kunden bestilte (fra tildelingerne). Null: ingen forudbestilling. */
    async orderCreatedAt(orderId: string) {
      const row = await client.allocation.findFirst({
        where: { shop, orderId, orderCreatedAt: { not: null } },
        select: { orderCreatedAt: true },
      });
      return row?.orderCreatedAt ?? null;
    },

    cancellations: {
      /** Den åbne anmodning for ordren (venter eller godkendt), hvis der er en. */
      async open(orderId: string) {
        return client.cancellationRequest.findFirst({
          where: { shop, orderId, status: { in: ["PENDING", "APPROVED"] } },
        });
      },

      /**
       * Ny anmodning. Er der allerede en åben for ordren, oprettes ingen ny
       * (linket åbnet og sendt to gange giver én anmodning).
       */
      async request(input: {
        orderId: string;
        orderName: string;
        targets: LineTarget[];
        source: "CUSTOMER" | "STAFF";
        approve: boolean;
        now?: Date;
      }) {
        const now = input.now ?? new Date();
        await client.cancellationRequest.createMany({
          data: [
            {
              shop,
              orderId: input.orderId,
              orderName: input.orderName,
              lines: JSON.stringify(input.targets),
              source: input.source,
              status: input.approve ? "APPROVED" : "PENDING",
              requestedAt: now,
              decidedAt: input.approve ? now : null,
            },
          ],
          skipDuplicates: true,
        });
        return client.cancellationRequest.findFirst({
          where: {
            shop,
            orderId: input.orderId,
            status: { in: ["PENDING", "APPROVED"] },
          },
        });
      },

      async list(limit = 100) {
        const rows = await client.cancellationRequest.findMany({
          where: { shop },
          orderBy: { requestedAt: "desc" },
          take: limit,
        });
        return rows.map((row) => ({
          ...row,
          lines: JSON.parse(row.lines) as LineTarget[],
        }));
      },

      async countPending() {
        return client.cancellationRequest.count({
          where: { shop, status: "PENDING" },
        });
      },

      /** Butikken godkender. Kun en ventende kan godkendes (dobbeltklik: én gang). */
      async approve(id: string, now = new Date()) {
        const result = await client.cancellationRequest.updateMany({
          where: { shop, id, status: "PENDING" },
          data: { status: "APPROVED", decidedAt: now },
        });
        return result.count;
      },

      async reject(id: string, now = new Date()) {
        const result = await client.cancellationRequest.updateMany({
          where: { shop, id, status: "PENDING" },
          data: { status: "REJECTED", decidedAt: now },
        });
        return result.count;
      },

      /** Godkendte, der skal udføres. */
      async approved() {
        const rows = await client.cancellationRequest.findMany({
          where: { shop, status: "APPROVED" },
          orderBy: { requestedAt: "asc" },
        });
        return rows.map((row) => ({
          ...row,
          lines: JSON.parse(row.lines) as LineTarget[],
        }));
      },

      async markDone(id: string, now = new Date()) {
        await client.cancellationRequest.updateMany({
          where: { shop, id, status: "APPROVED" },
          data: { status: "DONE", doneAt: now, lastError: null },
        });
      },

      /** Fejl: prøves igen ved næste kørsel, indtil MAX_ATTEMPTS. */
      async recordFailure(id: string, error: string) {
        const row = await client.cancellationRequest.findFirst({
          where: { shop, id },
        });
        if (!row) return;
        const attempts = row.attempts + 1;
        await client.cancellationRequest.updateMany({
          where: { shop, id, status: "APPROVED" },
          data: {
            attempts,
            lastError: error,
            status: attempts >= MAX_ATTEMPTS ? "FAILED" : "APPROVED",
          },
        });
      },

      /** En fejlet anmodning sættes i gang igen. */
      async retry(id: string) {
        const result = await client.cancellationRequest.updateMany({
          where: { shop, id, status: "FAILED" },
          data: { status: "APPROVED", attempts: 0 },
        });
        return result.count;
      },
    },

    payments: {
      /**
       * Afstemmer en ordres afviste betaling med Shopify: opretter en sag, når
       * en opkrævning er afvist og ordren ikke er betalt, og lukker den, når
       * kunden har betalt, eller ordren er annulleret. Udsender hændelsen
       * «betaling afvist» én gang pr. afvist forsøg.
       */
      async observe(order: OrderSnapshot, now = new Date()) {
        if (!order.payment) return;
        const open = await client.paymentIssue.findFirst({
          where: {
            shop,
            orderId: order.id,
            status: { in: ["OPEN", "RELEASING"] },
          },
        });
        // Frigives netop nu: frigivelsen afslutter selv sagen.
        if (open?.status === "RELEASING") return;
        if (order.cancelled) {
          if (open) await close(open.id, "CLOSED", now);
          return;
        }
        if (order.payment.paid) {
          if (open) await close(open.id, "PAID", now);
          return;
        }
        const failedAt = order.payment.failedAt;
        if (!failedAt || open) return;

        const active = await client.allocation.findMany({
          where: { shop, orderId: order.id, status: "ACTIVE" },
          orderBy: { allocatedAt: "asc" },
        });
        if (active.length === 0) return; // Ingen reserverede enheder.

        const settings = await this.settingsForGrace();
        const failed = new Date(failedAt);
        const releaseAt = new Date(
          Math.max(failed.getTime(), now.getTime()) + settings * DAY,
        );
        await client.$transaction(async (tx) => {
          const created = await tx.paymentIssue.createMany({
            data: [
              {
                shop,
                orderId: order.id,
                orderName: order.name,
                failedAt: failed,
                detectedAt: now,
                releaseAt,
              },
            ],
            skipDuplicates: true,
          });
          if (created.count === 0) return;
          const first = active[0];
          await tx.outboxEvent.createMany({
            data: [
              {
                id: randomUUID(),
                shop,
                type: "preorder.payment_failed",
                dedupeKey: `payment_failed:${order.id}:${failedAt}`,
                orderId: order.id,
                orderName: order.name,
                orderLineId: first.orderLineId,
                variantId: first.variantId,
                quantity: active.reduce((n, a) => n + a.quantity, 0),
                deliveryDate:
                  active
                    .map((a) => a.promisedDate)
                    .filter((d): d is string => d != null)
                    .sort()[0] ?? null,
                createdAt: now,
              },
            ],
            skipDuplicates: true,
          });
        });
      },

      async settingsForGrace() {
        const row = await client.shopSetting.upsert({
          where: { shop },
          create: { shop },
          update: {},
        });
        return Math.max(1, row.paymentGraceDays);
      },

      /** Til admin: åbne sager og de seneste afsluttede, med leverancer. */
      async list(limit = 100) {
        const rows = await client.paymentIssue.findMany({
          where: { shop },
          orderBy: [{ status: "desc" }, { detectedAt: "desc" }],
          take: limit,
        });
        const allocations = await client.allocation.findMany({
          where: {
            shop,
            orderId: { in: rows.map((r) => r.orderId) },
            status: "ACTIVE",
          },
          select: {
            orderId: true,
            quantity: true,
            promisedDate: true,
            delivery: { select: { id: true, date: true, position: true } },
          },
        });
        return rows.map((row) => ({
          ...row,
          deliveries: allocations
            .filter((a) => a.orderId === row.orderId && a.delivery)
            .map((a) => ({
              deliveryId: a.delivery!.id,
              date: a.delivery!.date,
              position: a.delivery!.position,
              quantity: a.quantity,
            })),
        }));
      },

      async countOpen() {
        return client.paymentIssue.count({
          where: { shop, status: { in: ["OPEN", "RELEASING"] } },
        });
      },

      /** Butikken frigiver nu (før fristen). */
      async releaseNow(id: string, now = new Date()) {
        const result = await client.paymentIssue.updateMany({
          where: { shop, id, status: "OPEN" },
          data: { releaseAt: now },
        });
        return result.count;
      },

      /** Butikken forlænger fristen. */
      async extend(id: string, days: number) {
        const row = await client.paymentIssue.findFirst({
          where: { shop, id, status: "OPEN" },
        });
        if (!row) return 0;
        const base = Math.max(row.releaseAt.getTime(), Date.now());
        await client.paymentIssue.updateMany({
          where: { shop, id, status: "OPEN" },
          data: { releaseAt: new Date(base + days * DAY) },
        });
        return 1;
      },

      /** Sager, hvis frist er passeret. */
      async due(now = new Date()) {
        return client.paymentIssue.findMany({
          where: {
            shop,
            status: { in: ["OPEN", "RELEASING"] },
            releaseAt: { lte: now },
          },
          orderBy: { releaseAt: "asc" },
        });
      },

      async markReleasing(id: string) {
        await client.paymentIssue.updateMany({
          where: { shop, id, status: "OPEN" },
          data: { status: "RELEASING" },
        });
      },

      async markReleased(id: string, now = new Date()) {
        await close(id, "RELEASED", now);
      },

      async recordFailure(id: string, error: string) {
        await client.paymentIssue.updateMany({
          where: { shop, id },
          data: { lastError: error },
        });
      },

      async close(id: string, status: "PAID" | "CLOSED", now = new Date()) {
        await close(id, status, now);
      },
    },
  };

  async function close(
    id: string,
    status: "PAID" | "CLOSED" | "RELEASED",
    now: Date,
  ) {
    await client.paymentIssue.updateMany({
      where: { shop, id, status: { in: ["OPEN", "RELEASING"] } },
      data: { status, resolvedAt: now, lastError: null },
    });
  }
}

/** Butikker med godkendte annulleringer eller afviste betalinger, hvis frist er passeret. */
export async function shopsWithReleaseWork(
  client: PrismaClient = db,
  now = new Date(),
) {
  const [requests, issues] = await Promise.all([
    client.cancellationRequest.findMany({
      where: { status: "APPROVED" },
      distinct: ["shop"],
      select: { shop: true },
    }),
    client.paymentIssue.findMany({
      where: { status: { in: ["OPEN", "RELEASING"] }, releaseAt: { lte: now } },
      distinct: ["shop"],
      select: { shop: true },
    }),
  ]);
  return [...new Set([...requests, ...issues].map((r) => r.shop))];
}

/** Afsluttede anmodninger og sager slettes efter 90 dage. */
export async function purgeReleaseHistory(
  client: PrismaClient = db,
  now = new Date(),
) {
  const before = new Date(now.getTime() - 90 * DAY);
  const [requests, issues] = await client.$transaction([
    client.cancellationRequest.deleteMany({
      where: {
        status: { in: ["DONE", "REJECTED", "FAILED"] },
        requestedAt: { lt: before },
      },
    }),
    client.paymentIssue.deleteMany({
      where: {
        status: { in: ["RELEASED", "PAID", "CLOSED"] },
        detectedAt: { lt: before },
      },
    }),
  ]);
  return { requests: requests.count, issues: issues.count };
}
