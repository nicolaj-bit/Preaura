-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL DEFAULT '',
    "orderCreatedAt" DATETIME,
    "orderLineId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "soldWithoutPlan" BOOLEAN NOT NULL DEFAULT false,
    "promisedDate" TEXT,
    "allocatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Allocation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Allocation" ("allocatedAt", "cancelledAt", "deliveryId", "id", "orderCreatedAt", "orderId", "orderLineId", "orderName", "promisedDate", "quantity", "shop", "status", "updatedAt", "variantId") SELECT "allocatedAt", "cancelledAt", "deliveryId", "id", "orderCreatedAt", "orderId", "orderLineId", "orderName", "promisedDate", "quantity", "shop", "status", "updatedAt", "variantId" FROM "Allocation";
DROP TABLE "Allocation";
ALTER TABLE "new_Allocation" RENAME TO "Allocation";
CREATE INDEX "Allocation_shop_deliveryId_idx" ON "Allocation"("shop", "deliveryId");
CREATE INDEX "Allocation_shop_orderLineId_idx" ON "Allocation"("shop", "orderLineId");
CREATE INDEX "Allocation_shop_orderId_idx" ON "Allocation"("shop", "orderId");
CREATE TABLE "new_VariantPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT,
    "preorderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "preorderEnabledAt" DATETIME,
    "setRequiresSellingPlan" BOOLEAN NOT NULL DEFAULT false,
    "sellingPlanGroupId" TEXT,
    "lastSyncedAt" DATETIME,
    "syncedAvailable" INTEGER,
    "lastSyncError" TEXT,
    "lastSyncAttemptAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VariantPlan" ("createdAt", "id", "inventoryItemId", "lastSyncAttemptAt", "lastSyncError", "lastSyncedAt", "locationId", "preorderEnabled", "productId", "sellingPlanGroupId", "shop", "syncedAvailable", "updatedAt", "variantId") SELECT "createdAt", "id", "inventoryItemId", "lastSyncAttemptAt", "lastSyncError", "lastSyncedAt", "locationId", "preorderEnabled", "productId", "sellingPlanGroupId", "shop", "syncedAvailable", "updatedAt", "variantId" FROM "VariantPlan";
DROP TABLE "VariantPlan";
ALTER TABLE "new_VariantPlan" RENAME TO "VariantPlan";
CREATE INDEX "VariantPlan_shop_productId_idx" ON "VariantPlan"("shop", "productId");
CREATE UNIQUE INDEX "VariantPlan_shop_variantId_key" ON "VariantPlan"("shop", "variantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Varianter, der allerede har forudbestilling slået til, regnes fra nu af.
UPDATE "VariantPlan" SET "preorderEnabledAt" = CURRENT_TIMESTAMP WHERE "preorderEnabled" = 1;

-- Tabellen Allocation er genskabt ovenfor, og dermed er de partielle unikke
-- indekser fra 20261102194451_order_processing væk (Prisma kender dem ikke).
-- De lægges ind igen. Testen "databasens værn mod dobbelttælling" fanger det,
-- hvis en senere migration glemmer dem.
CREATE UNIQUE INDEX "Allocation_active_line_delivery_key" ON "Allocation"("shop", "orderLineId", "deliveryId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "Allocation_unresolved_line_key" ON "Allocation"("shop", "orderLineId") WHERE "status" = 'UNRESOLVED';
