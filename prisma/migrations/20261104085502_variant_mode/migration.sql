-- CreateTable
CREATE TABLE "ModeChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
INSERT INTO "new_VariantPlan" ("createdAt", "id", "inventoryItemId", "lastSyncAttemptAt", "lastSyncError", "lastSyncedAt", "locationId", "preorderEnabled", "preorderEnabledAt", "productId", "sellingPlanGroupId", "setRequiresSellingPlan", "shop", "syncedAvailable", "updatedAt", "variantId") SELECT "createdAt", "id", "inventoryItemId", "lastSyncAttemptAt", "lastSyncError", "lastSyncedAt", "locationId", "preorderEnabled", "preorderEnabledAt", "productId", "sellingPlanGroupId", "setRequiresSellingPlan", "shop", "syncedAvailable", "updatedAt", "variantId" FROM "VariantPlan";
DROP TABLE "VariantPlan";
ALTER TABLE "new_VariantPlan" RENAME TO "VariantPlan";
CREATE INDEX "VariantPlan_shop_productId_idx" ON "VariantPlan"("shop", "productId");
CREATE UNIQUE INDEX "VariantPlan_shop_variantId_key" ON "VariantPlan"("shop", "variantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ModeChange_shop_variantId_at_idx" ON "ModeChange"("shop", "variantId", "at");

-- Varianter, der allerede har forudbestilling slået til, har hidtil altid
-- været i forudbestillingsmode. Det fortsætter de med, og historikken starter.
UPDATE "VariantPlan" SET "mode" = 'PREORDER', "modeChangedAt" = COALESCE("preorderEnabledAt", CURRENT_TIMESTAMP), "modeChangeReason" = 'Forudbestilling var slået til før automatisk skift fandtes.' WHERE "preorderEnabled" = 1;
INSERT INTO "ModeChange" ("id", "shop", "variantId", "mode", "forced", "reason", "at")
  SELECT 'migr_' || "id", "shop", "variantId", 'PREORDER', 0, 'Forudbestilling var slået til før automatisk skift fandtes.', COALESCE("preorderEnabledAt", CURRENT_TIMESTAMP)
  FROM "VariantPlan" WHERE "preorderEnabled" = 1;
