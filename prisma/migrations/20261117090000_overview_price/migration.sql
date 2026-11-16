ALTER TABLE "Allocation" ADD COLUMN "unitPrice" DECIMAL(18,4);
ALTER TABLE "Allocation" ADD COLUMN "currency" TEXT;
ALTER TABLE "ShopSetting" ADD COLUMN "adminLocaleChosen" TEXT;
