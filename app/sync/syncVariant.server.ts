import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { forShop } from "../models/preorder.server";
import { findActiveDelivery } from "../lib/deliveries";
import { decideMode, type VariantMode } from "../lib/variantMode";
import type { ShopifyGateway } from "./gateway";
import {
  preorderDataMatches,
  serializePreorderData,
  type VariantPreorderData,
} from "./variantMetafield";
import {
  desiredPlans,
  groupMerchantCode,
  planMatches,
  type DesiredPlan,
} from "./plans";

// DEN ENESTE VEJ, APPEN SKRIVER TIL SHOPIFY.
//
// syncVariant tager én variant og bringer Shopify i overensstemmelse med
// appens data: selling plan group, én selling plan pr. åben leverance,
// gruppen knyttet til varianten, lagersporing med DENY og tilgængeligt antal
// lig det resterende i den aktive leverance.
//
// Den er idempotent: den læser først Shopifys nuværende tilstand og skriver
// kun det, der afviger. Kører den to gange i træk, laver anden kørsel intet.
// Den kan derfor køres efter hver ændring i admin og igen for at reparere.
//
// En eksisterende selling plan ændres aldrig. Afviger den fra leverancen (fx
// en ny dato), oprettes en ny plan, og den gamle tages ud af brug.

export type SyncResult =
  { ok: true; available: number | null } | { ok: false; error: string };

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

export async function syncVariant({
  shop,
  variantId,
  gateway,
  client = db,
}: {
  shop: string;
  variantId: string;
  gateway: ShopifyGateway;
  client?: PrismaClient;
}): Promise<SyncResult> {
  const data = forShop(shop, client);
  try {
    const { available, product } = await reconcile(data, variantId, gateway);
    await reconcileProduct(data, product, gateway);
    await data.syncState.recordSuccess(variantId, available);
    return { ok: true, available };
  } catch (error) {
    // Ingen fejl må gå stille forbi: den gemmes på varianten og vises i admin.
    const message =
      error instanceof Error
        ? error.message
        : "Ukendt fejl under synkronisering.";
    await data.syncState.recordFailure(variantId, message);
    return { ok: false, error: message };
  }
}

type Data = ReturnType<typeof forShop>;

