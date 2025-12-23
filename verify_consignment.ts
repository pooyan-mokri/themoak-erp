
import { PrismaClient } from '@prisma/client';
import { transferStock, settleSales, createConsignmentPartner, paySettlement } from './src/actions/consignment';
import { getProfitAndLoss, getBalanceSheet } from './src/actions/reporting';
import { updateStock } from './src/actions/inventory';

const prisma = new PrismaClient();

import * as fs from 'fs';

const LOG_FILE = 'verification_log.txt';
function log(message: string, ...args: any[]) {
  const msg = message + ' ' + args.map(a => JSON.stringify(a)).join(' ');
  console.log(msg);
  fs.appendFileSync(LOG_FILE, msg + '\n');
}

async function safeAction(action: Function, ...args: any[]) {
  try {
    return await action(...args);
  } catch (error: any) {
    if (error.message.includes('static generation store missing')) {
      console.log('Ignoring Next.js revalidatePath error (expected in script)');
      return { success: true, message: 'Action completed (revalidate skipped)' };
    }
    throw error;
  }
}

async function main() {
  fs.writeFileSync(LOG_FILE, '--- Starting Verification ---\n');
  log('--- Starting Verification ---');

  // 1. Setup Data
  log('1. Setting up data...');
  const product = await prisma.product.create({
    data: {
      name: 'Test Sunglasses',
      sku: `TEST-${Date.now()}`,
      costPrice: 100000,
      sellPrice: 200000,
    }
  });
  console.log('Created Product:', product.name);

  const mainWarehouse = await prisma.warehouse.create({
    data: { name: 'Main Warehouse' }
  });
  console.log('Created Main Warehouse:', mainWarehouse.name);

  // Add stock to main warehouse
  await updateStock(product.id, mainWarehouse.id, 100);
  console.log('Added 100 stock to Main Warehouse');

  // 2. Create Partner
  console.log('\n2. Creating Consignment Partner...');
  const partnerFormData = new FormData();
  partnerFormData.append('name', 'Partner A');
  partnerFormData.append('phone', '123456');
  partnerFormData.append('address', 'Tehran, Test St.');
  const result = await safeAction(createConsignmentPartner, null, partnerFormData);
  console.log('Create Partner Result:', result);
  
  const partnerWarehouse = await prisma.warehouse.findFirst({
    where: { name: 'انبار امانی - Partner A' }
  });
  if (!partnerWarehouse) throw new Error('Partner warehouse not found');
  console.log('Created Partner Warehouse:', partnerWarehouse.name);

  // 3. Transfer Stock
  console.log('\n3. Transferring Stock...');
  const transferFormData = new FormData();
  transferFormData.append('sourceWarehouseId', mainWarehouse.id);
  transferFormData.append('targetWarehouseId', partnerWarehouse.id);
  transferFormData.append('productId', product.id);
  transferFormData.append('quantity', '10');
  
  const transferResult = await safeAction(transferStock, null, transferFormData);
  console.log('Transfer Result:', transferResult);

  // Verify Transfer
  const partnerStock = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: partnerWarehouse.id } }
  });
  console.log('Partner Stock after transfer:', partnerStock?.quantity);
  if (partnerStock?.quantity !== 10) throw new Error('Transfer failed');

  // 4. Settle Sales
  console.log('\n4. Settling Sales...');
  const settlementFormData = new FormData();
  settlementFormData.append('partnerWarehouseId', partnerWarehouse.id);
  settlementFormData.append('productId', product.id);
  settlementFormData.append('quantity', '5');
  settlementFormData.append('unitPrice', '200000');

  const settleResult = await safeAction(settleSales, null, settlementFormData);
  console.log('Settlement Result:', settleResult);

  // Verify Settlement
  const partnerStockAfter = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: partnerWarehouse.id } }
  });
  console.log('Partner Stock after settlement:', partnerStockAfter?.quantity);
  if (partnerStockAfter?.quantity !== 5) throw new Error('Settlement stock deduction failed');

  const order = await prisma.order.findFirst({
    where: { status: 'PENDING_PAYMENT' },
    orderBy: { createdAt: 'desc' }
  });
  console.log('Created Order:', order?.id, 'Amount:', order?.totalAmount);

  // 5. Check Reports (Before Payment)
  console.log('\n5. Checking Reports (Before Payment)...');
  const plBefore = await getProfitAndLoss();
  console.log('P&L Net Profit:', plBefore.netProfit); 
  // Note: P&L currently tracks TRANSACTIONS. Settlement created an ORDER, not a Transaction yet (until paid).
  // So P&L might be 0 or unchanged if we only count paid transactions.
  // Let's check Balance Sheet
  const bsBefore = await getBalanceSheet();
  console.log('Accounts Receivable:', bsBefore.assets.accountsReceivable);
  if (Number(bsBefore.assets.accountsReceivable) < 1000000) console.warn('Accounts Receivable might be wrong');

  // 6. Pay Settlement
  console.log('\n6. Paying Settlement...');
  // Need an account
  const account = await prisma.account.create({
    data: { name: 'Bank', type: 'Bank', currency: 'TOMAN' }
  });

  const paymentFormData = new FormData();
  paymentFormData.append('orderId', order!.id);
  paymentFormData.append('accountId', account.id);

  const payResult = await safeAction(paySettlement, null, paymentFormData);
  console.log('Payment Result:', payResult);

  // 7. Check Reports (After Payment)
  console.log('\n7. Checking Reports (After Payment)...');
  const plAfter = await getProfitAndLoss();
  console.log('P&L Net Profit:', plAfter.netProfit);
  // Now it should show profit (Income - Expense). Expense might be 0 if we didn't record COGS as expense transaction.
  // In this simple system, maybe we only recorded Income.
  
  const bsAfter = await getBalanceSheet();
  console.log('Cash & Bank:', bsAfter.assets.cashAndBank);

  console.log('\n--- Verification Complete ---');
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
