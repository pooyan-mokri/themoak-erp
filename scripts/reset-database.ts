/**
 * اسکریپت پاک کردن تمام داده‌های دیتابیس
 * توجه: این اسکریپت تمام داده‌ها را حذف می‌کند!
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDatabase() {
  console.log('🗑️  شروع پاک کردن تمام داده‌ها...\n');

  try {
    // Delete in correct order to respect foreign key constraints
    console.log('📦 حذف OrderItems...');
    await prisma.orderItem.deleteMany({});
    console.log('✅ OrderItems حذف شد');

    console.log('📦 حذف Orders...');
    await prisma.order.deleteMany({});
    console.log('✅ Orders حذف شد');

    console.log('📦 حذف InvoiceItems...');
    await prisma.invoiceItem.deleteMany({});
    console.log('✅ InvoiceItems حذف شد');

    console.log('📦 حذف Invoices...');
    await prisma.invoice.deleteMany({});
    console.log('✅ Invoices حذف شد');

    console.log('📦 حذف Transactions...');
    await prisma.transaction.deleteMany({});
    console.log('✅ Transactions حذف شد');

    console.log('📦 حذف Inventory...');
    await prisma.inventory.deleteMany({});
    console.log('✅ Inventory حذف شد');

    console.log('📦 حذف PurchaseOrderItems...');
    await prisma.purchaseOrderItem.deleteMany({});
    console.log('✅ PurchaseOrderItems حذف شد');

    console.log('📦 حذف PurchaseOrders...');
    await prisma.purchaseOrder.deleteMany({});
    console.log('✅ PurchaseOrders حذف شد');

    console.log('📦 حذف Products...');
    await prisma.product.deleteMany({});
    console.log('✅ Products حذف شد');

    console.log('📦 حذف Customers...');
    await prisma.customer.deleteMany({});
    console.log('✅ Customers حذف شد');

    console.log('📦 حذف Suppliers...');
    await prisma.supplier.deleteMany({});
    console.log('✅ Suppliers حذف شد');

    console.log('📦 حذف Gifts...');
    await prisma.gift.deleteMany({});
    console.log('✅ Gifts حذف شد');

    console.log('📦 حذف Tasks...');
    await prisma.task.deleteMany({});
    console.log('✅ Tasks حذف شد');

    console.log('📦 حذف SystemSettings (به جز تنظیمات مهم)...');
    // Keep important settings like WooCommerce config
    await prisma.systemSetting.deleteMany({
      where: {
        key: {
          notIn: [
            'woocommerce_url',
            'woocommerce_consumer_key',
            'woocommerce_consumer_secret',
            'woocommerce_warehouse_id',
            'woocommerce_account_id',
            'woocommerce_auto_sync_enabled',
            'woocommerce_auto_sync_interval',
          ]
        }
      }
    });
    console.log('✅ SystemSettings حذف شد (تنظیمات WooCommerce حفظ شد)');

    console.log('\n✨ تمام داده‌ها با موفقیت پاک شدند!');
    console.log('\n⚠️  توجه: موارد زیر حفظ شدند:');
    console.log('   - Users (کاربران)');
    console.log('   - Accounts (حساب‌های بانکی)');
    console.log('   - Warehouses (انبارها)');
    console.log('   - تنظیمات WooCommerce');
    console.log('\n💡 برای ریست کامل این موارد هم، دستور زیر را اجرا کنید:');
    console.log('   npx ts-node scripts/reset-database-full.ts');

  } catch (error) {
    console.error('\n❌ خطا در پاک کردن داده‌ها:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

resetDatabase()
  .then(() => {
    console.log('\n✅ اسکریپت با موفقیت اجرا شد');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ اسکریپت با خطا مواجه شد');
    process.exit(1);
  });
