-- AlterTable
ALTER TABLE "log_entry" ADD COLUMN     "caseId" VARCHAR(20);

-- CreateIndex
CREATE INDEX "log_entry_guildId_caseId_idx" ON "log_entry"("guildId", "caseId");

