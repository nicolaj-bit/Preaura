import type { Prisma, PrismaClient } from "@prisma/client";
import db from "../db.server";
import { logError } from "../lib/log.server";

// Adgangslog over persondata (krav til beskyttede kundedata, level 2).
//
// Logges hver gang appen:
// - henter kundens navn og e-mail fra Shopify (til en hændelse),
// - dekrypterer en hændelse med kundens navn og e-mail (for at sende den),
// - dekrypterer en e-mail på ventelisten (for at give besked),
// - viser eller eksporterer en kundes data (dataanmodning),
// - sletter en kundes eller en butiks data.
//
// Loggen indeholder ingen persondata: kun id'er, hvad der skete og hvorfor.
// En fejl i logningen stopper ikke det, der logges — den skrives i
// serverens log, så den ikke forsvinder.

export const ACCESS_LOG_RETENTION_DAYS = 365;

export type AccessAction =
  | "read_customer_contact"
  | "decrypt_event_payload"
  | "decrypt_waitlist_email"
  | "view_data_request"
  | "export_customer_data"
  | "erase_customer"
  | "erase_shop";

export type AccessEntry = {
  action: AccessAction;
  subject: string;
  purpose: string;
  actor?: "system" | "admin";
};

type Client = PrismaClient | Prisma.TransactionClient;

export function accessLogFor(shop: string, client: Client = db) {
  if (!shop) throw new Error("accessLogFor kræver en butik.");
  return {
    async record(...entries: AccessEntry[]) {
      if (entries.length === 0) return;
      try {
        await client.accessLog.createMany({
          data: entries.map((entry) => ({
            shop,
            actor: entry.actor ?? "system",
            action: entry.action,
            subject: entry.subject,
            purpose: entry.purpose,
          })),
        });
      } catch (error) {
        logError(
          "Adgangsloggen kunne ikke skrives",
          { shop, ids: { actions: entries.map((e) => e.action).join(",") } },
          error,
        );
      }
    },

    /** De seneste poster for butikken (nyeste først). */
    async list(limit = 100) {
      return client.accessLog.findMany({
        where: { shop },
        orderBy: { at: "desc" },
        take: limit,
      });
    },

    /** shop/redact: alt om butikken slettes — også loggen. */
    async deleteAll() {
      await client.accessLog.deleteMany({ where: { shop } });
    },
  };
}

/** Sletter poster ældre end 365 dage for alle butikker. */
export async function purgeAccessLog(
  client: PrismaClient = db,
  now = new Date(),
) {
  const before = new Date(
    now.getTime() - ACCESS_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const result = await client.accessLog.deleteMany({
    where: { at: { lt: before } },
  });
  return result.count;
}
