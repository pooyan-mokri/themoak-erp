-- AlterTable: Account - add bank card and IBAN fields
ALTER TABLE "Account" ADD COLUMN "cardNumber" TEXT;
ALTER TABLE "Account" ADD COLUMN "sheba" TEXT;

-- AlterTable: Transaction - add tags array and payee
ALTER TABLE "Transaction" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Transaction" ADD COLUMN "payee" TEXT;
