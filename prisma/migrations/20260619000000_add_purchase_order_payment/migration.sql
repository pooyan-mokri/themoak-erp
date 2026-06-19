-- CreateTable
CREATE TABLE "PurchaseOrderPayment" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "accountId" TEXT NOT NULL,
    "transactionId" TEXT,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderPayment_transactionId_key" ON "PurchaseOrderPayment"("transactionId");

-- CreateIndex
CREATE INDEX "PurchaseOrderPayment_purchaseOrderId_idx" ON "PurchaseOrderPayment"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderPayment_accountId_idx" ON "PurchaseOrderPayment"("accountId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderPayment" ADD CONSTRAINT "PurchaseOrderPayment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderPayment" ADD CONSTRAINT "PurchaseOrderPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderPayment" ADD CONSTRAINT "PurchaseOrderPayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
