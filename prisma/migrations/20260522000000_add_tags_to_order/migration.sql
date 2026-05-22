-- AlterTable
ALTER TABLE "Order" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable PurchaseOrder
ALTER TABLE "PurchaseOrder" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable InventoryMovement
ALTER TABLE "InventoryMovement" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
