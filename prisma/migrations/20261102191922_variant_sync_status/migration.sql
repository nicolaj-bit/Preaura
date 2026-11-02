-- AlterTable
ALTER TABLE "VariantPlan" ADD COLUMN "lastSyncAttemptAt" DATETIME;
ALTER TABLE "VariantPlan" ADD COLUMN "lastSyncError" TEXT;
ALTER TABLE "VariantPlan" ADD COLUMN "lastSyncedAt" DATETIME;
ALTER TABLE "VariantPlan" ADD COLUMN "sellingPlanGroupId" TEXT;
ALTER TABLE "VariantPlan" ADD COLUMN "syncedAvailable" INTEGER;
