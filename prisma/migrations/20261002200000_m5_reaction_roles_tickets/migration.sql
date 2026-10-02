-- AlterTable
ALTER TABLE "guild_config" ADD COLUMN     "ticketCategoryId" VARCHAR(20),
ADD COLUMN     "ticketPanelChannelId" VARCHAR(20),
ADD COLUMN     "ticketPanelMessageId" VARCHAR(20),
ADD COLUMN     "ticketStaffRoleId" VARCHAR(20),
ALTER COLUMN "modulesEnabled" SET DEFAULT '{"music": true, "moderation": true, "automod": false, "logging": false, "reactions": false, "tickets": false}';

-- CreateTable
CREATE TABLE "reaction_role_panel" (
    "id" SERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "channelId" VARCHAR(20) NOT NULL,
    "messageId" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reaction_role_panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reaction_role_option" (
    "id" SERIAL NOT NULL,
    "panelId" INTEGER NOT NULL,
    "roleId" VARCHAR(20) NOT NULL,
    "label" VARCHAR(100),
    "emoji" VARCHAR(20),
    "description" VARCHAR(100),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reaction_role_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" SERIAL NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "channelId" VARCHAR(20),
    "openerId" VARCHAR(20) NOT NULL,
    "subject" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL,
    "claimedBy" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedBy" VARCHAR(20),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reaction_role_panel_guildId_createdAt_idx" ON "reaction_role_panel"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "reaction_role_option_panelId_position_idx" ON "reaction_role_option"("panelId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "reaction_role_option_panelId_roleId_key" ON "reaction_role_option"("panelId", "roleId");

-- CreateIndex
CREATE INDEX "ticket_guildId_status_createdAt_idx" ON "ticket"("guildId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ticket_guildId_openerId_status_idx" ON "ticket"("guildId", "openerId", "status");

-- CreateIndex
CREATE INDEX "ticket_guildId_status_closedAt_idx" ON "ticket"("guildId", "status", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_guildId_ticketNumber_key" ON "ticket"("guildId", "ticketNumber");

-- AddForeignKey
ALTER TABLE "reaction_role_option" ADD CONSTRAINT "reaction_role_option_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "reaction_role_panel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

