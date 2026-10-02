-- AlterTable
ALTER TABLE "guild_config" ADD COLUMN     "autoroleBotId" VARCHAR(20),
ADD COLUMN     "autoroleId" VARCHAR(20),
ADD COLUMN     "goodbyeMessage" VARCHAR(1500);

-- CreateTable
CREATE TABLE "moderation_case" (
    "id" SERIAL NOT NULL,
    "caseNumber" INTEGER NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "targetId" VARCHAR(20) NOT NULL,
    "moderatorId" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "moderation_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warning" (
    "id" SERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "userId" VARCHAR(20) NOT NULL,
    "moderatorId" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(1000),
    "caseId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_case_guildId_targetId_createdAt_idx" ON "moderation_case"("guildId", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_case_guildId_createdAt_idx" ON "moderation_case"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_case_guildId_caseNumber_key" ON "moderation_case"("guildId", "caseNumber");

-- CreateIndex
CREATE INDEX "warning_guildId_userId_createdAt_idx" ON "warning"("guildId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "warning" ADD CONSTRAINT "warning_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "moderation_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
