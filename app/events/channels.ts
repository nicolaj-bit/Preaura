import { createHmac, timingSafeEqual } from "node:crypto";
import { EVENT_LABELS, type EventType, type PreauraEvent } from "./build";

// De tre modtagere. De bygger IKKE hændelsen — de får den færdige
// PreauraEvent (build.ts) og omformaterer den til modtagerens format.

export {
  CHANNELS,
  CHANNEL_LABELS,
  SIGNATURE_HEADER,
  type Channel,
} from "./labels";
import { SIGNATURE_HEADER } from "./labels";

// --- Shopify Flow ----------------------------------------------------------

/** Triggerens handle i extensions/preaura-flow-* (kan ikke ændres senere). */
export const FLOW_HANDLES: Record<EventType, string> = {
  "preorder.created": "preaura-preorder-created",
  "preorder.delayed": "preaura-preorder-delayed",
  "preorder.ready": "preaura-preorder-ready",
  "preorder.cancelled": "preaura-preorder-cancelled",
};

const numeric = (gid: string | null) =>
  gid ? Number(gid.split("/").pop()) : null;

/**
 * Felterne skal svare præcis til [[settings.fields]] i triggerens
 * shopify.extension.toml. Flow kræver alle felter, så tomme værdier sendes
 * som tom tekst.
 */
export function toFlowPayload(event: PreauraEvent) {
  return {
    order_id: numeric(event.order.id),
    "Event id": event.id,
    "Order name": event.order.name,
    "Customer email": event.customer.email ?? "",
    "Customer name": event.customer.name ?? "",
    "Product title": event.product.title ?? "",
    "Variant title": event.variant.title ?? "",
    Quantity: event.quantity,
    "Delivery date": event.deliveryDate ?? "",
    "Previous delivery date": event.previousDeliveryDate ?? "",
  };
}

// --- Webhook ---------------------------------------------------------------

/** Hele hændelsen som JSON. Det er den tekst, signaturen beregnes over. */
export function toWebhookBody(event: PreauraEvent) {
  return JSON.stringify(event);
}

/** HMAC-SHA256 over den rå tekst, base64 — samme metode som Shopify bruger. */
export function signWebhook(body: string, secret: string) {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

/** Sådan verificerer modtageren et kald. Bruges også i testene. */
export function verifyWebhook(body: string, secret: string, signature: string) {
  const expected = Buffer.from(signWebhook(body, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function webhookHeaders(
  event: PreauraEvent,
  body: string,
  secret: string,
) {
  return {
    "Content-Type": "application/json",
    "User-Agent": "PREAURA",
    "X-Preaura-Event": event.type,
    "X-Preaura-Event-Id": event.id,
    "X-Preaura-Shop": event.shop,
    [SIGNATURE_HEADER]: signWebhook(body, secret),
  };
}

// --- Klaviyo ---------------------------------------------------------------

export const KLAVIYO_URL = "https://a.klaviyo.com/api/events";
/** Klaviyos API-version. Ret her, når Klaviyo udfaser den. */
export const KLAVIYO_REVISION = "2025-10-15";

export function klaviyoMetricName(type: EventType) {
  return `PREAURA: ${EVENT_LABELS[type]}`;
}

/**
 * Create Event. unique_id = hændelsens id: Klaviyo afviser dubletter på
 * samme profil, metric og unique_id, så et genforsøg efter en timeout kan
 * ikke give to mails.
 */
export function toKlaviyoBody(event: PreauraEvent) {
  return JSON.stringify({
    data: {
      type: "event",
      attributes: {
        unique_id: event.id,
        time: event.occurredAt,
        properties: {
          event_id: event.id,
          event_type: event.type,
          shop: event.shop,
          order_id: event.order.id,
          order_name: event.order.name,
          product_id: event.product.id,
          product_title: event.product.title,
          variant_id: event.variant.id,
          variant_title: event.variant.title,
          sku: event.variant.sku,
          quantity: event.quantity,
          delivery_date: event.deliveryDate,
          previous_delivery_date: event.previousDeliveryDate,
        },
        metric: {
          data: {
            type: "metric",
            attributes: { name: klaviyoMetricName(event.type) },
          },
        },
        profile: {
          data: {
            type: "profile",
            attributes: {
              email: event.customer.email,
              ...(event.customer.firstName
                ? { first_name: event.customer.firstName }
                : {}),
              ...(event.customer.lastName
                ? { last_name: event.customer.lastName }
                : {}),
            },
          },
        },
      },
    },
  });
}

export function klaviyoHeaders(apiKey: string) {
  return {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: KLAVIYO_REVISION,
    "Content-Type": "application/vnd.api+json",
    Accept: "application/vnd.api+json",
  };
}
