-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('FIXED', 'CONSUMABLE');

-- AlterTable
ALTER TABLE "FixedAsset" ADD COLUMN "assetType" "AssetType" NOT NULL DEFAULT 'FIXED';



