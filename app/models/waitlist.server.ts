import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import {
  decrypt,
  encrypt,
  hashEmail,
  normalizeEmail,
} from "../lib/crypto.server";
import { findActiveDelivery, remainingQuantity } from "../lib/deliveries";

// Eneste adgang til ventelisten (WaitlistEntry, WaitlistWatch,
// WaitlistStat). Alt filtreres på butik. E-mailen krypteres her og forlader
// kun denne fil i klartekst, når hændelsen bygges.

export const WAITLIST_EVENT_TYPE = "waitlist.available";

/** Åbne tilmeldinger, der aldrig bliver udløst, slettes efter så mange dage. */
export const OPEN_RETENTION_DAYS = 180;
/** Udløste tilmeldinger slettes så mange dage efter udløsningen. */
export const NOTIFIED_RETENTION_DAYS = 7;

export type WaitlistSettings = {
  stableMinutes: number;
  batchSize: number;
  batchMinutes: number;
};

/** Den leverance, en tilmelding udløses for. Null: varen kom på lager. */
export type OpenedDelivery = { id: string; date: string; remaining: number };

const DAY = 24 * 60 * 60 * 1000;

export function waitlistFor(shop: string, client: PrismaClient = db) {
  if (!shop) throw new Error("waitlistFor kræver en butik.");

  return {
    /**
     * Ny tilmelding. Står e-mailen allerede åben på varianten, sker der
     * ingenting — og kalderen får ikke at vide, hvad der skete.
     */
    async add(input: { productId: string; variantId: string; email: string }) {
      const email = normalizeEmail(input.email);
      await client.waitlistEntry.createMany({
        data: [
          {
            shop,
            productId: input.productId,
            variantId: input.variantId,
            emailEnc: encrypt(email),
            emailHash: hashEmail(email),
          },
        ],
        skipDuplicates: true,
      });
    },

    async settings(): Promise<WaitlistSettings> {
      const row = await client.shopSetting.upsert({
        where: { shop },
        create: { shop },
        update: {},
      });
      return {
        stableMinutes: row.waitlistStableMinutes,
        batchSize: row.waitlistBatchSize,
        batchMinutes: row.waitlistBatchMinutes,
      };
    },

    async updateSettings(input: WaitlistSettings) {
      const data = {
        waitlistStableMinutes: input.stableMinutes,
        waitlistBatchSize: input.batchSize,
        waitlistBatchMinutes: input.batchMinutes,
      };
      await client.shopSetting.upsert({
        where: { shop },
        create: { shop, ...data },
        update: data,
      });
    },

    /** Varianter med åbne tilmeldinger. */
    async openVariantIds() {
      const rows = await client.waitlistEntry.findMany({
        where: { shop, notifiedAt: null },
        distinct: ["variantId"],
        select: { variantId: true },
      });
      return rows.map((r) => r.variantId);
    },

    async watch(variantId: string) {
      return client.waitlistWatch.findUnique({
        where: { shop_variantId: { shop, variantId } },
      });
    },

    async setAvailableSince(variantId: string, at: Date | null) {
      await client.waitlistWatch.upsert({
        where: { shop_variantId: { shop, variantId } },
        create: { shop, variantId, availableSince: at },
        update: { availableSince: at },
      });
    },

    /** Fjerner tilstanden for varianter, der ikke længere har nogen ventende. */
    async forgetWatchesExcept(variantIds: string[]) {
      await client.waitlistWatch.deleteMany({
        where: { shop, variantId: { notIn: variantIds } },
      });
    },

    /**
     * Den leverance, der er åben for varianten, hvis den sælges på
     * forudbestilling. Null, når varianten sælges fra lager.
     */
    async openedDelivery(variantId: string): Promise<OpenedDelivery | null> {
      const plan = await client.variantPlan.findFirst({
        where: { shop, variantId },
        select: { preorderEnabled: true, mode: true },
      });
      if (!plan?.preorderEnabled || plan.mode !== "PREORDER") return null;
      const rows = await client.delivery.findMany({
        where: { shop, variantId },
        include: {
          allocations: {
            where: { shop },
            select: { quantity: true, status: true },
          },
        },
      });
      const active = findActiveDelivery(
        rows.map((row) => ({
          id: row.id,
          position: row.position,
          status: row.status,
          date: row.date,
          remaining: remainingQuantity(row.quantity, row.allocations),
        })),
      );
      return active
        ? { id: active.id, date: active.date, remaining: active.remaining }
        : null;
    },

    /**
     * Udløser de næste `size` åbne tilmeldinger i tilmeldingsrækkefølge: hver
     * lukkes og får én hændelse i udbakken — i samme transaktion. En lukket
     * tilmelding udløses aldrig igen, og hændelsens dedupeKey forhindrer to
     * hændelser for samme tilmelding, også hvis to servere kører samtidig.
     */
    async triggerNext(input: {
      variantId: string;
      size: number;
      delivery: OpenedDelivery | null;
      /** Antal, der kan købes nu (lager eller ledige i leverancen). */
      available: number;
      now: Date;
    }) {
      const { variantId, delivery, now } = input;
      return client.$transaction(async (tx) => {
        const entries = await tx.waitlistEntry.findMany({
          where: { shop, variantId, notifiedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: input.size,
        });
        let triggered = 0;
        for (const entry of entries) {
          const closed = await tx.waitlistEntry.updateMany({
            where: { shop, id: entry.id, notifiedAt: null },
            data: { notifiedAt: now },
          });
          if (closed.count !== 1) continue;
          const created = await tx.outboxEvent.createMany({
            data: [
              {
                id: randomUUID(),
                shop,
                type: WAITLIST_EVENT_TYPE,
                dedupeKey: `waitlist:${entry.id}`,
                variantId,
                productId: entry.productId,
                quantity: Math.max(0, input.available),
                deliveryId: delivery?.id ?? null,
                deliveryDate: delivery?.date ?? null,
                waitlistEntryId: entry.id,
                emailHash: entry.emailHash,
                createdAt: now,
              },
            ],
            skipDuplicates: true,
          });
          triggered += created.count;
        }
        if (entries.length > 0) {
          await tx.waitlistWatch.upsert({
            where: { shop_variantId: { shop, variantId } },
            create: { shop, variantId, lastBatchAt: now, availableSince: now },
            update: { lastBatchAt: now },
          });
        }
        if (triggered > 0) {
          const deliveryId = delivery?.id ?? "";
          await tx.waitlistStat.upsert({
            where: {
              shop_variantId_deliveryId: { shop, variantId, deliveryId },
            },
            create: {
              shop,
              variantId,
              productId: entries[0].productId,
              deliveryId,
              deliveryDate: delivery?.date ?? null,
              notified: triggered,
              lastAt: now,
            },
            update: { notified: { increment: triggered }, lastAt: now },
          });
        }
        return triggered;
      });
    },

    /**
     * Til admin: antal ventende pr. variant og antal, der har fået besked,
     * pr. variant og leverance.
     */
    async overview() {
      const [waiting, stats] = await Promise.all([
        client.waitlistEntry.groupBy({
          by: ["productId", "variantId"],
          where: { shop, notifiedAt: null },
          _count: { _all: true },
          _min: { createdAt: true },
        }),
        client.waitlistStat.findMany({
          where: { shop },
          orderBy: [{ variantId: "asc" }, { lastAt: "desc" }],
        }),
      ]);
      return {
        waiting: waiting.map((row) => ({
          productId: row.productId,
          variantId: row.variantId,
          count: row._count._all,
          since: row._min.createdAt,
        })),
        notified: stats.map((row) => ({
          productId: row.productId,
          variantId: row.variantId,
          deliveryId: row.deliveryId || null,
          deliveryDate: row.deliveryDate,
          count: row.notified,
          lastAt: row.lastAt,
        })),
      };
    },

    /** Kundens tilmeldinger — til en dataanmodning. Uden e-mailen selv. */
    async forEmailHash(emailHash: string) {
      const rows = await client.waitlistEntry.findMany({
        where: { shop, emailHash },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => ({
        productId: row.productId,
        variantId: row.variantId,
        signedUpAt: row.createdAt.toISOString(),
        notifiedAt: row.notifiedAt?.toISOString() ?? null,
      }));
    },

    /** E-mailen til en tilmelding, når hændelsen bygges. Null, hvis slettet. */
    async emailFor(entryId: string) {
      const row = await client.waitlistEntry.findFirst({
        where: { shop, id: entryId },
        select: { emailEnc: true },
      });
      return row ? decrypt(row.emailEnc) : null;
    },
  };
}

/** Butikker med åbne tilmeldinger. */
export async function shopsWithWaitlist(client: PrismaClient = db) {
  const rows = await client.waitlistEntry.findMany({
    where: { notifiedAt: null },
    distinct: ["shop"],
    select: { shop: true },
  });
  return rows.map((r) => r.shop);
}

/** Sletter gamle tilmeldinger for alle butikker. Se fristerne øverst. */
export async function purgeWaitlist(
  client: PrismaClient = db,
  now = new Date(),
) {
  const [open, notified] = await client.$transaction([
    client.waitlistEntry.deleteMany({
      where: {
        notifiedAt: null,
        createdAt: { lt: new Date(now.getTime() - OPEN_RETENTION_DAYS * DAY) },
      },
    }),
    client.waitlistEntry.deleteMany({
      where: {
        notifiedAt: {
          lt: new Date(now.getTime() - NOTIFIED_RETENTION_DAYS * DAY),
        },
      },
    }),
  ]);
  return { open: open.count, notified: notified.count };
}
