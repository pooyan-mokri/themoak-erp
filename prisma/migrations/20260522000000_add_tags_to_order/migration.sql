-- AlterTable
ALTER TABLE "Order" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
