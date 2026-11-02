-- CreateTable
CREATE TABLE "ShopSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "dateMode" TEXT NOT NULL DEFAULT 'SHIPPING',
    "buttonLabel" TEXT NOT NULL DEFAULT 'Forudbestil',
    "shippingDateText" TEXT NOT NULL DEFAULT 'Forventet afsendelse: {dato}',
    "deliveryDateText" TEXT NOT NULL DEFAULT 'Forventet levering: {dato}',
    "preorderNote" TEXT NOT NULL DEFAULT 'Varen er på forudbestilling og sendes, når den er på lager.',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VariantPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT,
    "preorderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sellingPlanId" TEXT,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "allocatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Allocation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSetting_shop_key" ON "ShopSetting"("shop");

-- CreateIndex
CREATE INDEX "VariantPlan_shop_productId_idx" ON "VariantPlan"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantPlan_shop_variantId_key" ON "VariantPlan"("shop", "variantId");

-- CreateIndex
CREATE INDEX "Delivery_shop_variantId_idx" ON "Delivery"("shop", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_shop_variantId_position_key" ON "Delivery"("shop", "variantId", "position");

-- CreateIndex
CREATE INDEX "Allocation_shop_deliveryId_idx" ON "Allocation"("shop", "deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_shop_orderLineId_key" ON "Allocation"("shop", "orderLineId");
