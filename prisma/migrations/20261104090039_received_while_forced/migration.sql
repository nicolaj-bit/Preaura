-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "mode" TEXT NOT NULL DEFAULT 'STOCK',
    "modeForced" BOOLEAN NOT NULL DEFAULT false,
    "stockBeforeForce" INTEGER,
    "receivedWhileForced" INTEGER NOT NULL DEFAULT 0,
    "modeChangedAt" DATETIME,
    "modeChangeReason" TEXT,
    "sellingPlanGroupId" TEXT,
    "lastSyncedAt" DATETIME,
    "syncedAvailable" INTEGER,
    "lastSyncError" TEXT,
    "lastSyncAttemptAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VariantPlan" ("createdAt", "id", "inventoryItemId", "lastSyncAttemptAt", "lastSyncError", "lastSyncedAt", "locationId", "mode", "modeChangeReason", "modeChangedAt", "modeForced", "preorderEnabled", "preorderEnabledAt", "productId", "sellingPlanGroupId", "setRequiresSellingPlan", "shop", "stockBeforeForce", "syncedAvailable", "updatedAt", "variantId") SELECT "createdAt", "id", "inventoryItemId", "lastSyncAttemptAt", "lastSyncError", "lastSyncedAt", "locationId", "mode", "modeChangeReason", "modeChangedAt", "modeForced", "preorderEnabled", "preorderEnabledAt", "productId", "sellingPlanGroupId", "setRequiresSellingPlan", "shop", "stockBeforeForce", "syncedAvailable", "updatedAt", "variantId" FROM "VariantPlan";
DROP TABLE "VariantPlan";
ALTER TABLE "new_VariantPlan" RENAME TO "VariantPlan";
CREATE INDEX "VariantPlan_shop_productId_idx" ON "VariantPlan"("shop", "productId");
CREATE UNIQUE INDEX "VariantPlan_shop_variantId_key" ON "VariantPlan"("shop", "variantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
