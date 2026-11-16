-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessLog_shop_at_idx" ON "AccessLog"("shop", "at");