async function reconcile(
  data: Data,
  variantId: string,
  gateway: ShopifyGateway,
): Promise<{ available: number | null; product: ProductState }> {
  const plan = await data.syncState.getVariant(variantId);
  if (!plan) throw new SyncError("Varianten findes ikke i appen.");

  const state = await gateway.read({
    variantId,
    groupId: plan.sellingPlanGroupId,
    locationId: plan.locationId,
  });
  if (!state.variant) {
    throw new SyncError("Varianten findes ikke længere i Shopify.");
  }
  const product: ProductState = {
    id: state.variant.productId,
    requiresSellingPlan: state.variant.productRequiresSellingPlan,
    variantIds: state.variant.productVariantIds,
  };
  // Er gruppen slettet i Shopify, glemmes den, og der oprettes en ny.
  let group = state.group;
  if (plan.sellingPlanGroupId && !group) {
    await data.syncState.setGroupId(variantId, null);
  }

  const deliveries = await data.deliveries.listForVariants([variantId]);

  // --- Tilstand: lagermode eller forudbestillingsmode ----------------------
  //
  // Afgøres her, før noget skrives, så det gælder ens for ændringer i admin,
  // ordrer og lagerændringer — alle går gennem syncVariant og køen pr. butik.
  // Et skift rører aldrig eksisterende tildelinger eller ordrer.
  // Uden lagerplacering kan tilstanden ikke afgøres — sig det tydeligt.
  if (plan.preorderEnabled && !plan.locationId) {
    throw new SyncError(
      "Varianten ligger ikke på noget lager i Shopify. Tilføj den til et lager, og synkronisér igen.",
    );
  }
  if (plan.preorderEnabled && state.variant.available === null) {
    throw new SyncError(
      "Varianten er ikke aktiveret på sit lager i Shopify. Aktivér den på lageret, og synkronisér igen.",
    );
  }

  let mode: VariantMode = plan.preorderEnabled
    ? (plan.mode as VariantMode)
    : "STOCK";
  if (plan.preorderEnabled && state.variant.available != null) {
    const available = state.variant.available;
    // Forudbestilte stk., der stadig venter på varer (ikke klar til
    // afsendelse). Modtagne varer går først til dem.
    const owed = await data.syncState.owedUnits(variantId);
    const decision = decideMode({
      mode,
      forced: plan.modeForced,
      available,
      syncedAvailable: mode === "PREORDER" ? plan.syncedAvailable : null,
      hasSpace: findActiveDelivery(deliveries) != null,
      owed,
      stockBeforeForce: plan.modeForced ? null : plan.stockBeforeForce,
      receivedWhileForced: plan.receivedWhileForced,
    });
    // Tvunget forudbestilling: varer, der lægges på lager imens, gemmes til
    // side, så de ikke forsvinder, når appen sætter lageret til sit eget tal.
    if (
      plan.modeForced &&
      mode === "PREORDER" &&
      plan.syncedAvailable != null &&
      available > plan.syncedAvailable
    ) {
      await data.syncState.addReceivedWhileForced(
        variantId,
        available - plan.syncedAvailable,
      );
    }
    // Varer kommet hjem til forudbestillingerne: de dækkede markeres klar
    // til afsendelse (og giver en hændelse). Skifter varianten til
    // lagermode, er alle dækket.
    const received =
      mode === "PREORDER" && !plan.modeForced && plan.syncedAvailable != null
        ? available - plan.syncedAvailable
        : 0;
    if (!plan.modeForced && plan.stockBeforeForce != null) {
      // Tvangen er slået fra: varer lagt på lager imens gik til
      // forudbestillingerne.
      await data.syncState.receiveForPreorders(
        variantId,
        plan.receivedWhileForced,
      );
    } else if (decision.changed && decision.mode === "STOCK") {
      await data.syncState.markAllReady(variantId);
    } else if (received > 0) {
      await data.syncState.receiveForPreorders(variantId, received);
    }
    if (decision.changed) {
      if (decision.mode === "PREORDER" && plan.modeForced) {
        // Huskes, så lageret kan gives tilbage, når tvangen slås fra.
        await data.syncState.setStockBeforeForce(
          variantId,
          Math.max(0, available),
        );
      }
      if (
        decision.mode === "STOCK" &&
        decision.stockAvailable != null &&
        plan.locationId &&
        available !== decision.stockAvailable
      ) {
        // Skiftet til lagermode: Shopify skal stå på de rigtige varer, der
        // er tilbage efter forudbestillingerne. Det sidste, appen gør ved
        // lageret, før webshopejeren overtager det.
        await gateway.setAvailable({
          inventoryItemId: plan.inventoryItemId,
          locationId: plan.locationId,
          quantity: decision.stockAvailable,
          changeFrom: available,
        });
      }
      await data.syncState.recordModeChange(
        variantId,
        decision.mode,
        decision.reason ?? "",
        plan.modeForced,
      );
      mode = decision.mode;
    }
    if (!plan.modeForced && plan.stockBeforeForce != null) {
      await data.syncState.setStockBeforeForce(variantId, null);
    }
  }

  // Forudbestilling slået fra, eller lagermode: varianten tages ud af
  // gruppen, så den ikke kan forudbestilles. Gruppen og planerne slettes
  // IKKE — ordrer, der allerede er solgt på dem, beholder dem. Lageret røres
  // ikke.
  if (!plan.preorderEnabled || mode === "STOCK") {
    if (group?.appliesToVariant) {
      await gateway.removeVariant(group.id, variantId);
    }
    // Har varianten tidligere haft forudbestilling, får produktsiden besked
    // om, at den ikke er aktiv længere. Ellers skrives intet.
    const off: VariantPreorderData = { active: false };
    if (
      state.variant.preorderMetafield != null &&
      !preorderDataMatches(state.variant.preorderMetafield, off)
    ) {
      await gateway.setVariantPreorderMetafield(
        variantId,
        serializePreorderData(off),
      );
    }
    return { available: null, product };
  }

  const settings = await data.settings.get();
  const desired = desiredPlans(deliveries, settings);
  const storedPlanIds = new Map(
    deliveries.map((delivery) => [delivery.id, delivery.sellingPlanId]),
  );

  // --- Selling plans -------------------------------------------------------

  // Shopify tillader ikke, at en gruppe står uden planer — heller ikke et
  // øjeblik (fundet i testbutikken). Skal ALLE gruppens planer udskiftes (fx
  // når den eneste leverances dato eller vilkår ændres), slettes hele
  // gruppen, og en ny oprettes med de nye planer. Eksisterende ordrer
  // påvirkes ikke; de har selv deres plan og dato.
  if (group && group.plans.length > 0 && desired.length > 0) {
    const current = group;
    const anyKept = desired.some((wanted) => {
      const existing = current.plans.find(
        (plan) => plan.id === storedPlanIds.get(wanted.deliveryId),
      );
      return existing != null && planMatches(existing, wanted);
    });
    if (!anyKept) {
      await gateway.deleteGroup(current.id);
      await data.syncState.setGroupId(variantId, null);
      for (const delivery of deliveries) {
        if (delivery.sellingPlanId) {
          await data.syncState.setDeliveryPlanId(delivery.id, null);
        }
      }
      group = null;
    }
  }

  if (desired.length === 0) {
    // Ingen åbne leverancer: intet at forudbestille. Gruppen fjernes helt.
    if (group) {
      await gateway.deleteGroup(group.id);
      await data.syncState.setGroupId(variantId, null);
      group = null;
    }
    for (const delivery of deliveries) {
      if (delivery.sellingPlanId) {
        await data.syncState.setDeliveryPlanId(delivery.id, null);
      }
    }
  } else if (!group) {
    const created = await gateway.createGroup({
      variantId,
      merchantCode: groupMerchantCode(variantId),
      plans: desired,
    });
    await data.syncState.setGroupId(variantId, created.groupId);
    await saveCreatedPlans(data, desired, created.plans);
    // Planer for leverancer uden plan nu (fx annullerede) nulstilles.
    for (const delivery of deliveries) {
      const wanted = desired.some((plan) => plan.deliveryId === delivery.id);
      if (!wanted && delivery.sellingPlanId) {
        await data.syncState.setDeliveryPlanId(delivery.id, null);
      }
    }
  } else {
    const groupId = group.id;
    const keep = new Set<string>();
    const toCreate: DesiredPlan[] = [];
    for (const wanted of desired) {
      const storedId = storedPlanIds.get(wanted.deliveryId);
      const existing = group.plans.find((plan) => plan.id === storedId);
      if (existing && planMatches(existing, wanted)) {
        keep.add(existing.id);
        // Planer fra før planreferencerne fandtes, får dem her.
        await data.syncState.recordPlanRef(existing.id, wanted.deliveryId);
      } else {
        toCreate.push(wanted);
      }
    }

    // Alt i gruppen, der ikke skal beholdes, tages ud af brug: planer for
    // annullerede leverancer, planer der afviger fra deres leverance, og
    // planer, appen ikke kender.
    const toDelete = group.plans
      .map((plan) => plan.id)
      .filter((id) => !keep.has(id));
    if (toDelete.length > 0) {
      await gateway.deletePlans(groupId, toDelete);
      for (const delivery of deliveries) {
        if (
          delivery.sellingPlanId &&
          toDelete.includes(delivery.sellingPlanId)
        ) {
          await data.syncState.setDeliveryPlanId(delivery.id, null);
        }
      }
    }
    // Leverancer, hvis gemte plan ikke længere findes i Shopify, nulstilles.
    for (const delivery of deliveries) {
      if (
        delivery.sellingPlanId &&
        !keep.has(delivery.sellingPlanId) &&
        !toDelete.includes(delivery.sellingPlanId)
      ) {
        await data.syncState.setDeliveryPlanId(delivery.id, null);
      }
    }

    if (toCreate.length > 0) {
      const created = await gateway.createPlans(groupId, toCreate);
      await saveCreatedPlans(data, toCreate, created);
    }
    if (!group.appliesToVariant) {
      await gateway.addVariant(groupId, variantId);
    }
  }

  // --- Lager ---------------------------------------------------------------

  const variant = state.variant;
  if (variant.inventoryPolicy !== "DENY" || !variant.tracked) {
    await gateway.enforceInventoryTracking(variant.productId, variantId);
  }

  if (!plan.locationId) {
    throw new SyncError(
      "Varianten ligger ikke på noget lager i Shopify. Tilføj den til et lager, og synkronisér igen.",
    );
  }
  if (variant.available === null) {
    throw new SyncError(
      "Varianten er ikke aktiveret på sit lager i Shopify. Aktivér den på lageret, og synkronisér igen.",
    );
  }

  const active = findActiveDelivery(deliveries);
  const wantedAvailable = Math.max(0, active?.remaining ?? 0);
  if (variant.available !== wantedAvailable) {
    await gateway.setAvailable({
      inventoryItemId: plan.inventoryItemId,
      locationId: plan.locationId,
      quantity: wantedAvailable,
      changeFrom: variant.available,
    });
  }
  // --- Metafelt til produktsiden ---------------------------------------------

  // Læses igen: planerne kan være oprettet ovenfor.
  const fresh = await data.deliveries.listForVariants([variantId]);
  const activeNow = findActiveDelivery(fresh);
  const wantedData: VariantPreorderData = {
    active: true,
    mode: settings.dateMode,
    date: activeNow?.date ?? null,
    sellingPlanId: activeNow?.sellingPlanId ?? null,
    remaining: wantedAvailable,
    soldOut: activeNow == null,
  };
  if (!preorderDataMatches(state.variant.preorderMetafield, wantedData)) {
    await gateway.setVariantPreorderMetafield(
      variantId,
      serializePreorderData(wantedData),
    );
  }

  return { available: wantedAvailable, product };
}

