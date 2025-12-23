import { prisma } from './src/lib/prisma';

// Helper function to safely run actions
async function safeAction<T>(
  action: () => Promise<T>,
  actionName: string
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const result = await action();
    return { success: true, data: result };
  } catch (error: any) {
    // Ignore Next.js specific errors in test environment
    if (
      error?.message?.includes('static generation store missing') ||
      error?.message?.includes('NEXT_REDIRECT')
    ) {
      return { success: true, data: undefined };
    }
    console.error(`Error in ${actionName}:`, error.message);
    return { success: false, error: error.message };
  }
}

// Import actions
import { createAccount, getAccounts } from './src/actions/accounting';
import { createProduct, getProducts } from './src/actions/product';
import { getWarehouses } from './src/actions/warehouse';
import { createCustomer, getCustomers } from './src/actions/customer';
import { createSupplier, getSuppliers } from './src/actions/supplier';
import { createEmployee, getEmployees } from './src/actions/employee';
import { createShareholder, getShareholders } from './src/actions/shareholder';
import { ProductType } from '@prisma/client';

async function testModule(moduleName: string, testFn: () => Promise<void>) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 تست ماژول: ${moduleName}`);
  console.log('='.repeat(60));
  try {
    await testFn();
    console.log(`✅ ماژول ${moduleName} با موفقیت تست شد\n`);
  } catch (error: any) {
    console.error(`❌ خطا در تست ماژول ${moduleName}:`, error.message);
    console.error(error.stack);
    throw error;
  }
}

async function main() {
  console.log('🚀 شروع تست بخش به بخش سیستم\n');

  // Test IDs storage
  const testIds: Record<string, string> = {};

  // ============================================
  // 1. تست ماژول حساب‌ها (Accounting - Accounts)
  // ============================================
  await testModule('حساب‌ها', async () => {
    console.log('1. ایجاد حساب تست...');
    const account = await prisma.account.create({
      data: {
        name: 'حساب تست',
        type: 'Bank',
        currency: 'TOMAN',
        balance: 10000000,
      },
    });

    testIds.accountId = account.id;
    console.log(`✓ حساب ایجاد شد: ${testIds.accountId}`);

    console.log('2. دریافت لیست حساب‌ها...');
    const accountsResult = await safeAction(() => getAccounts(), 'getAccounts');
    if (!accountsResult.success || !accountsResult.data) {
      throw new Error('لیست حساب‌ها دریافت نشد');
    }
    console.log(`✓ ${accountsResult.data.length} حساب یافت شد`);
  });

  // ============================================
  // 2. تست ماژول محصولات (Products)
  // ============================================
  await testModule('محصولات', async () => {
    console.log('1. ایجاد محصول تست...');
    const product = await prisma.product.create({
      data: {
        name: 'محصول تست',
        sku: `TEST-${Date.now()}`,
        productType: ProductType.SALEABLE,
        costPrice: 100000,
        sellPrice: 150000,
      },
    });

    testIds.productId = product.id;
    console.log(`✓ محصول ایجاد شد: ${testIds.productId}`);

    console.log('2. دریافت لیست محصولات...');
    const productsResult = await safeAction(() => getProducts(), 'getProducts');
    if (!productsResult.success || !productsResult.data) {
      throw new Error('لیست محصولات دریافت نشد');
    }
    console.log(`✓ ${productsResult.data.length} محصول یافت شد`);
  });

  // ============================================
  // 3. تست ماژول انبار (Warehouses)
  // ============================================
  await testModule('انبارها', async () => {
    console.log('1. ایجاد انبار تست...');
    const warehouse = await prisma.warehouse.create({
      data: {
        name: 'انبار تست',
        isVirtual: false,
      },
    });

    testIds.warehouseId = warehouse.id;
    console.log(`✓ انبار ایجاد شد: ${testIds.warehouseId}`);

    console.log('2. دریافت لیست انبارها...');
    const warehousesResult = await safeAction(
      () => getWarehouses(),
      'getWarehouses'
    );
    if (!warehousesResult.success || !warehousesResult.data) {
      throw new Error('لیست انبارها دریافت نشد');
    }
    console.log(`✓ ${warehousesResult.data.length} انبار یافت شد`);
  });

  // ============================================
  // 4. تست ماژول مشتریان (Customers)
  // ============================================
  await testModule('مشتریان', async () => {
    console.log('1. ایجاد مشتری تست...');
    const customer = await prisma.customer.create({
      data: {
        name: 'مشتری تست',
        phone: '09123456789',
        email: 'customer@test.com',
      },
    });

    testIds.customerId = customer.id;
    console.log(`✓ مشتری ایجاد شد: ${testIds.customerId}`);

    console.log('2. دریافت لیست مشتریان...');
    const customersResult = await safeAction(
      () => getCustomers(),
      'getCustomers'
    );
    if (!customersResult.success || !customersResult.data) {
      throw new Error('لیست مشتریان دریافت نشد');
    }
    console.log(`✓ ${customersResult.data.length} مشتری یافت شد`);
  });

  // ============================================
  // 5. تست ماژول تامین‌کنندگان (Suppliers)
  // ============================================
  await testModule('تامین‌کنندگان', async () => {
    console.log('1. ایجاد تامین‌کننده تست...');
    const supplier = await prisma.supplier.create({
      data: {
        name: 'تامین‌کننده تست',
        phone: '09123456789',
        email: 'supplier@test.com',
      },
    });

    testIds.supplierId = supplier.id;
    console.log(`✓ تامین‌کننده ایجاد شد: ${testIds.supplierId}`);

    console.log('2. دریافت لیست تامین‌کنندگان...');
    const suppliersResult = await safeAction(
      () => getSuppliers(),
      'getSuppliers'
    );
    if (!suppliersResult.success || !suppliersResult.data) {
      throw new Error('لیست تامین‌کنندگان دریافت نشد');
    }
    const suppliers = Array.isArray(suppliersResult.data)
      ? suppliersResult.data
      : suppliersResult.data.data || [];
    console.log(`✓ ${suppliers.length} تامین‌کننده یافت شد`);
  });

  // ============================================
  // 6. تست ماژول کارمندان (Employees)
  // ============================================
  await testModule('کارمندان', async () => {
    console.log('1. ایجاد کارمند تست...');
    const employee = await prisma.employee.create({
      data: {
        name: 'کارمند تست',
        nationalId: '1234567890',
        phone: '09123456789',
        email: 'employee@test.com',
        position: 'تست',
        salary: 5000000,
        hireDate: new Date(),
      },
    });

    testIds.employeeId = employee.id;
    console.log(`✓ کارمند ایجاد شد: ${testIds.employeeId}`);

    console.log('2. دریافت لیست کارمندان...');
    const employeesResult = await safeAction(
      () => getEmployees(),
      'getEmployees'
    );
    if (!employeesResult.success || !employeesResult.data) {
      throw new Error('لیست کارمندان دریافت نشد');
    }
    console.log(`✓ ${employeesResult.data.length} کارمند یافت شد`);
  });

  // ============================================
  // 7. تست ماژول سهامداران (Shareholders)
  // ============================================
  await testModule('سهامداران', async () => {
    console.log('1. ایجاد سهامدار تست...');
    const shareholder = await prisma.shareholder.create({
      data: {
        name: 'سهامدار تست',
        percentage: 50,
        phone: '09123456789',
        email: 'shareholder@test.com',
      },
    });

    testIds.shareholderId = shareholder.id;
    console.log(`✓ سهامدار ایجاد شد: ${testIds.shareholderId}`);

    console.log('2. دریافت لیست سهامداران...');
    const shareholdersResult = await safeAction(
      () => getShareholders(),
      'getShareholders'
    );
    if (!shareholdersResult.success || !shareholdersResult.data) {
      throw new Error('لیست سهامداران دریافت نشد');
    }
    console.log(`✓ ${shareholdersResult.data.length} سهامدار یافت شد`);
  });

  // ============================================
  // خلاصه
  // ============================================
  console.log('\n' + '='.repeat(60));
  console.log('✅ خلاصه تست‌ها');
  console.log('='.repeat(60));
  console.log('✓ حساب‌ها');
  console.log('✓ محصولات');
  console.log('✓ انبارها');
  console.log('✓ مشتریان');
  console.log('✓ تامین‌کنندگان');
  console.log('✓ کارمندان');
  console.log('✓ سهامداران');
  console.log('\n🎉 همه تست‌های پایه با موفقیت انجام شد!');
  console.log('\n💡 حالا می‌توانید بخش‌های دیگر را تست کنید:');
  console.log('   - فروش (Sales)');
  console.log('   - خرید (Purchases)');
  console.log('   - موجودی (Inventory)');
  console.log('   - حسابداری (Accounting)');
  console.log('   - بازاریابی (Marketing)');
  console.log('   - حقوق و دستمزد (Payroll)');
  console.log('   - وام‌ها (Loans)');
  console.log('   - سود سهامداران (Shareholder Profits)');
}

main()
  .catch(e => {
    console.error('خطای غیرمنتظره:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

