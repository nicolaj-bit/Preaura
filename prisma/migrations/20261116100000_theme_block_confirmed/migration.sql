-- Butikken kan selv bekræfte, at blokken er i temaet, når Shopify ikke kan
-- svare på det.
ALTER TABLE "ShopSetting" ADD COLUMN "themeBlockConfirmed" BOOLEAN NOT NULL DEFAULT false;