type ProductState = {
  id: string;
  requiresSellingPlan: boolean;
  variantIds: string[];
};

/**
 * Produktets requiresSellingPlan. Den gælder HELE produktet, så den sættes
 * kun, når alle produktets varianter er på forudbestilling (og har deres
 * selling plans). Så forsvinder «Engangskøb», og kunden kan kun forudbestille.
 *
 * Er kun nogle varianter på forudbestilling, må den ikke sættes — den ville
 * spærre de almindelige varianter. Så er det app-blokken på produktsiden og
 * sikkerhedsnettet i ordrebehandlingen, der beskytter.
 *
 * Appen slår den kun fra igen, hvis det var appen, der satte den.
 */
async function reconcileProduct(
  data: Data,
  product: ProductState,
  gateway: ShopifyGateway,
) {
  const plans = await data.variantPlans.listForProduct(product.id);
  const allPreorder =
    product.variantIds.length > 0 &&
    product.variantIds.every((id) =>
      plans.some(
        (p) =>
          p.variantId === id &&
          p.preorderEnabled &&
          p.mode === "PREORDER" &&
          p.sellingPlanGroupId,
      ),
    );
  const setByApp = plans.some((p) => p.setRequiresSellingPlan);

  if (allPreorder && !product.requiresSellingPlan) {
    await gateway.setProductRequiresSellingPlan(product.id, true);
    await data.syncState.markRequiresSellingPlan(product.id, true);
  } else if (!allPreorder && product.requiresSellingPlan && setByApp) {
    await gateway.setProductRequiresSellingPlan(product.id, false);
    await data.syncState.markRequiresSellingPlan(product.id, false);
  } else if (allPreorder && product.requiresSellingPlan && !setByApp) {
    // Allerede sat (fx af webshopejeren). Appen overtager den nu.
    await data.syncState.markRequiresSellingPlan(product.id, true);
  }
}

async function saveCreatedPlans(
  data: Data,
  desired: DesiredPlan[],
  created: { id: string; option: string }[],
) {
  for (const wanted of desired) {
    const match = created.find((plan) => plan.option === wanted.option);
    if (!match) {
      throw new SyncError(
        `Shopify oprettede ikke planen "${wanted.option}". Synkronisér igen.`,
      );
    }
    await data.syncState.recordPlanRef(match.id, wanted.deliveryId);
    await data.syncState.setDeliveryPlanId(wanted.deliveryId, match.id);
  }
}
