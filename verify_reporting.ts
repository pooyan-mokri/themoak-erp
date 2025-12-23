
import { PrismaClient } from '@prisma/client';
import { createProduct } from './src/actions/product';
import { createAccount, recordExpense, getSalesByProduct, getExpenseBreakdown } from './src/actions/accounting';
import { createConsignmentPartner } from './src/actions/consignment';
import { createOrder } from './src/actions/sales';
import { adjustStock } from './src/actions/inventory';

const prisma = new PrismaClient();

async function safeAction(action: Function, ...args: any[]) {
  try {
    return await action(...args);
  } catch (error: any) {
    if (error.message.includes('static generation store missing') || error.message === 'NEXT_REDIRECT' || error.digest?.startsWith('NEXT_REDIRECT')) {
      console.log('Ignoring Next.js revalidatePath/redirect error (expected in script)');
      return { success: true, message: 'Action completed (revalidate/redirect skipped)' };
    }
    throw error;
  }
}

async function main() {
  console.log('--- Verifying Reporting Enhancements ---');

  // 1. Setup: Create Product & Account
  console.log('1. Creating Test Product & Account...');
  const productFormData = new FormData();
  const sku = `REP-TEST-${Date.now()}`;
  productFormData.append('name', 'Reporting Test Product');
  productFormData.append('sku', sku);
  productFormData.append('costPrice', '50000');
  productFormData.append('sellPrice', '100000');
  
  await safeAction(createProduct, null, productFormData);
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error('Product creation failed');

  // Add Stock
  let mainWarehouse = await prisma.warehouse.findFirst({ where: { isVirtual: false, name: 'Main Warehouse' } });
  if (!mainWarehouse) {
    mainWarehouse = await prisma.warehouse.create({ data: { name: 'Main Warehouse', isVirtual: false } });
  }
  await safeAction(adjustStock, product.id, mainWarehouse.id, 100);

  // Create Account
  const accountFormData = new FormData();
  accountFormData.append('name', `Reporting Cash ${Date.now()}`);
  accountFormData.append('type', 'Cash');
  accountFormData.append('currency', 'TOMAN');
  accountFormData.append('initialBalance', '10000000');
  await safeAction(createAccount, null, accountFormData);
  const account = await prisma.account.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!account) throw new Error('Account creation failed');

  // 2. Create Sales
  console.log('\n2. Creating Sales...');
  // Create Partner
  const partnerFormData = new FormData();
  partnerFormData.append('name', `Reporting Partner ${Date.now()}`);
  await safeAction(createConsignmentPartner, null, partnerFormData);
  const partner = await prisma.customer.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!partner) throw new Error('Partner creation failed');

  // Create Order
  const orderData = {
    customerId: partner.id,
    items: [{ productId: product.id, quantity: 5, price: 100000 }],
    paymentMethod: 'CASH',
    accountId: account.id,
    totalAmount: 500000
  };
  await safeAction(createOrder, orderData);

  // 3. Create Expenses
  console.log('\n3. Creating Expenses...');
  // Record Expense
  const expenseFormData = new FormData();
  expenseFormData.append('amount', '500000');
  expenseFormData.append('currency', 'TOMAN');
  expenseFormData.append('category', 'Marketing');
  expenseFormData.append('accountId', account.id);
  expenseFormData.append('description', 'Ad Campaign');
  const expenseResult = await safeAction(recordExpense, null, expenseFormData);
  console.log('Record Expense Result:', expenseResult);

  // 4. Verify Sales By Product
  console.log('\n4. Verifying Sales By Product...');
  const salesByProduct = await getSalesByProduct();
  const productSales = salesByProduct.find(p => p.name === 'Reporting Test Product');
  
  console.log('Sales By Product Result:', productSales);
  
  if (!productSales || productSales.quantity !== 5 || productSales.total !== 500000) {
    throw new Error('Sales By Product verification failed');
  }

  // 5. Verify Expense Breakdown
  console.log('\n5. Verifying Expense Breakdown...');
  const expenseBreakdown = await getExpenseBreakdown();
  console.log('Full Expense Breakdown:', expenseBreakdown);
  const marketingExpense = expenseBreakdown.find(e => e.category === 'Marketing');

  console.log('Expense Breakdown Result:', marketingExpense);

  if (!marketingExpense || marketingExpense.amount < 500000) {
    throw new Error('Expense Breakdown verification failed');
  }

  console.log('\n--- Verification Complete ---');
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
