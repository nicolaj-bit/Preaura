import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { queueFor } from "../models/queue.server";
import { outboxFor, type DeliveryResult } from "../models/outbox.server";
import { buildEvent, type OrderDetails, type PreauraEvent } from "./build";
import {
  FLOW_HANDLES,
  KLAVIYO_URL,
  klaviyoHeaders,
  toFlowPayload,
  toKlaviyoBody,
  toWebhookBody,
  webhookHeaders,
  type Channel,
} from "./channels";

// Afsenderen. To trin:
//
// 1. Byg: hændelser, som ændringerne har lagt i udbakken (status NEW), får
//    kundens navn og e-mail fra Shopify og bygges ÉN gang (build.ts). Den
//    færdige hændelse gemmes krypteret, og der oprettes én levering pr.
//    modtager, der er slået til.
// 2. Send: hver levering sendes for sig. Fejler den, prøves den igen med
//    voksende ventetid; fejler den endeligt, står den i admin med mulighed
//    for at prøve igen. Intet forsvinder, fordi en modtager var nede.
//
// Kun én afsender pr. butik ad gangen (samme lås som køen, egen nøgle).

export type OutboxDeps = {
  readOrderDetails(orderId: string): Promise<OrderDetails | null>;
  flowTriggerReceive(
    handle: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  fetch: typeof fetch;
};

const TIMEOUT_MS = 10_000;

export async function processOutbox({
  shop,
  deps,
  client = db,
  now = () => new Date(),
}: {
  shop: string;
  deps: OutboxDeps;
  client?: PrismaClient;
  now?: () => Date;
}) {
  const lock = queueFor(`${shop}#outbox`, client);
  const holder = randomUUID();
  if (!(await lock.acquireLock(holder))) return { ran: false as const };

  const outbox = outboxFor(shop, client);
  const totals = { built: 0, sent: 0, failed: 0 };
  try {
    // --- 1. Byg ------------------------------------------------------------
    const settings = await outbox.integrations.secrets();
    const channels: Channel[] = [
      ...(settings.flow ? (["FLOW"] as const) : []),
      ...(settings.webhook ? (["WEBHOOK"] as const) : []),
      ...(settings.klaviyo ? (["KLAVIYO"] as const) : []),
    ];
    const details = new Map<string, OrderDetails | null>();
    for (const intent of await outbox.events.unbuilt()) {
      try {
        if (!details.has(intent.orderId)) {
          details.set(
            intent.orderId,
            await deps.readOrderDetails(intent.orderId),
          );
        }
        const event = buildEvent(intent, details.get(intent.orderId) ?? null);
        await outbox.events.markBuilt(
          intent.id,
          JSON.stringify(event),
          channels,
          now(),
        );
        totals.built += 1;
      } catch (error) {
        // Prøves igen ved næste kørsel (fx Shopify kunne ikke nås).
        await outbox.events.recordBuildError(intent.id, message(error));
      }
    }

    // --- 2. Send -----------------------------------------------------------
    for (const delivery of await outbox.deliveries.due(now())) {
      await lock.renewLock(holder);
      if (!delivery.payload) {
        await outbox.deliveries.recordAttempt(
          delivery.id,
          {
            ok: false,
            retry: false,
            error:
              "Hændelsens data er slettet (efter 30 dage eller på kundens anmodning) og kan ikke sendes.",
          },
          now(),
        );
        totals.failed += 1;
        continue;
      }
      const event = JSON.parse(delivery.payload) as PreauraEvent;
      let result: DeliveryResult;
      if (delivery.channel === "FLOW") {
        result = settings.flow
          ? await sendFlow(event, deps)
          : { ok: false, retry: false, error: "Shopify Flow er slået fra." };
      } else if (delivery.channel === "WEBHOOK") {
        result = settings.webhook
          ? await sendWebhook(event, settings.webhook, deps.fetch)
          : { ok: false, retry: false, error: "Webhooken er slået fra." };
      } else {
        result = settings.klaviyo
          ? await sendKlaviyo(event, settings.klaviyo.apiKey, deps.fetch)
          : { ok: false, retry: false, error: "Klaviyo er slået fra." };
      }
      await outbox.deliveries.recordAttempt(delivery.id, result, now());
      if (result.ok) totals.sent += 1;
      else totals.failed += 1;
    }
  } finally {
    await lock.releaseLock(holder);
  }
  return { ran: true as const, ...totals };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Ukendt fejl.";
}

async function sendFlow(
  event: PreauraEvent,
  deps: OutboxDeps,
): Promise<DeliveryResult> {
  try {
    await deps.flowTriggerReceive(
      FLOW_HANDLES[event.type],
      toFlowPayload(event),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, retry: true, error: message(error) };
  }
}

/** Svar, der ikke bliver bedre af at prøve igen (fx forkert nøgle). */
function permanent(status: number) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function post(
  fetchFn: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; body: string },
  describe: (status: number, text: string) => string,
): Promise<DeliveryResult> {
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { ok: true, status: response.status };
    const text = (await response.text().catch(() => "")).slice(0, 300);
    return {
      ok: false,
      retry: !permanent(response.status),
      status: response.status,
      error: describe(response.status, text),
    };
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      retry: true,
      error: timedOut
        ? `Intet svar inden for ${TIMEOUT_MS / 1000} sekunder.`
        : `Kunne ikke nå modtageren: ${message(error)}`,
    };
  }
}

async function sendWebhook(
  event: PreauraEvent,
  target: { url: string; secret: string },
  fetchFn: typeof fetch,
) {
  const body = toWebhookBody(event);
  return post(
    fetchFn,
    target.url,
    { headers: webhookHeaders(event, body, target.secret), body },
    (status, text) => `Modtageren svarede ${status}${text ? `: ${text}` : ""}`,
  );
}

async function sendKlaviyo(
  event: PreauraEvent,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<DeliveryResult> {
  if (!event.customer.email) {
    return {
      ok: false,
      retry: false,
      error:
        "Ordren har ingen e-mail, eller PREAURA har ikke adgang til kundens e-mail i Shopify. Klaviyo kræver en e-mail.",
    };
  }
  return post(
    fetchFn,
    KLAVIYO_URL,
    { headers: klaviyoHeaders(apiKey), body: toKlaviyoBody(event) },
    (status, text) =>
      status === 401 || status === 403
        ? "Klaviyo afviste API-nøglen. Tjek, at det er en privat nøgle med adgang til Events."
        : `Klaviyo svarede ${status}${text ? `: ${text}` : ""}`,
  );
}
