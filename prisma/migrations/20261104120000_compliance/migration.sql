-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shopifyRequestId" TEXT,
    "orderIds" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" DATETIME
);

-- CreateIndex
CREATE INDEX "DataRequest_shop_answeredAt_idx" ON "DataRequest"("shop", "answeredAt");

-- CreateIndex
CREATE INDEX "DataRequest_shop_customerId_idx" ON "DataRequest"("shop", "customerId");

-- Allerede gemte hændelser skæres ned til de felter, appen bruger (samme
-- regler som app/lib/webhookPayload.ts). Så forsvinder kundens navn, mail og
-- adresse også fra de gamle rækker.
UPDATE "WebhookEvent" SET "payload" = '{}' WHERE json_valid("payload") = 0;

UPDATE "WebhookEvent" SET "payload" = json_object('id', json_extract("payload", '$.id'), 'admin_graphql_api_id', json_extract("payload", '$.admin_graphql_api_id'), 'created_at', json_extract("payload", '$.created_at')) WHERE "topic" IN ('ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_CANCELLED');

UPDATE "WebhookEvent" SET "payload" = json_object('order_id', json_extract("payload", '$.order_id')) WHERE "topic" = 'REFUNDS_CREATE';

UPDATE "WebhookEvent" SET "payload" = json_object('inventory_item_id', json_extract("payload", '$.inventory_item_id'), 'location_id', json_extract("payload", '$.location_id')) WHERE "topic" = 'INVENTORY_LEVELS_UPDATE';

UPDATE "WebhookEvent" SET "payload" = json_object('orders_requested', json(coalesce(json_extract("payload", '$.orders_requested'), '[]')), 'customer', json_object('id', json_extract("payload", '$.customer.id')), 'data_request', json_object('id', json_extract("payload", '$.data_request.id'))) WHERE "topic" = 'CUSTOMERS_DATA_REQUEST';

UPDATE "WebhookEvent" SET "payload" = json_object('orders_to_redact', json(coalesce(json_extract("payload", '$.orders_to_redact'), '[]')), 'customer', json_object('id', json_extract("payload", '$.customer.id'))) WHERE "topic" = 'CUSTOMERS_REDACT';

UPDATE "WebhookEvent" SET "payload" = '{}' WHERE "topic" NOT IN ('ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'REFUNDS_CREATE', 'INVENTORY_LEVELS_UPDATE', 'CUSTOMERS_DATA_REQUEST', 'CUSTOMERS_REDACT');
