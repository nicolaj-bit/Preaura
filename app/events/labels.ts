// Navne og konstanter, som admin-siderne viser. Ingen Node-kode her — filen
// bruges også i browseren.

export const CHANNELS = ["FLOW", "WEBHOOK", "KLAVIYO"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  FLOW: "Shopify Flow",
  WEBHOOK: "Webhook",
  KLAVIYO: "Klaviyo",
};

/** Headeren med webhookens signatur. */
export const SIGNATURE_HEADER = "X-Preaura-Hmac-Sha256";
