import { unauthenticated } from "../shopify.server";
import { shopifySync } from "../sync/index.server";
import { shopsWithPendingEvents } from "../models/queue.server";
import { processShopQueue, type QueueDeps } from "./processQueue.server";
import { purgeOldData } from "../models/compliance.server";

// Starter behandlingen af en butiks kø.
//
// Webhook-handleren kvitterer straks og beder om en behandling. Den venter
// et par sekunder, så ordrer, der kommer næsten samtidig, behandles i samme
// omgang — i den rækkefølge kunderne bestilte. En periodisk fejning samler
// hændelser op, hvis appen er blevet genstartet midt i det hele.

const DEBOUNCE_MS = 5_000;
const SWEEP_MS = 60_000;
/** Gamle hændelser og besvarede dataanmodninger slettes en gang i timen. */
const PURGE_MS = 60 * 60_000;

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
  let deps: QueueDeps | null = null;
  try {
    const { admin } = await unauthenticated.admin(shop);
    const sync = shopifySync(admin.graphql, shop);
    deps = {
      readOrder: sync.readOrder,
      syncVariant: sync.sync,
      syncOrder: sync.syncOrder,
    };
  } catch {
    // Ingen adgang til butikken (fx er appen afinstalleret). Compliance-
    // hændelserne behandles alligevel; resten bliver liggende som PENDING og
    // prøves igen ved næste fejning.
  }
  try {
    return await processShopQueue({ shop, deps });
  } catch (error) {
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
  let lastPurge = 0;
  global.preauraQueueSweeper = setInterval(async () => {
    if (Date.now() - lastPurge > PURGE_MS) {
      lastPurge = Date.now();
      try {
        await purgeOldData();
      } catch (error) {
        console.error("Sletning af gamle data fejlede:", error);
      }
    }
    try {
      for (const shop of await shopsWithPendingEvents()) {
        scheduleQueue(shop, 0);
      }
    } catch (error) {
      console.error("Fejning af køen fejlede:", error);
    }
  }, SWEEP_MS);
}
