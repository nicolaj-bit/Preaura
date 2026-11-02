import { unauthenticated } from "../shopify.server";
import { shopifySync } from "../sync/index.server";
import { shopsWithPendingEvents } from "../models/queue.server";
import { processShopQueue } from "./processQueue.server";

// Starter behandlingen af en butiks kø.
//
// Webhook-handleren kvitterer straks og beder om en behandling. Den venter
// et par sekunder, så ordrer, der kommer næsten samtidig, behandles i samme
// omgang — i den rækkefølge kunderne bestilte. En periodisk fejning samler
// hændelser op, hvis appen er blevet genstartet midt i det hele.

const DEBOUNCE_MS = 5_000;
const SWEEP_MS = 60_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleQueue(shop: string, delay = DEBOUNCE_MS) {
  const existing = timers.get(shop);
  if (existing) clearTimeout(existing);
  timers.set(
    shop,
    setTimeout(() => {
      timers.delete(shop);
      void runQueue(shop);
    }, delay),
  );
}

export async function runQueue(shop: string) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const sync = shopifySync(admin.graphql, shop);
    return await processShopQueue({
      shop,
      deps: {
        readOrder: sync.readOrder,
        syncVariant: sync.sync,
        syncOrder: sync.syncOrder,
      },
    });
  } catch (error) {
    // Kan ikke engang starte (fx er appen afinstalleret). Hændelserne bliver
    // liggende som PENDING og prøves igen ved næste fejning.
    console.error(`Køen for ${shop} kunne ikke behandles:`, error);
    return { ran: false as const };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var preauraQueueSweeper: ReturnType<typeof setInterval> | undefined;
}

/** Starter den periodiske fejning. Kaldes én gang, når serveren starter. */
export function startQueueSweeper() {
  if (global.preauraQueueSweeper) return;
  global.preauraQueueSweeper = setInterval(async () => {
    try {
      for (const shop of await shopsWithPendingEvents()) {
        scheduleQueue(shop, 0);
      }
    } catch (error) {
      console.error("Fejning af køen fejlede:", error);
    }
  }, SWEEP_MS);
}
