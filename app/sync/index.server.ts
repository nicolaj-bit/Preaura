import { createShopifyGateway } from "./shopifyGateway.server";
import { syncVariant } from "./syncVariant.server";

// Indgangen til synkroniseringen for resten af appen. Routes bruger kun
// denne fil — aldrig shopifyGateway.server.ts direkte (det håndhæves af lint).

type AdminGraphql = Parameters<typeof createShopifyGateway>[0];

export function shopifySync(graphql: AdminGraphql, shop: string) {
  const gateway = createShopifyGateway(graphql);
  return {
    /** Bringer Shopify i overensstemmelse med appen for én variant. */
    sync: (variantId: string) => syncVariant({ shop, variantId, gateway }),

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
