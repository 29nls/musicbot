-- AlterTable
ALTER TABLE "reaction_role_panel" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "reaction_role_panel_expiresAt_idx" ON "reaction_role_panel"("expiresAt");

