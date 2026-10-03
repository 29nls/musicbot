-- CreateTable
CREATE TABLE "custom_command" (
    "id" SERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "response" TEXT NOT NULL,
    "createdBy" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_command_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_command_guildId_name_key" ON "custom_command"("guildId", "name");

-- CreateIndex
CREATE INDEX "custom_command_guildId_createdBy_idx" ON "custom_command"("guildId", "createdBy");