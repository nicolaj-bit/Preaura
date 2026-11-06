// Hændelsen. Det ENESTE sted, der bestemmer, hvad en hændelse indeholder.
// Flow, webhook og Klaviyo (channels.ts) får præcis det samme objekt og
// omformaterer det kun til modtagerens format.

export const EVENT_TYPES = [
  "preorder.created",
  "preorder.delayed",
  "preorder.ready",
  "preorder.cancelled",
  "preorder.payment_failed",
  "waitlist.available",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABELS: Record<EventType, string> = {
  "preorder.created": "Forudbestilling oprettet",
  "preorder.delayed": "Forudbestilling forsinket",
  "preorder.ready": "Forudbestilling klar til afsendelse",
  "preorder.cancelled": "Forudbestilling annulleret",
  "preorder.payment_failed": "Forudbestilling: betaling afvist",
  "waitlist.available": "Venteliste: varen kan købes",
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
  /** Null for hændelser fra ventelisten, som ikke hører til en ordre. */
  order: { id: string; name: string } | null;
  product: { id: string | null; title: string | null };
  variant: { id: string; title: string | null; sku: string | null };
  /**
   * Forudbestilling: antal stk. på ordrelinjen. Venteliste: antal, der kunne
   * købes, da kunden fik besked.
   */
  quantity: number;
  /** Leverancens dato (YYYY-MM-DD). */
  deliveryDate: string | null;
  /** Den tidligere dato, når datoen er ændret (forsinket). Ellers null. */
  previousDeliveryDate: string | null;
  /** Venteliste: den leverance, der blev åbnet. Null for lager. */
  deliveryId: string | null;
  /**
   * Venteliste: «stock» (varen kom på lager) eller «preorder» (en leverance
   * med ledige pladser blev åbnet). Null for forudbestillinger.
   */
  availability: "stock" | "preorder" | null;
  /**
   * Kundens link til at annullere forudbestillingen (signeret, kun denne
   * ordre). Null for annullerede ordrer og ventelisten.
   */
  cancelUrl: string | null;
};

/** Det, appen selv ved om hændelsen, da den skete. */
export type EventIntent = {
  id: string;
  shop: string;
  type: string;
  orderId: string | null;
  orderName: string;
  orderLineId: string | null;
  variantId: string;
  productId?: string | null;
  deliveryId?: string | null;
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
  cancelUrl: string | null = null,
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
    order: intent.orderId
      ? { id: intent.orderId, name: details?.name || intent.orderName }
      : null,
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
    deliveryId: null,
    availability: null,
    cancelUrl: intent.type === "preorder.cancelled" ? null : cancelUrl,
  };
}

/** Det, der hentes fra Shopify om varianten til en hændelse fra ventelisten. */
export type VariantDetails = {
  productId: string | null;
  productTitle: string | null;
  variantTitle: string | null;
  sku: string | null;
};

/**
 * Hændelsen fra ventelisten: kunden har bedt om besked, og varen kan købes.
 * Kun kundens e-mail — ventelisten kender ikke navnet.
 */
export function buildWaitlistEvent(
  intent: EventIntent,
  email: string,
  details: VariantDetails | null,
): PreauraEvent {
  return {
    id: intent.id,
    type: "waitlist.available",
    occurredAt: intent.createdAt.toISOString(),
    shop: intent.shop,
    customer: { email, firstName: null, lastName: null, name: null },
    order: null,
    product: {
      id: details?.productId ?? intent.productId ?? null,
      title: details?.productTitle ?? null,
    },
    variant: {
      id: intent.variantId,
      title: details?.variantTitle ?? null,
      sku: details?.sku ?? null,
    },
    quantity: intent.quantity,
    deliveryDate: intent.deliveryDate,
    previousDeliveryDate: null,
    deliveryId: intent.deliveryId ?? null,
    availability: intent.deliveryId ? "preorder" : "stock",
    cancelUrl: null,
  };
}
