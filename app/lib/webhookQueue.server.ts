import { Prisma, type PrismaClient } from "@prisma/client";
import db from "../db.server";

type QueuedWebhook = {
  webhookId: string;
  shop: string;
  topic: string;
  payload: unknown;
};

/**
 * Lægger en webhook i køen (tabellen WebhookEvent).
 *
 * Er hændelsen der allerede (samme webhookId), gør vi ingenting — Shopify
 * leverer nogle gange den samme webhook flere gange. Andre fejl kastes
 * videre, så handleren svarer 500, og Shopify prøver igen senere.
 */
export async function enqueueWebhook(
  { webhookId, shop, topic, payload }: QueuedWebhook,
  client: PrismaClient = db,
): Promise<void> {
  try {
    await client.webhookEvent.create({
      data: { webhookId, shop, topic, payload: JSON.stringify(payload ?? {}) },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}
