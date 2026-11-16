import { forShop } from "../models/preorder.server";
import { resolveLocale, translate } from "../i18n";
import { createShopifyGateway } from "./shopifyGateway.server";
import { syncVariant } from "./syncVariant.server";
import { syncOrder } from "./syncOrder.server";

// Indgangen til synkroniseringen for resten af appen. Routes og køen bruger
// kun denne fil — aldrig shopifyGateway.server.ts direkte (det håndhæves af
// lint). Alt, appen skriver til Shopify, går gennem sync og syncOrder.

type AdminGraphql = Parameters<typeof createShopifyGateway>[0];

export function shopifySync(graphql: AdminGraphql, shop: string) {
  const gateway = createShopifyGateway(graphql);
  /** Noter på ordren skrives på butiksejerens sprog. */
  const note = async (key: "orderNote.cancelled" | "orderNote.reduced") => {
    const saved = await forShop(shop).settings.get();
    const locale =
      resolveLocale(saved.adminLocaleChosen) ?? resolveLocale(saved.adminLocale);
    return translate(locale ?? "en", key);
  };
  return {
    /** Bringer Shopify i overensstemmelse med appen for én variant. */
    sync: (variantId: string) => syncVariant({ shop, variantId, gateway }),

    /** Skriver leveringsdato og tags på en ordre ud fra dens tildelinger. */
    syncOrder: (orderId: string) => syncOrder({ shop, orderId, gateway }),

    /** Læser en ordre, som den ser ud i Shopify nu. Skriver intet. */
    async readOrder(orderId: string) {
      return (await gateway.readOrder(orderId))?.snapshot ?? null;
    },

    /** Ordrens navn, kunde og produktnavne — til udgående hændelser. */
    readOrderDetails: (orderId: string) => gateway.readOrderDetails(orderId),

    /** Produkt- og variantnavn — til hændelser fra ventelisten. */
    readVariantDetails: (variantId: string) =>
      gateway.readVariantDetails(variantId),

    /** Kan varianterne købes lige nu? Skriver intet. */
    readVariantAvailability: (variantIds: string[]) =>
      gateway.readVariantAvailability(variantIds),

    /** Annullerer ordren i Shopify — uden refundering, uden at lægge på lager. */
    cancelOrder: async (
      orderId: string,
      reason: "CUSTOMER" | "DECLINED" | "STAFF",
    ) =>
      gateway.cancelOrder(orderId, reason, await note("orderNote.cancelled")),

    /** Nedsætter ordrelinjers antal til målet — uden refundering. */
    setOrderLineQuantities: async (
      orderId: string,
      targets: { lineId: string; quantity: number }[],
    ) =>
      gateway.setOrderLineQuantities(
        orderId,
        targets,
        await note("orderNote.reduced"),
      ),

    /** Starter butikkens Flow-workflows for en af appens triggere. */
    flowTriggerReceive: (handle: string, payload: Record<string, unknown>) =>
      gateway.flowTriggerReceive(handle, payload),

    /** Læser variantens lagerantal i Shopify lige nu. Skriver intet. */
    async readAvailable(variantId: string, locationId: string | null) {
      const state = await gateway.read({
        variantId,
        groupId: null,
        locationId,
      });
      return state.variant?.available ?? null;
    },
  };
}
