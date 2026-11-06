-- Frigivelse af reserverede enheder: annullering og afvist betaling.

ALTER TABLE "ShopSetting" ADD COLUMN "cancelWindow" TEXT NOT NULL DEFAULT 'UNTIL_FULFILLED';
ALTER TABLE "ShopSetting" ADD COLUMN "cancelDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "ShopSetting" ADD COLUMN "cancelApproval" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "ShopSetting" ADD COLUMN "cancelAutoDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "ShopSetting" ADD COLUMN "paymentGraceDays" INTEGER NOT NULL DEFAULT 7;

CREATE TABLE "CancellationRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL DEFAULT '',
    "lines" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "CancellationRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CancellationRequest_shop_status_idx" ON "CancellationRequest"("shop", "status");
CREATE INDEX "CancellationRequest_shop_orderId_idx" ON "CancellationRequest"("shop", "orderId");
-- Højst én åben anmodning pr. ordre: et annulleringslink, der åbnes og
-- sendes to gange, giver én anmodning.
CREATE UNIQUE INDEX "CancellationRequest_open_unique" ON "CancellationRequest"("shop", "orderId") WHERE "status" IN ('PENDING', 'APPROVED');

CREATE TABLE "PaymentIssue" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL DEFAULT '',
    "failedAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releaseAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lastError" TEXT,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "PaymentIssue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentIssue_shop_status_releaseAt_idx" ON "PaymentIssue"("shop", "status", "releaseAt");
CREATE INDEX "PaymentIssue_shop_orderId_idx" ON "PaymentIssue"("shop", "orderId");
CREATE UNIQUE INDEX "PaymentIssue_open_unique" ON "PaymentIssue"("shop", "orderId") WHERE "status" IN ('OPEN', 'RELEASING');
