import type { DesiredPlan, ShopifyPlan } from "./plans";

// Alt, synkroniseringen må gøre i Shopify. Der er med vilje ingen metode til
// at ÆNDRE en eksisterende selling plan: en plan kan oprettes eller tages ud
// af brug, aldrig rettes. Så kan en solgt plans løfte til kunden ikke
// overskrives.

export type ShopifyVariantState = {
  productId: string;
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

  /** Sætter tilgængeligt antal, kun hvis Shopify stadig står på `changeFrom`. */
  setAvailable(input: {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
    changeFrom: number;
  }): Promise<void>;
}

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
