import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { decrypt, encrypt, last4, randomSecret } from "../lib/crypto.server";
import type { Channel } from "../events/channels";

// Eneste adgang til IntegrationSetting, OutboxEvent og OutboxDelivery.
// Alt filtreres på butik. Hemmeligheder krypteres her og forlader aldrig
// denne fil i klartekst — undtagen signaturnøglen, som skal vises, og
// værdierne, afsenderen (app/events/outbox.server.ts) skal bruge.

export type IntegrationView = {
  flowEnabled: boolean;
  webhookEnabled: boolean;
  webhookUrlLast4: string | null;
  webhookSecret: string | null;
  klaviyoEnabled: boolean;
  klaviyoKeyLast4: string | null;
  responsibilityAcceptedAt: Date | null;
};

export type DeliveryResult =
  | { ok: true; status?: number }
  | { ok: false; retry: boolean; error: string; status?: number };

export const MAX_ATTEMPTS = 10;

/** Ventetid før næste forsøg: 1, 2, 4, 8 … minutter, højst 6 timer. */
export function backoffMs(attempts: number) {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60_000);
}

export function outboxFor(shop: string, client: PrismaClient = db) {
  if (!shop) throw new Error("outboxFor kræver en butik.");

  async function settingsRow() {
    return client.integrationSetting.upsert({
      where: { shop },
      create: { shop },
      update: {},
    });
  }

  return {
    integrations: {
      /** Det, admin må se. Nøgle og adresse kun som de sidste fire tegn. */
      async view(): Promise<IntegrationView> {
        const row = await settingsRow();
        return {
          flowEnabled: row.flowEnabled,
          webhookEnabled: row.webhookEnabled,
          webhookUrlLast4: row.webhookUrlLast4,
          webhookSecret: row.webhookSecretEnc
            ? decrypt(row.webhookSecretEnc)
            : null,
          klaviyoEnabled: row.klaviyoEnabled,
          klaviyoKeyLast4: row.klaviyoKeyLast4,
          responsibilityAcceptedAt: row.responsibilityAcceptedAt,
        };
      },

      /** Kun til afsenderen: modtagernes rigtige værdier. */
      async secrets() {
        const row = await settingsRow();
        const accepted = row.responsibilityAcceptedAt != null;
        return {
          flow: row.flowEnabled,
          webhook:
            accepted &&
            row.webhookEnabled &&
            row.webhookUrlEnc &&
            row.webhookSecretEnc
              ? {
                  url: decrypt(row.webhookUrlEnc),
                  secret: decrypt(row.webhookSecretEnc),
                }
              : null,
          klaviyo:
            accepted && row.klaviyoEnabled && row.klaviyoKeyEnc
              ? { apiKey: decrypt(row.klaviyoKeyEnc) }
              : null,
        };
      },

      async setFlow(enabled: boolean) {
        await settingsRow();
        await client.integrationSetting.update({
          where: { shop },
          data: { flowEnabled: enabled },
        });
      },

      /** Ny adresse (eller null: fjern). Signaturnøglen laves første gang. */
      async setWebhookUrl(url: string | null) {
        const row = await settingsRow();
        await client.integrationSetting.update({
          where: { shop },
          data: url
            ? {
                webhookUrlEnc: encrypt(url),
                webhookUrlLast4: last4(url),
                webhookSecretEnc:
                  row.webhookSecretEnc ?? encrypt(randomSecret()),
              }
            : {
                webhookUrlEnc: null,
                webhookUrlLast4: null,
                webhookEnabled: false,
              },
        });
      },

      async setWebhookEnabled(enabled: boolean) {
        await settingsRow();
        await client.integrationSetting.update({
          where: { shop },
          data: { webhookEnabled: enabled },
        });
      },

      async regenerateWebhookSecret() {
        await settingsRow();
        await client.integrationSetting.update({
          where: { shop },
          data: { webhookSecretEnc: encrypt(randomSecret()) },
        });
      },

      async setKlaviyoKey(apiKey: string | null) {
        await settingsRow();
        await client.integrationSetting.update({
          where: { shop },
          data: apiKey
            ? { klaviyoKeyEnc: encrypt(apiKey), klaviyoKeyLast4: last4(apiKey) }
            : {
                klaviyoKeyEnc: null,
                klaviyoKeyLast4: null,
                klaviyoEnabled: false,
              },
        });
      },

      async setKlaviyoEnabled(enabled: boolean) {
        await settingsRow();
        await client.integrationSetting.update({
          where: { shop },
          data: { klaviyoEnabled: enabled },
        });
      },

      async acceptResponsibility(accepted: boolean) {
        await settingsRow();
        await client.integrationSetting.update({
          where: { shop },
          data: accepted
            ? { responsibilityAcceptedAt: new Date() }
            : {
                responsibilityAcceptedAt: null,
                webhookEnabled: false,
                klaviyoEnabled: false,
              },
        });
      },
    },

    events: {
      /** Hændelser, der venter på at blive bygget. */
      async unbuilt(limit = 100) {
        return client.outboxEvent.findMany({
          where: { shop, status: "NEW" },
          orderBy: { createdAt: "asc" },
          take: limit,
        });
      },

      /** Gemmer den byggede hændelse og opretter én levering pr. modtager. */
      async markBuilt(
        id: string,
        payload: string,
        channels: Channel[],
        now = new Date(),
      ) {
        await client.$transaction([
          client.outboxEvent.updateMany({
            where: { shop, id, status: "NEW" },
            data: {
              status: "BUILT",
              builtAt: new Date(),
              lastError: null,
              payloadEnc: encrypt(payload),
            },
          }),
          client.outboxDelivery.createMany({
            data: channels.map((channel) => ({
              shop,
              eventId: id,
              channel,
              nextAttemptAt: now,
            })),
            skipDuplicates: true,
          }),
        ]);
      },

      /** Kan aldrig bygges (fx er kundens data slettet). Prøves ikke igen. */
      async markFailed(id: string, error: string) {
        await client.outboxEvent.updateMany({
          where: { shop, id, status: "NEW" },
          data: { status: "FAILED", lastError: error },
        });
      },

      async recordBuildError(id: string, error: string) {
        await client.outboxEvent.updateMany({
          where: { shop, id },
          data: { lastError: error },
        });
      },
    },

    deliveries: {
      /** Leveringer, hvis tid er kommet, med hændelsen (dekrypteret). */
      async due(now = new Date(), limit = 100) {
        const rows = await client.outboxDelivery.findMany({
          where: { shop, status: "PENDING", nextAttemptAt: { lte: now } },
          include: { event: true },
          orderBy: { nextAttemptAt: "asc" },
          take: limit,
        });
        return rows.map((row) => ({
          id: row.id,
          channel: row.channel as Channel,
          attempts: row.attempts,
          payload: row.event.payloadEnc ? decrypt(row.event.payloadEnc) : null,
        }));
      },

      /** Resultatet af ét forsøg. Genforsøg med voksende ventetid. */
      async recordAttempt(
        id: string,
        result: DeliveryResult,
        now = new Date(),
      ) {
        const row = await client.outboxDelivery.findFirst({
          where: { shop, id },
        });
        if (!row) return;
        const attempts = row.attempts + 1;
        if (result.ok) {
          await client.outboxDelivery.updateMany({
            where: { shop, id },
            data: {
              status: "DONE",
              attempts,
              deliveredAt: now,
              lastError: null,
              lastStatus: result.status ?? null,
            },
          });
          return;
        }
        const final = !result.retry || attempts >= MAX_ATTEMPTS;
        await client.outboxDelivery.updateMany({
          where: { shop, id },
          data: {
            status: final ? "FAILED" : "PENDING",
            attempts,
            lastError: result.error,
            lastStatus: result.status ?? null,
            nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
          },
        });
      },

      async failed() {
        return client.outboxDelivery.findMany({
          where: { shop, status: "FAILED" },
          include: {
            event: {
              select: {
                type: true,
                orderName: true,
                orderId: true,
                productId: true,
                createdAt: true,
                payloadEnc: true,
              },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 100,
        });
      },

      /** Sætter fejlede leveringer i kø igen. Uden id: alle butikkens. */
      async retry(id?: string, now = new Date()) {
        const result = await client.outboxDelivery.updateMany({
          where: { shop, status: "FAILED", ...(id ? { id } : {}) },
          data: { status: "PENDING", attempts: 0, nextAttemptAt: now },
        });
        return result.count;
      },

      /** Logbogen: de seneste leveringer. Ingen kundeoplysninger. */
      async log(limit = 50) {
        return client.outboxDelivery.findMany({
          where: { shop },
          include: {
            event: {
              select: {
                type: true,
                orderName: true,
                orderId: true,
                productId: true,
                createdAt: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
      },

      async countFailed() {
        return client.outboxDelivery.count({
          where: { shop, status: "FAILED" },
        });
      },
    },
  };
}

/** Butikker med hændelser at bygge eller leveringer, hvis tid er kommet. */
export async function shopsWithOutboxWork(
  client: PrismaClient = db,
  now = new Date(),
) {
  const [events, deliveries] = await Promise.all([
    client.outboxEvent.findMany({
      where: { status: "NEW" },
      distinct: ["shop"],
      select: { shop: true },
    }),
    client.outboxDelivery.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      distinct: ["shop"],
      select: { shop: true },
    }),
  ]);
  return [...new Set([...events, ...deliveries].map((r) => r.shop))];
}
