import { signLink, verifyLink } from "../lib/crypto.server";
import type { ReleaseSettings } from "../models/release.server";

// Kundens annulleringslink:
//   https://<butik>/apps/preaura/cancel?o=<ordrenummer>&x=<udløb>&s=<signatur>
// Signaturen dækker butik, ordre og udløb, så linket kun gælder den ene
// ordre i den ene butik og ikke kan forlænges eller gættes. Ingen login.
//
// Udløbet er en yderste grænse. Om kunden STADIG kan annullere, afgøres,
// når linket bruges: butikkens frist og om varen er sendt.

const DAY_SECONDS = 24 * 60 * 60;
/** Ved «indtil varen er sendt»: linket udløber senest efter så mange dage. */
export const UNTIL_FULFILLED_LINK_DAYS = 400;

const payload = (shop: string, orderNumber: string, expires: number) =>
  `${shop}|${orderNumber}|${expires}`;

export function cancelLinkExpiry(
  orderCreatedAt: Date,
  settings: Pick<ReleaseSettings, "cancelWindow" | "cancelDays">,
) {
  const days =
    settings.cancelWindow === "DAYS"
      ? settings.cancelDays
      : UNTIL_FULFILLED_LINK_DAYS;
  return Math.floor(orderCreatedAt.getTime() / 1000) + days * DAY_SECONDS;
}

export function cancelLink(
  shop: string,
  orderId: string,
  orderCreatedAt: Date,
  settings: Pick<ReleaseSettings, "cancelWindow" | "cancelDays">,
) {
  const orderNumber = orderId.split("/").pop()!;
  const expires = cancelLinkExpiry(orderCreatedAt, settings);
  const signature = signLink("cancel", payload(shop, orderNumber, expires));
  return `https://${shop}/apps/preaura/cancel?o=${orderNumber}&x=${expires}&s=${signature}`;
}

/** Ordrens id, hvis linket er gyldigt og ikke udløbet. Ellers null. */
export function readCancelLink(
  shop: string,
  params: { o: unknown; x: unknown; s: unknown },
  now = new Date(),
) {
  const orderNumber = String(params.o ?? "");
  const expires = Number(params.x);
  const signature = String(params.s ?? "");
  if (!/^\d{1,20}$/.test(orderNumber) || !Number.isInteger(expires))
    return null;
  if (!verifyLink("cancel", payload(shop, orderNumber, expires), signature)) {
    return null;
  }
  if (expires * 1000 < now.getTime()) return null;
  return `gid://shopify/Order/${orderNumber}`;
}
