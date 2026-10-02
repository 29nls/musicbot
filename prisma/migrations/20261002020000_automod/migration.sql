-- CreateTable
CREATE TABLE "automod_rule" (
    "id" SERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "threshold" INTEGER NOT NULL DEFAULT 0,
    "actions" JSONB NOT NULL,
    "whitelist" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automod_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automod_rule_guildId_type_key" ON "automod_rule"("guildId", "type");
