-- CreateTable
CREATE TABLE "QueueLock" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "holder" TEXT NOT NULL,
    "lockedUntil" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SellingPlanRef" (
    "shop" TEXT NOT NULL,
    "sellingPlanId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("shop", "sellingPlanId")
);

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
    "promisedDate" TEXT,
    "allocatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Allocation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Allocation" ("allocatedAt", "cancelledAt", "deliveryId", "id", "orderId", "orderLineId", "quantity", "shop", "status", "updatedAt", "variantId") SELECT "allocatedAt", "cancelledAt", "deliveryId", "id", "orderId", "orderLineId", "quantity", "shop", "status", "updatedAt", "variantId" FROM "Allocation";
DROP TABLE "Allocation";
ALTER TABLE "new_Allocation" RENAME TO "Allocation";
CREATE INDEX "Allocation_shop_deliveryId_idx" ON "Allocation"("shop", "deliveryId");
CREATE INDEX "Allocation_shop_orderLineId_idx" ON "Allocation"("shop", "orderLineId");
CREATE INDEX "Allocation_shop_orderId_idx" ON "Allocation"("shop", "orderId");
CREATE TABLE "new_WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "webhookId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT
);
INSERT INTO "new_WebhookEvent" ("id", "payload", "processedAt", "receivedAt", "shop", "topic", "webhookId") SELECT "id", "payload", "processedAt", "receivedAt", "shop", "topic", "webhookId" FROM "WebhookEvent";
DROP TABLE "WebhookEvent";
ALTER TABLE "new_WebhookEvent" RENAME TO "WebhookEvent";
CREATE UNIQUE INDEX "WebhookEvent_webhookId_key" ON "WebhookEvent"("webhookId");
CREATE INDEX "WebhookEvent_processedAt_receivedAt_idx" ON "WebhookEvent"("processedAt", "receivedAt");
CREATE INDEX "WebhookEvent_shop_status_idx" ON "WebhookEvent"("shop", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Partielle unikke indekser (Prisma kan ikke beskrive dem i schema.prisma).
-- En ordrelinje kan højst være AKTIV én gang pr. leverance og UAFKLARET én
-- gang i alt. Det er databasens sidste værn mod, at samme linje tælles to
-- gange, selv hvis behandlingen skulle køre dobbelt.
CREATE UNIQUE INDEX "Allocation_active_line_delivery_key" ON "Allocation"("shop", "orderLineId", "deliveryId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "Allocation_unresolved_line_key" ON "Allocation"("shop", "orderLineId") WHERE "status" = 'UNRESOLVED';
