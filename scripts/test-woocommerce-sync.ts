/**
 * Integration Test Script for WooCommerce Two-Way Sync
 *
 * This script tests:
 * 1. Price sync to WooCommerce
 * 2. Stock sync to WooCommerce
 * 3. Customer name generation from order billing data
 *
 * Usage: npx tsx scripts/test-woocommerce-sync.ts
 */

import { PrismaClient } from '@prisma/client';
import { updateProductPriceInWooCommerce, updateProductStockInWooCommerce } from '../src/actions/woocommerce';
import { getWooCommerceClient } from '../src/lib/woocommerce';

const prisma = new PrismaClient();

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message: string) {
  log(`✓ ${message}`, colors.green);
}

function error(message: string) {
  log(`✗ ${message}`, colors.red);
}

function info(message: string) {
  log(`ℹ ${message}`, colors.blue);
}

function section(message: string) {
  console.log('\n' + '='.repeat(60));
  log(message, colors.cyan);
  console.log('='.repeat(60));
}

async function cleanup() {
  await prisma.$disconnect();
}

async function testPriceSync() {
  section('Test 1: همگام‌سازی قیمت به WooCommerce');

  try {
    // Find a product with wooId
    const product = await prisma.product.findFirst({
      where: { wooId: { not: null } },
      select: { id: true, wooId: true, name: true, sellPrice: true }
    });

    if (!product) {
      error('هیچ محصولی با WooCommerce ID یافت نشد. ابتدا محصولات را سینک کنید.');
      return false;
    }

    info(`محصول انتخاب شده: ${product.name} (WooID: ${product.wooId})`);
    info(`قیمت فعلی: ${Number(product.sellPrice)} تومان`);

    // Test price update
    const newPrice = Number(product.sellPrice) + 1000; // Add 1000 Toman
    info(`قیمت جدید برای تست: ${newPrice} تومان`);

    const result = await updateProductPriceInWooCommerce(product.id, newPrice);

    if (result.success && result.data?.updated) {
      success('قیمت با موفقیت در WooCommerce آپدیت شد');

      // Verify in WooCommerce
      const wooCommerce = await getWooCommerceClient();
      const wooProduct = await wooCommerce.get(`products/${product.wooId}`);
      const wooPrice = parseFloat(wooProduct.data.regular_price);

      if (wooPrice === newPrice) {
        success(`تایید: قیمت در WooCommerce برابر است با ${wooPrice} تومان`);

        // Revert price back
        await updateProductPriceInWooCommerce(product.id, Number(product.sellPrice));
        info('قیمت به حالت اولیه برگردانده شد');
        return true;
      } else {
        error(`قیمت در WooCommerce (${wooPrice}) با قیمت ارسالی (${newPrice}) برابر نیست`);
        return false;
      }
    } else {
      error(result.message || 'خطا در آپدیت قیمت');
      return false;
    }
  } catch (err: any) {
    error(`خطا: ${err.message}`);
    return false;
  }
}

async function testStockSync() {
  section('Test 2: همگام‌سازی موجودی به WooCommerce');

  try {
    // Get WooCommerce warehouse ID
    const wooSettings = await prisma.setting.findUnique({
      where: { key: 'woo_settings' }
    });

    if (!wooSettings?.value || typeof wooSettings.value !== 'object' || !('warehouseId' in wooSettings.value)) {
      error('انبار WooCommerce در تنظیمات مشخص نشده است');
      return false;
    }

    const wooWarehouseId = (wooSettings.value as any).warehouseId;
    info(`انبار WooCommerce: ${wooWarehouseId}`);

    // Find a product in WooCommerce warehouse
    const inventory = await prisma.inventory.findFirst({
      where: {
        warehouseId: wooWarehouseId,
        product: { wooId: { not: null } }
      },
      include: { product: true }
    });

    if (!inventory) {
      error('هیچ محصولی در انبار WooCommerce یافت نشد');
      return false;
    }

    info(`محصول انتخاب شده: ${inventory.product.name} (WooID: ${inventory.product.wooId})`);
    info(`موجودی فعلی: ${inventory.quantity} عدد`);

    // Test stock update
    const newQuantity = inventory.quantity + 5; // Add 5 items
    info(`موجودی جدید برای تست: ${newQuantity} عدد`);

    const result = await updateProductStockInWooCommerce(
      inventory.product.id,
      wooWarehouseId,
      newQuantity
    );

    if (result.success && result.data?.updated) {
      success('موجودی با موفقیت در WooCommerce آپدیت شد');

      // Verify in WooCommerce
      const wooCommerce = await getWooCommerceClient();
      const wooProduct = await wooCommerce.get(`products/${inventory.product.wooId}`);
      const wooStock = parseInt(wooProduct.data.stock_quantity);

      if (wooStock === newQuantity) {
        success(`تایید: موجودی در WooCommerce برابر است با ${wooStock} عدد`);

        // Revert stock back
        await updateProductStockInWooCommerce(
          inventory.product.id,
          wooWarehouseId,
          inventory.quantity
        );
        info('موجودی به حالت اولیه برگردانده شد');
        return true;
      } else {
        error(`موجودی در WooCommerce (${wooStock}) با موجودی ارسالی (${newQuantity}) برابر نیست`);
        return false;
      }
    } else {
      error(result.message || 'خطا در آپدیت موجودی');
      return false;
    }
  } catch (err: any) {
    error(`خطا: ${err.message}`);
    return false;
  }
}

