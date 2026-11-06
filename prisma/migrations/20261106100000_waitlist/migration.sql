-- Venteliste: tilmeldinger, tilstand pr. variant og optælling.

ALTER TABLE "ShopSetting" ADD COLUMN "waitlistStableMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "ShopSetting" ADD COLUMN "waitlistBatchSize" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "ShopSetting" ADD COLUMN "waitlistBatchMinutes" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "DataRequest" ADD COLUMN "waitlist" TEXT NOT NULL DEFAULT '[]';

-- Hændelser fra ventelisten hører ikke til en ordre.
ALTER TABLE "OutboxEvent" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "OutboxEvent" ALTER COLUMN "orderLineId" DROP NOT NULL;
ALTER TABLE "OutboxEvent" ADD COLUMN "waitlistEntryId" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN "productId" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN "deliveryId" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN "emailHash" TEXT;
CREATE INDEX "OutboxEvent_shop_emailHash_idx" ON "OutboxEvent"("shop", "emailHash");

CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "emailEnc" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WaitlistEntry_shop_variantId_notifiedAt_createdAt_idx" ON "WaitlistEntry"("shop", "variantId", "notifiedAt", "createdAt");
CREATE INDEX "WaitlistEntry_shop_emailHash_idx" ON "WaitlistEntry"("shop", "emailHash");
CREATE INDEX "WaitlistEntry_notifiedAt_idx" ON "WaitlistEntry"("notifiedAt");
CREATE INDEX "WaitlistEntry_createdAt_idx" ON "WaitlistEntry"("createdAt");
-- Højst én ÅBEN tilmelding pr. e-mail og variant. En lukket (udløst)
-- tilmelding forhindrer ikke en ny.
CREATE UNIQUE INDEX "WaitlistEntry_open_unique" ON "WaitlistEntry"("shop", "variantId", "emailHash") WHERE "notifiedAt" IS NULL;

CREATE TABLE "WaitlistWatch" (
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "availableSince" TIMESTAMP(3),
    "lastBatchAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WaitlistWatch_pkey" PRIMARY KEY ("shop", "variantId")
);

CREATE TABLE "WaitlistStat" (
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL DEFAULT '',
    "deliveryDate" TEXT,
    "notified" INTEGER NOT NULL DEFAULT 0,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaitlistStat_pkey" PRIMARY KEY ("shop", "variantId", "deliveryId")
);
