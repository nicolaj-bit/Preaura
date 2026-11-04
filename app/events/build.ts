// Hændelsen. Det ENESTE sted, der bestemmer, hvad en hændelse indeholder.
// Flow, webhook og Klaviyo (channels.ts) får præcis det samme objekt og
// omformaterer det kun til modtagerens format.

export const EVENT_TYPES = [
  "preorder.created",
  "preorder.delayed",
  "preorder.ready",
  "preorder.cancelled",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABELS: Record<EventType, string> = {
  "preorder.created": "Forudbestilling oprettet",
  "preorder.delayed": "Forudbestilling forsinket",
  "preorder.ready": "Forudbestilling klar til afsendelse",
  "preorder.cancelled": "Forudbestilling annulleret",
};

export type PreauraEvent = {
  /** Entydigt id (UUID). Samme id ved hvert genforsøg og til alle modtagere. */
  id: string;
  type: EventType;
  /** Hvornår det skete (ISO 8601). */
  occurredAt: string;
  /** Butikkens myshopify-domæne. */
  shop: string;
  customer: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    name: string | null;
  };
  order: { id: string; name: string };
  product: { id: string | null; title: string | null };
  variant: { id: string; title: string | null; sku: string | null };
  quantity: number;
  /** Leverancens dato (YYYY-MM-DD). */
  deliveryDate: string | null;
  /** Den tidligere dato, når datoen er ændret (forsinket). Ellers null. */
  previousDeliveryDate: string | null;
};

/** Det, appen selv ved om hændelsen, da den skete. */
export type EventIntent = {
  id: string;
  shop: string;
  type: string;
  orderId: string;
  orderName: string;
  orderLineId: string;
  variantId: string;
  quantity: number;
  deliveryDate: string | null;
  previousDate: string | null;
  createdAt: Date;
};

/** Det, der hentes fra Shopify, når hændelsen bygges. */
export type OrderDetails = {
  name: string;
  /** Null, når appen ikke har adgang til kundens navn og e-mail. */
  customer: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  lines: {
    id: string;
    productId: string | null;
    productTitle: string | null;
    variantTitle: string | null;
    sku: string | null;
  }[];
};

export function isEventType(type: string): type is EventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}

export function buildEvent(
  intent: EventIntent,
  details: OrderDetails | null,
): PreauraEvent {
  if (!isEventType(intent.type)) {
    throw new Error(`Ukendt hændelsestype: ${intent.type}`);
  }
  const line = details?.lines.find((l) => l.id === intent.orderLineId);
  const customer = details?.customer ?? null;
  const fullName =
    [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || null;
  return {
    id: intent.id,
    type: intent.type,
    occurredAt: intent.createdAt.toISOString(),
    shop: intent.shop,
    customer: {
      email: customer?.email ?? null,
      firstName: customer?.firstName ?? null,
      lastName: customer?.lastName ?? null,
      name: fullName,
    },
    order: { id: intent.orderId, name: details?.name || intent.orderName },
    product: {
      id: line?.productId ?? null,
      title: line?.productTitle ?? null,
    },
    variant: {
      id: intent.variantId,
      title: line?.variantTitle ?? null,
      sku: line?.sku ?? null,
    },
    quantity: intent.quantity,
    deliveryDate: intent.deliveryDate,
    previousDeliveryDate: intent.previousDate,
  };
}