async function testNonWooCommerceWarehouse() {
  section('Test 3: آپدیت موجودی در انبار غیر WooCommerce');

  try {
    // Get WooCommerce warehouse ID
    const wooSettings = await prisma.setting.findUnique({
      where: { key: 'woo_settings' }
    });

    const wooWarehouseId = wooSettings?.value &&
      typeof wooSettings.value === 'object' &&
      'warehouseId' in wooSettings.value
      ? (wooSettings.value as any).warehouseId
      : null;

    // Find an inventory in a different warehouse
    const inventory = await prisma.inventory.findFirst({
      where: {
        warehouseId: { not: wooWarehouseId || undefined },
        product: { wooId: { not: null } }
      },
      include: { product: true, warehouse: true }
    });

    if (!inventory) {
      info('هیچ انبار دیگری یافت نشد - این تست رد می‌شود');
      return true;
    }

    info(`محصول: ${inventory.product.name}`);
    info(`انبار: ${inventory.warehouse.name}`);

    const result = await updateProductStockInWooCommerce(
      inventory.product.id,
      inventory.warehouseId,
      inventory.quantity + 10
    );

    if (result.success && !result.data?.updated) {
      success('به درستی از آپدیت در WooCommerce جلوگیری شد (انبار غیر WooCommerce)');
      return true;
    } else {
      error('نباید موجودی در WooCommerce آپدیت شود (انبار غیر WooCommerce است)');
      return false;
    }
  } catch (err: any) {
    error(`خطا: ${err.message}`);
    return false;
  }
}

async function testProductWithoutWooId() {
  section('Test 4: آپدیت محصول بدون WooCommerce ID');

  try {
    const product = await prisma.product.findFirst({
      where: { wooId: null },
      select: { id: true, name: true, sellPrice: true }
    });

    if (!product) {
      info('همه محصولات WooCommerce ID دارند - این تست رد می‌شود');
      return true;
    }

    info(`محصول بدون WooID: ${product.name}`);

    const result = await updateProductPriceInWooCommerce(
      product.id,
      Number(product.sellPrice) + 1000
    );

    if (result.success && !result.data?.updated) {
      success('به درستی از آپدیت در WooCommerce جلوگیری شد (محصول WooID ندارد)');
      return true;
    } else {
      error('نباید قیمت در WooCommerce آپدیت شود (محصول WooID ندارد)');
      return false;
    }
  } catch (err: any) {
    error(`خطا: ${err.message}`);
    return false;
  }
}

async function testCustomerNameGeneration() {
  section('Test 5: تولید نام مشتری از داده‌های billing');

  const testCases = [
    {
      name: 'نام کامل',
      billing: { first_name: 'علی', last_name: 'محمدی', email: 'ali@test.com' },
      expected: 'علی محمدی'
    },
    {
      name: 'فقط ایمیل',
      billing: { email: 'test@example.com' },
      expected: 'test@example.com'
    },
    {
      name: 'فقط تلفن',
      billing: { phone: '09123456789' },
      expected: '09123456789'
    },
    {
      name: 'بدون اطلاعات (با شماره سفارش)',
      billing: {},
      orderNumber: '123',
      expected: 'مشتری سفارش #123'
    }
  ];

  let allPassed = true;

  for (const testCase of testCases) {
    const billing = testCase.billing as any;
    let customerName = `${billing.first_name || ''} ${billing.last_name || ''}`.trim();

    if (!customerName && billing.email) {
      customerName = billing.email;
    } else if (!customerName && billing.phone) {
      customerName = billing.phone;
    } else if (!customerName) {
      customerName = `مشتری سفارش #${testCase.orderNumber || '0'}`;
    }

    if (customerName === testCase.expected) {
      success(`${testCase.name}: "${customerName}" ✓`);
    } else {
      error(`${testCase.name}: انتظار "${testCase.expected}" اما دریافت شد "${customerName}"`);
      allPassed = false;
    }
  }

  return allPassed;
}

async function runAllTests() {
  log('\n🧪 شروع تست همگام‌سازی دوطرفه WooCommerce\n', colors.cyan);

  const results = {
    priceSync: false,
    stockSync: false,
    nonWooWarehouse: false,
    noWooId: false,
    customerName: false
  };

  try {
    results.priceSync = await testPriceSync();
    results.stockSync = await testStockSync();
    results.nonWooWarehouse = await testNonWooCommerceWarehouse();
    results.noWooId = await testProductWithoutWooId();
    results.customerName = await testCustomerNameGeneration();

    // Summary
    section('خلاصه نتایج');
    console.log('');

    const tests = [
      { name: 'همگام‌سازی قیمت', passed: results.priceSync },
      { name: 'همگام‌سازی موجودی', passed: results.stockSync },
      { name: 'انبار غیر WooCommerce', passed: results.nonWooWarehouse },
      { name: 'محصول بدون WooID', passed: results.noWooId },
      { name: 'تولید نام مشتری', passed: results.customerName }
    ];

    tests.forEach(test => {
      if (test.passed) {
        success(test.name);
      } else {
        error(test.name);
      }
    });

    const totalPassed = tests.filter(t => t.passed).length;
    const totalTests = tests.length;

    console.log('');
    if (totalPassed === totalTests) {
      success(`همه تست‌ها موفق بودند! (${totalPassed}/${totalTests})`);
    } else {
      error(`${totalTests - totalPassed} تست ناموفق! (${totalPassed}/${totalTests} موفق)`);
      process.exit(1);
    }

  } catch (err: any) {
    error(`خطای کلی: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Run tests
runAllTests().catch(err => {
  console.error('Fatal error:', err);
  cleanup().then(() => process.exit(1));
});
