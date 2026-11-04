-- AlterTable
ALTER TABLE "VariantPlan" ADD COLUMN     "readyCredit" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Allocation" ADD COLUMN     "readyAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "flowEnabled" BOOLEAN NOT NULL DEFAULT true,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookUrlEnc" TEXT,
    "webhookUrlLast4" TEXT,
    "webhookSecretEnc" TEXT,
    "klaviyoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "klaviyoKeyEnc" TEXT,
    "klaviyoKeyLast4" TEXT,
    "responsibilityAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL DEFAULT '',
    "orderLineId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "deliveryDate" TEXT,
    "previousDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "lastError" TEXT,
    "payloadEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "builtAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxDelivery" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastStatus" INTEGER,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSetting_shop_key" ON "IntegrationSetting"("shop");

-- CreateIndex
CREATE INDEX "OutboxEvent_shop_status_idx" ON "OutboxEvent"("shop", "status");

-- CreateIndex
CREATE INDEX "OutboxEvent_shop_orderId_idx" ON "OutboxEvent"("shop", "orderId");

-- CreateIndex
CREATE INDEX "OutboxEvent_shop_createdAt_idx" ON "OutboxEvent"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_shop_dedupeKey_key" ON "OutboxEvent"("shop", "dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxDelivery_shop_status_nextAttemptAt_idx" ON "OutboxDelivery"("shop", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxDelivery_shop_createdAt_idx" ON "OutboxDelivery"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxDelivery_eventId_channel_key" ON "OutboxDelivery"("eventId", "channel");

-- AddForeignKey
ALTER TABLE "OutboxDelivery" ADD CONSTRAINT "OutboxDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OutboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

