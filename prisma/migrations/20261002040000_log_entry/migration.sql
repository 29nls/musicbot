-- CreateTable
CREATE TABLE "log_entry" (
    "id" SERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "eventKey" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "executorId" VARCHAR(20),
    "targetId" VARCHAR(20),
    "channelId" VARCHAR(20),
    "logChannelId" VARCHAR(20),
    "logMessageId" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "log_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "log_entry_guildId_category_createdAt_idx" ON "log_entry"("guildId", "category", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "log_entry_guildId_targetId_createdAt_idx" ON "log_entry"("guildId", "targetId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "log_entry_guildId_executorId_createdAt_idx" ON "log_entry"("guildId", "executorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "log_entry_guildId_channelId_createdAt_idx" ON "log_entry"("guildId", "channelId", "createdAt" DESC);

