-- AlterTable: add archive fields to Warehouse
ALTER TABLE "Warehouse" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Warehouse" ADD COLUMN "archivedAt" TIMESTAMP(3);
