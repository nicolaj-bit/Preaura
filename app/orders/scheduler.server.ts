import { unauthenticated } from "../shopify.server";
import { shopifySync } from "../sync/index.server";
import { shopsWithPendingEvents } from "../models/queue.server";
import { shopsWithOutboxWork } from "../models/outbox.server";
import { processOutbox } from "../events/outbox.server";
import { processShopQueue, type QueueDeps } from "./processQueue.server";
import { purgeOldData } from "../models/compliance.server";
import { shopsWithWaitlist } from "../models/waitlist.server";
import { shopsWithReleaseWork } from "../models/release.server";
import { processWaitlist } from "../waitlist/process.server";
import { accessFor } from "../billing/access.server";

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
  let sync: ReturnType<typeof shopifySync> | null = null;
  let graphql: Parameters<typeof shopifySync>[0] | null = null;
  try {
    const { admin } = await unauthenticated.admin(shop);
    graphql = admin.graphql;
    sync = shopifySync(admin.graphql, shop);
    const graphqlForAccess = admin.graphql;
    deps = {
      readOrder: sync.readOrder,
      syncVariant: sync.sync,
      syncOrder: sync.syncOrder,
      cancelOrder: sync.cancelOrder,
      setOrderLineQuantities: sync.setOrderLineQuantities,
      hasAccess: async () => {
        try {
          return (
            (await accessFor({ graphql: graphqlForAccess }, shop)).status ===
            "active"
          );
        } catch {
          return false;
        }
      },
    };
  } catch {
    // Ingen adgang til butikken (fx er appen afinstalleret). Compliance-
    // hændelserne behandles alligevel; resten bliver liggende som PENDING og
    // prøves igen ved næste fejning.
  }
  let result;
  try {
    result = await processShopQueue({ shop, deps });
  } catch (error) {
    console.error(`Køen for ${shop} kunne ikke behandles:`, error);
    result = { ran: false as const };
  }
  // Ventelisten — efter køen, så lageret er opdateret, og før udbakken, så
  // en udløst portion sendes med det samme.
  if (sync && graphql) {
    const shopify = sync;
    const admin = { graphql };
    try {
      await processWaitlist({
        shop,
        deps: {
          hasAccess: async () => {
            try {
              return (await accessFor(admin, shop)).status === "active";
            } catch {
              // Abonnementet kunne ikke tjekkes: prøv igen næste gang.
              return false;
            }
          },
          readAvailability: (ids) => shopify.readVariantAvailability(ids),
        },
      });
    } catch (error) {
      console.error(`Ventelisten for ${shop} fejlede:`, error);
    }
  }
  // Udgående hændelser (Flow, webhook, Klaviyo) — efter køen, så hændelser
  // fra ordrerne i denne omgang sendes med det samme.
  if (sync) {
    try {
      await processOutbox({
        shop,
        deps: {
          readOrderDetails: sync.readOrderDetails,
          readVariantDetails: sync.readVariantDetails,
          flowTriggerReceive: sync.flowTriggerReceive,
          fetch,
        },
      });
    } catch (error) {
      console.error(`Udgående hændelser for ${shop} fejlede:`, error);
    }
  }
  return result;
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
      const shops = new Set([
        ...(await shopsWithPendingEvents()),
        ...(await shopsWithOutboxWork()),
        ...(await shopsWithWaitlist()),
        ...(await shopsWithReleaseWork()),
      ]);
      for (const shop of shops) scheduleQueue(shop, 0);
    } catch (error) {
      console.error("Fejning af køen fejlede:", error);
    }
  }, SWEEP_MS);
}
