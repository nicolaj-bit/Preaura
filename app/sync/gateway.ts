import type { OrderSnapshot } from "../models/preorder.server";
import type { DesiredPlan, ShopifyPlan } from "./plans";

// Alt, synkroniseringen må gøre i Shopify — og dermed alt, appen må skrive.
// Der er med vilje ingen metode til at ÆNDRE en eksisterende selling plan:
// en plan kan oprettes eller tages ud af brug, aldrig rettes. Så kan en solgt
// plans løfte til kunden ikke overskrives.

export type ShopifyVariantState = {
  productId: string;
  /** Kan produktet kun købes med en selling plan? Gælder hele produktet. */
  productRequiresSellingPlan: boolean;
  /** Alle produktets varianter i Shopify. */
  productVariantIds: string[];
  /** Nuværende værdi af variantens metafelt preaura.preorder (json). */
  preorderMetafield: string | null;
  inventoryPolicy: string;
  tracked: boolean;
  /** Tilgængeligt antal på lageret. Null, hvis varen ikke ligger der. */
  available: number | null;
};

export type ShopifyGroupState = {
  id: string;
  appliesToVariant: boolean;
  plans: ShopifyPlan[];
};

export type CreatedPlan = { id: string; option: string };

import type { OrderDetails } from "../events/build";

export interface ShopifyGateway {
  read(input: {
    variantId: string;
    groupId: string | null;
    locationId: string | null;
  }): Promise<{
    variant: ShopifyVariantState | null;
    group: ShopifyGroupState | null;
  }>;

  createGroup(input: {
    variantId: string;
    merchantCode: string;
    plans: DesiredPlan[];
  }): Promise<{ groupId: string; plans: CreatedPlan[] }>;

  createPlans(groupId: string, plans: DesiredPlan[]): Promise<CreatedPlan[]>;
  deletePlans(groupId: string, planIds: string[]): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
  addVariant(groupId: string, variantId: string): Promise<void>;
  removeVariant(groupId: string, variantId: string): Promise<void>;

  /** Slår lagersporing til og sætter inventory policy til DENY. */
  enforceInventoryTracking(productId: string, variantId: string): Promise<void>;

  /**
   * Sætter produktets requiresSellingPlan. Gælder hele produktet: sand
   * betyder, at ingen variant kan købes uden selling plan.
   */
  setProductRequiresSellingPlan(
    productId: string,
    requiresSellingPlan: boolean,
  ): Promise<void>;

  /**
   * Skriver variantens metafelt preaura.preorder (json), som app-blokken på
   * produktsiden læser i Liquid.
   */
  setVariantPreorderMetafield(variantId: string, value: string): Promise<void>;

  /** Læser en ordre. Null, hvis den ikke findes. */
  readOrder(orderId: string): Promise<ShopifyOrderState | null>;

  /** Sætter appens metafelter (namespace "preaura") på en ordre. */
  setOrderMetafields(orderId: string, fields: OrderMetafield[]): Promise<void>;
  /**
   * Ordrens navn, kunde og produktnavne — til udgående hændelser. customer
   * er null, når appen ikke har adgang til kundens navn og e-mail.
   */
  readOrderDetails(orderId: string): Promise<OrderDetails | null>;
  /** Starter butikkens Flow-workflows, der bruger triggeren. */
  flowTriggerReceive(
    handle: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  addOrderTags(orderId: string, tags: string[]): Promise<void>;
  removeOrderTags(orderId: string, tags: string[]): Promise<void>;

  /** Sætter tilgængeligt antal, kun hvis Shopify stadig står på `changeFrom`. */
  setAvailable(input: {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
    changeFrom: number;
  }): Promise<void>;
}

export type ShopifyOrderState = {
  snapshot: OrderSnapshot;
  tags: string[];
  /** Nuværende værdier af appens metafelter på ordren. */
  metafields: Record<string, string | null>;
};

export type OrderMetafield = {
  key: string;
  type: "date" | "json";
  value: string;
};

/** Shopify svarede med userErrors. Beskeden vises på varianten i admin. */
export class ShopifyUserError extends Error {
  constructor(
    action: string,
    public readonly userErrors: { field?: string[] | null; message: string }[],
  ) {
    super(`${action}: ${userErrors.map((e) => e.message).join("; ")}`);
    this.name = "ShopifyUserError";
  }
}
