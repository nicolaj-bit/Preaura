import type { PrismaClient } from "@prisma/client";
import db from "../db.server";

// Køen af webhook-hændelser og låsen, der sikrer, at kun én behandler
// arbejder på en butiks kø ad gangen. Alt filtreres på butik.

export const EVENT_STATUS = {
  pending: "PENDING",
  done: "DONE",
  failed: "FAILED",
  skipped: "SKIPPED",
} as const;

/** Så længe en lås gælder, før den regnes for forladt (fx efter et nedbrud). */
const LOCK_MS = 2 * 60 * 1000;

export function queueFor(shop: string, client: PrismaClient = db) {
  if (!shop) throw new Error("queueFor kræver en butik.");

  return {
    async pending(limit = 100, topics?: string[]) {
      return client.webhookEvent.findMany({
        where: {
          shop,
          status: EVENT_STATUS.pending,
          ...(topics ? { topic: { in: topics } } : {}),
        },
        orderBy: { receivedAt: "asc" },
        take: limit,
      });
    },

    async countByStatus() {
      const rows = await client.webhookEvent.groupBy({
        by: ["status"],
        where: { shop },
        _count: { _all: true },
      });
      return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    },

    async failed() {
      return client.webhookEvent.findMany({
        where: { shop, status: EVENT_STATUS.failed },
        orderBy: { receivedAt: "asc" },
      });
    },

    async markDone(ids: string[]) {
      await client.webhookEvent.updateMany({
        where: { shop, id: { in: ids } },
        data: {
          status: EVENT_STATUS.done,
          processedAt: new Date(),
          lastError: null,
          attempts: { increment: 1 },
        },
      });
    },

    async markSkipped(ids: string[], reason: string) {
      await client.webhookEvent.updateMany({
        where: { shop, id: { in: ids } },
        data: {
          status: EVENT_STATUS.skipped,
          processedAt: new Date(),
          lastError: reason,
        },
      });
    },

    async markFailed(ids: string[], error: string) {
      await client.webhookEvent.updateMany({
        where: { shop, id: { in: ids } },
        data: {
          status: EVENT_STATUS.failed,
          lastError: error,
          attempts: { increment: 1 },
        },
      });
    },

    /** Sætter fejlede hændelser tilbage i kø. Uden id: alle butikkens fejlede. */
    async retry(id?: string) {
      const result = await client.webhookEvent.updateMany({
        where: { shop, status: EVENT_STATUS.failed, ...(id ? { id } : {}) },
        data: { status: EVENT_STATUS.pending },
      });
      return result.count;
    },

    /**
     * Tager låsen for butikkens kø. Returnerer false, hvis en anden behandler
     * har den. Låsen udløber efter LOCK_MS, hvis den ikke fornyes.
     */
    async acquireLock(holder: string) {
      const now = new Date();
      const until = new Date(now.getTime() + LOCK_MS);
      // Prøv at overtage en udløbet (eller egen) lås.
      const taken = await client.queueLock.updateMany({
        where: { shop, OR: [{ lockedUntil: { lt: now } }, { holder }] },
        data: { holder, lockedUntil: until },
      });
      if (taken.count === 1) return true;
      // Findes der ingen lås endnu, oprettes den. Kommer en anden først, fejler
      // oprettelsen på primærnøglen, og vi har ikke låsen.
      try {
        await client.queueLock.create({
          data: { shop, holder, lockedUntil: until },
        });
        return true;
      } catch {
        return false;
      }
    },

    async renewLock(holder: string) {
      await client.queueLock.updateMany({
        where: { shop, holder },
        data: { lockedUntil: new Date(Date.now() + LOCK_MS) },
      });
    },

    async releaseLock(holder: string) {
      await client.queueLock.updateMany({
        where: { shop, holder },
        data: { lockedUntil: new Date(0) },
      });
    },
  };
}

/** Butikker med hændelser, der venter. Bruges af den periodiske fejning. */
export async function shopsWithPendingEvents(client: PrismaClient = db) {
  const rows = await client.webhookEvent.findMany({
    where: { status: EVENT_STATUS.pending },
    distinct: ["shop"],
    select: { shop: true },
  });
  return rows.map((row) => row.shop);
}
