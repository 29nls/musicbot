-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "guild_config" (
    "guildId" VARCHAR(20) NOT NULL,
    "logChannelId" VARCHAR(20),
    "welcomeChannelId" VARCHAR(20),
    "goodbyeChannelId" VARCHAR(20),
    "djRoleId" VARCHAR(20),
    "welcomeMessage" VARCHAR(1500),
    "defaultVolume" INTEGER NOT NULL DEFAULT 100,
    "idleTimeoutSec" INTEGER NOT NULL DEFAULT 300,
    "modulesEnabled" JSONB NOT NULL DEFAULT '{"music": true, "moderation": true, "automod": false, "logging": false}',
    "locale" VARCHAR(5) NOT NULL DEFAULT 'id',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_config_pkey" PRIMARY KEY ("guildId")
);
