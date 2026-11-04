-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueLock" (
    "shop" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueLock_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "ShopSetting" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "dateMode" TEXT NOT NULL DEFAULT 'SHIPPING',
    "buttonLabel" TEXT NOT NULL DEFAULT 'Forudbestil',
    "shippingDateText" TEXT NOT NULL DEFAULT 'Forventet afsendelse: {dato}',
    "deliveryDateText" TEXT NOT NULL DEFAULT 'Forventet levering: {dato}',
    "preorderNote" TEXT NOT NULL DEFAULT 'Varen er på forudbestilling og sendes, når den er på lager.',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantPlan" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT,
    "preorderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "preorderEnabledAt" TIMESTAMP(3),
    "setRequiresSellingPlan" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'STOCK',
    "modeForced" BOOLEAN NOT NULL DEFAULT false,
    "stockBeforeForce" INTEGER,
    "receivedWhileForced" INTEGER NOT NULL DEFAULT 0,
    "modeChangedAt" TIMESTAMP(3),
    "modeChangeReason" TEXT,
    "sellingPlanGroupId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "syncedAvailable" INTEGER,
    "lastSyncError" TEXT,
    "lastSyncAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sellingPlanId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL DEFAULT '',
    "orderCreatedAt" TIMESTAMP(3),
    "orderLineId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "soldWithoutPlan" BOOLEAN NOT NULL DEFAULT false,
    "promisedDate" TEXT,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellingPlanRef" (
    "shop" TEXT NOT NULL,
    "sellingPlanId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellingPlanRef_pkey" PRIMARY KEY ("shop","sellingPlanId")
);

-- CreateTable
CREATE TABLE "ModeChange" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModeChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shopifyRequestId" TEXT,
    "orderIds" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_webhookId_key" ON "WebhookEvent"("webhookId");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_receivedAt_idx" ON "WebhookEvent"("processedAt", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_shop_status_idx" ON "WebhookEvent"("shop", "status");

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
CREATE INDEX "Allocation_shop_orderLineId_idx" ON "Allocation"("shop", "orderLineId");

-- CreateIndex
CREATE INDEX "Allocation_shop_orderId_idx" ON "Allocation"("shop", "orderId");

-- CreateIndex
CREATE INDEX "ModeChange_shop_variantId_at_idx" ON "ModeChange"("shop", "variantId", "at");

-- CreateIndex
CREATE INDEX "DataRequest_shop_answeredAt_idx" ON "DataRequest"("shop", "answeredAt");

-- CreateIndex
CREATE INDEX "DataRequest_shop_customerId_idx" ON "DataRequest"("shop", "customerId");

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Partielle unikke indekser, som Prisma ikke kan beskrive (se Allocation i
-- schema.prisma): højst én AKTIV tildeling pr. ordrelinje og leverance, og
-- højst én UAFKLARET pr. ordrelinje. Skal genskabes, hvis en senere
-- migration opretter tabellen Allocation forfra.
CREATE UNIQUE INDEX "Allocation_active_line_delivery_key" ON "Allocation"("shop", "orderLineId", "deliveryId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "Allocation_unresolved_line_key" ON "Allocation"("shop", "orderLineId") WHERE "status" = 'UNRESOLVED';
