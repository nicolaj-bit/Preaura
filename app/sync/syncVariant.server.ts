import type { PrismaClient } from "@prisma/client";
import db from "../db.server";
import { forShop } from "../models/preorder.server";
import { findActiveDelivery } from "../lib/deliveries";
import type { ShopifyGateway } from "./gateway";
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
    const available = await reconcile(data, variantId, gateway);
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
): Promise<number | null> {
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
  // Er gruppen slettet i Shopify, glemmes den, og der oprettes en ny.
  let group = state.group;
  if (plan.sellingPlanGroupId && !group) {
    await data.syncState.setGroupId(variantId, null);
  }

  const deliveries = await data.deliveries.listForVariants([variantId]);

  // Forudbestilling slået fra: varianten tages ud af gruppen, så den ikke
  // længere kan forudbestilles. Lageret røres ikke.
  if (!plan.preorderEnabled) {
    if (group?.appliesToVariant) {
      await gateway.removeVariant(group.id, variantId);
    }
    return null;
  }

  const settings = await data.settings.get();
  const desired = desiredPlans(deliveries, settings);
  const storedPlanIds = new Map(
    deliveries.map((delivery) => [delivery.id, delivery.sellingPlanId]),
  );

  // --- Selling plans -------------------------------------------------------

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
  return wantedAvailable;
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
    await data.syncState.setDeliveryPlanId(wanted.deliveryId, match.id);
  }
}
