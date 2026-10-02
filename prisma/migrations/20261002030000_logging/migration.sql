-- CreateTable
CREATE TABLE "guild_log_subscription" (
    "id" SERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "channelId" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_log_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guild_log_subscription_guildId_category_key" ON "guild_log_subscription"("guildId", "category");
