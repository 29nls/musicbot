-- CreateIndex
CREATE INDEX "moderation_case_guildId_moderatorId_createdAt_idx" ON "moderation_case"("guildId", "moderatorId", "createdAt" DESC);

