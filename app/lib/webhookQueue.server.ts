import { Prisma, type PrismaClient } from "@prisma/client";
import db from "../db.server";
import { minimalPayload } from "./webhookPayload";

type QueuedWebhook = {
  webhookId: string;
  shop: string;
  topic: string;
  payload: unknown;
};

/**
 * Lægger en webhook i køen (tabellen WebhookEvent). Kun de felter, appen
 * bruger, gemmes — se webhookPayload.ts.
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
      data: {
        webhookId,
        shop,
        topic,
        payload: JSON.stringify(minimalPayload(topic, payload)),
      },
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
