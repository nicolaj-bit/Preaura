-- Opsætningsguiden på forsiden kan foldes sammen og åbnes igen.
ALTER TABLE "ShopSetting" ADD COLUMN "setupGuideHidden" BOOLEAN NOT NULL DEFAULT false;
