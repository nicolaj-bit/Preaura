import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { queueFor } from "../models/queue.server";
import { outboxFor } from "../models/outbox.server";
import { waitlistFor } from "../models/waitlist.server";

// Ventelisten: hvornår får de tilmeldte besked?
//
// Én mekanisme med to udløsere. Varen kommer på lager, eller en leverance med
// ledige pladser åbnes — i begge tilfælde kan varianten købes i Shopify, og
// det er det eneste, der tjekkes. Hændelsen fortæller, hvilken af delene det
// var (og hvilken leverance).
//
// - Ikke på et glimt: varianten skal have kunnet købes i hele
//   «stabil-tiden», før der udløses. Kan den ikke købes undervejs, starter
//   uret forfra.
// - I tilmeldingsrækkefølge og i portioner: højst «portion» tilmeldinger
//   hvert «interval». Før hver portion tjekkes det igen, at varen kan købes.
// - Én besked pr. tilmelding: en udløst tilmelding er lukket.
// - Kun med aktivt abonnement og mindst én modtager slået til. Ellers venter
//   tilmeldingerne — intet slettes.
//
// Beskeden sendes som en hændelse gennem den samme udbakke som resten
// (app/events/outbox.server.ts). Der er ingen egen kanal.

export type VariantAvailability = {
  /** Kan købes i Shopify lige nu. */
  available: boolean;
  /** Lagerantal i Shopify. Null, hvis lageret ikke spores. */
  quantity: number | null;
};

export type WaitlistDeps = {
  /** Har butikken et aktivt abonnement (også i prøveperioden)? */
  hasAccess(): Promise<boolean>;
  /** Læser, om varianterne kan købes. Manglende varianter findes ikke. */
  readAvailability(
    variantIds: string[],
  ): Promise<Map<string, VariantAvailability>>;
};

export type WaitlistRunResult =
  | { ran: false; reason: "locked" | "no-access" | "no-recipients" }
  | { ran: true; triggered: number };

const MINUTE = 60_000;

export async function processWaitlist({
  shop,
  deps,
  client = db,
  now = () => new Date(),
}: {
  shop: string;
  deps: WaitlistDeps;
  client?: PrismaClient;
  now?: () => Date;
}): Promise<WaitlistRunResult> {
  const lock = queueFor(`${shop}#waitlist`, client);
  const holder = randomUUID();
  if (!(await lock.acquireLock(holder)))
    return { ran: false, reason: "locked" };

  try {
    const waitlist = waitlistFor(shop, client);
    const variantIds = await waitlist.openVariantIds();
    await waitlist.forgetWatchesExcept(variantIds);
    if (variantIds.length === 0) return { ran: true, triggered: 0 };

    if (!(await deps.hasAccess())) return { ran: false, reason: "no-access" };
    const recipients = await outboxFor(shop, client).integrations.secrets();
    if (!recipients.flow && !recipients.webhook && !recipients.klaviyo) {
      return { ran: false, reason: "no-recipients" };
    }

    const settings = await waitlist.settings();
    const availability = await deps.readAvailability(variantIds);
    let triggered = 0;

    for (const variantId of variantIds) {
      await lock.renewLock(holder);
      const state = availability.get(variantId);
      const watch = await waitlist.watch(variantId);
      const at = now();

      if (!state?.available) {
        if (watch?.availableSince) {
          await waitlist.setAvailableSince(variantId, null);
        }
        continue;
      }
      if (!watch?.availableSince) {
        await waitlist.setAvailableSince(variantId, at);
        continue;
      }
      const stableFor = at.getTime() - watch.availableSince.getTime();
      if (stableFor < settings.stableMinutes * MINUTE) continue;
      if (
        watch.lastBatchAt &&
        at.getTime() - watch.lastBatchAt.getTime() <
          settings.batchMinutes * MINUTE
      ) {
        continue;
      }

      const delivery = await waitlist.openedDelivery(variantId);
      triggered += await waitlist.triggerNext({
        variantId,
        size: settings.batchSize,
        delivery,
        available: delivery ? delivery.remaining : (state.quantity ?? 0),
        now: at,
      });
    }
    return { ran: true, triggered };
  } finally {
    await lock.releaseLock(holder);
  }
}
