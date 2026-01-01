/**
 * اسکریپت پاک کردن کامل تمام داده‌های دیتابیس
 * توجه: این اسکریپت همه چیز را حذف می‌کند (بجز schema)!
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDatabaseFull() {
  console.log('🗑️  شروع پاک کردن کامل تمام داده‌ها...\n');
  console.log('⚠️  هشدار: این عملیات همه چیز را حذف می‌کند!\n');

  try {
    // Delete in correct order to respect foreign key constraints
    console.log('📦 حذف OrderItems...');
    await prisma.orderItem.deleteMany({});

    console.log('📦 حذف Orders...');
    await prisma.order.deleteMany({});

    console.log('📦 حذف InvoiceItems...');
    await prisma.invoiceItem.deleteMany({});

    console.log('📦 حذف Invoices...');
    await prisma.invoice.deleteMany({});

    console.log('📦 حذف Transactions...');
    await prisma.transaction.deleteMany({});

    console.log('📦 حذف Inventory...');
    await prisma.inventory.deleteMany({});

    console.log('📦 حذف PurchaseOrderItems...');
    await prisma.purchaseOrderItem.deleteMany({});

    console.log('📦 حذف PurchaseOrders...');
    await prisma.purchaseOrder.deleteMany({});

    console.log('📦 حذف Products...');
    await prisma.product.deleteMany({});

    console.log('📦 حذف Customers...');
    await prisma.customer.deleteMany({});

    console.log('📦 حذف Suppliers...');
    await prisma.supplier.deleteMany({});

    console.log('📦 حذف Gifts...');
    await prisma.gift.deleteMany({});

    console.log('📦 حذف Tasks...');
    await prisma.task.deleteMany({});

    console.log('📦 حذف Accounts...');
    await prisma.account.deleteMany({});

    console.log('📦 حذف Warehouses...');
    await prisma.warehouse.deleteMany({});

    console.log('📦 حذف SystemSettings...');
    await prisma.systemSetting.deleteMany({});

    console.log('📦 حذف Users...');
    await prisma.user.deleteMany({});

    console.log('📦 حذف Sessions...');
    await prisma.session.deleteMany({});

    console.log('📦 حذف Accounts (Auth)...');
    await prisma.account.deleteMany({});

    console.log('📦 حذف VerificationTokens...');
    await prisma.verificationToken.deleteMany({});

    console.log('\n✨ تمام داده‌ها با موفقیت پاک شدند!');
    console.log('\n💡 دیتابیس حالا کاملاً خالی است.');
    console.log('   برای شروع دوباره، ابتدا یک کاربر جدید ایجاد کنید.');

  } catch (error) {
    console.error('\n❌ خطا در پاک کردن داده‌ها:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

resetDatabaseFull()
  .then(() => {
    console.log('\n✅ اسکریپت با موفقیت اجرا شد');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ اسکریپت با خطا مواجه شد');
    process.exit(1);
  });
