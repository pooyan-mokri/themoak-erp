import { prisma } from './src/lib/prisma';

async function main() {
  console.log('=== پاک‌سازی داده‌های تست ===\n');

  try {
    // 1. پیدا کردن کاربر ادمین
    console.log('1. پیدا کردن کاربر ادمین...');
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    if (!adminUser) {
      console.log('⚠️ هیچ کاربر ادمینی یافت نشد. یک کاربر ادمین ایجاد می‌شود...');
      // می‌توانیم یک کاربر ادمین ایجاد کنیم یا ادامه ندهیم
      // برای امنیت، بهتر است ادامه ندهیم
      throw new Error('هیچ کاربر ادمینی یافت نشد. لطفا ابتدا یک کاربر ادمین ایجاد کنید.');
    }

    console.log(`✓ کاربر ادمین یافت شد: ${adminUser.email} (${adminUser.name})\n`);

    // 2. حذف بازگشت و تعویض سفارشات (باید قبل از OrderItem حذف شوند)
    console.log('2. حذف بازگشت و تعویض سفارشات...');
    const deletedOrderExchanges = await prisma.orderExchange.deleteMany({});
    const deletedOrderReturns = await prisma.orderReturn.deleteMany({});
    console.log(`✓ ${deletedOrderReturns.count} بازگشت و ${deletedOrderExchanges.count} تعویض حذف شد\n`);

    // 3. حذف فاکتورها (باید قبل از Order حذف شوند)
    console.log('3. حذف فاکتورها...');
    const deletedInvoices = await prisma.invoice.deleteMany({});
    console.log(`✓ ${deletedInvoices.count} فاکتور حذف شد\n`);

    // 4. حذف تراکنش‌ها
    console.log('4. حذف تراکنش‌ها...');
    const deletedTransactions = await prisma.transaction.deleteMany({});
    console.log(`✓ ${deletedTransactions.count} تراکنش حذف شد\n`);

    // 5. حذف سفارش‌ها و آیتم‌های سفارش
    console.log('5. حذف سفارش‌ها...');
    const deletedOrderItems = await prisma.orderItem.deleteMany({});
    const deletedOrders = await prisma.order.deleteMany({});
    console.log(`✓ ${deletedOrders.count} سفارش و ${deletedOrderItems.count} آیتم سفارش حذف شد\n`);

    // 6. حذف موجودی انبار
    console.log('6. حذف موجودی انبار...');
    const deletedInventory = await prisma.inventory.deleteMany({});
    console.log(`✓ ${deletedInventory.count} رکورد موجودی حذف شد\n`);

    // 7. حذف سفارشات خرید (باید قبل از محصولات حذف شوند)
    console.log('7. حذف سفارشات خرید...');
    const deletedPurchaseOrderItems = await prisma.purchaseOrderItem.deleteMany({});
    const deletedAdditionalCosts = await prisma.purchaseOrderAdditionalCost.deleteMany({});
    const deletedArrivalCosts = await prisma.purchaseOrderArrivalCost.deleteMany({});
    const deletedPurchaseOrders = await prisma.purchaseOrder.deleteMany({});
    console.log(`✓ ${deletedPurchaseOrders.count} سفارش خرید حذف شد\n`);

    // 8. حذف داده‌های حسابرسی انبار (باید قبل از محصولات حذف شوند)
    console.log('8. حذف داده‌های حسابرسی انبار...');
    const deletedAuditTags = await prisma.inventoryAuditTag.deleteMany({});
    const deletedAuditItems = await prisma.inventoryAuditItem.deleteMany({});
    const deletedAuditTeams = await prisma.inventoryAuditTeam.deleteMany({});
    const deletedAuditSnapshots = await prisma.inventoryAuditSnapshot.deleteMany({});
    const deletedAudits = await prisma.inventoryAudit.deleteMany({});
    console.log(`✓ ${deletedAudits.count} حسابرسی حذف شد\n`);

    // 9. حذف هدایای بازاریابی (باید قبل از محصولات حذف شوند)
    console.log('9. حذف هدایای بازاریابی...');
    const deletedMarketingGifts = await prisma.marketingGift.deleteMany({});
    console.log(`✓ ${deletedMarketingGifts.count} هدیه حذف شد\n`);

    // 10. حذف محصولات
    console.log('10. حذف محصولات...');
    const deletedProducts = await prisma.product.deleteMany({});
    console.log(`✓ ${deletedProducts.count} محصول حذف شد\n`);

    // 11. حذف مشتریان
    console.log('11. حذف مشتریان...');
    const deletedCustomers = await prisma.customer.deleteMany({});
    console.log(`✓ ${deletedCustomers.count} مشتری حذف شد\n`);

    // 12. حذف تامین‌کنندگان
    console.log('12. حذف تامین‌کنندگان...');
    const deletedSuppliers = await prisma.supplier.deleteMany({});
    console.log(`✓ ${deletedSuppliers.count} تامین‌کننده حذف شد\n`);

    // 13. حذف کارمندان و داده‌های مرتبط
    console.log('13. حذف کارمندان...');
    const deletedPayrollPayments = await prisma.payrollPayment.deleteMany({});
    const deletedPayrolls = await prisma.payroll.deleteMany({});
    const deletedLoanPayments = await prisma.loanPayment.deleteMany({});
    const deletedLoans = await prisma.loan.deleteMany({});
    const deletedEmployees = await prisma.employee.deleteMany({});
    console.log(`✓ ${deletedEmployees.count} کارمند حذف شد\n`);

    // 14. حذف سهامداران و داده‌های مرتبط
    console.log('14. حذف سهامداران...');
    const deletedShareholderWithdrawals = await prisma.shareholderWithdrawal.deleteMany({});
    const deletedShareholderProfits = await prisma.shareholderProfit.deleteMany({});
    const deletedShareholders = await prisma.shareholder.deleteMany({});
    console.log(`✓ ${deletedShareholders.count} سهامدار حذف شد\n`);

    // 15. حذف پروژه‌ها و وظایف
    console.log('15. حذف پروژه‌ها...');
    const deletedTasks = await prisma.task.deleteMany({});
    const deletedProjects = await prisma.project.deleteMany({});
    console.log(`✓ ${deletedProjects.count} پروژه و ${deletedTasks.count} وظیفه حذف شد\n`);

    // 16. حذف کمپین‌های بازاریابی
    console.log('16. حذف کمپین‌های بازاریابی...');
    const deletedMarketingCampaigns = await prisma.marketingCampaign.deleteMany({});
    console.log(`✓ ${deletedMarketingCampaigns.count} کمپین حذف شد\n`);

    // 17. حذف انبارها (به جز انبارهای مجازی که ممکن است به مشتریان مرتبط باشند)
    console.log('17. حذف انبارها...');
    const deletedWarehouses = await prisma.warehouse.deleteMany({
      where: { isVirtual: false }
    });
    console.log(`✓ ${deletedWarehouses.count} انبار حذف شد\n`);

    // 18. حذف حساب‌ها (به جز حساب‌های سیستم)
    console.log('18. حذف حساب‌ها...');
    const deletedAccounts = await prisma.account.deleteMany({
      where: {
        name: {
          not: 'Marketing Expenses'
        }
      }
    });
    console.log(`✓ ${deletedAccounts.count} حساب حذف شد (حساب Marketing Expenses نگه داشته شد)\n`);

    // 19. حذف نرخ ارز
    console.log('19. حذف نرخ ارز...');
    const deletedExchangeRates = await prisma.exchangeRate.deleteMany({});
    console.log(`✓ ${deletedExchangeRates.count} نرخ ارز حذف شد\n`);

    // 20. حذف دارایی‌های ثابت
    console.log('20. حذف دارایی‌های ثابت...');
    const deletedFixedAssets = await prisma.fixedAsset.deleteMany({});
    console.log(`✓ ${deletedFixedAssets.count} دارایی ثابت حذف شد\n`);

    // 21. حذف CRM داده‌ها
    console.log('21. حذف داده‌های CRM...');
    const deletedDeals = await prisma.deal.deleteMany({});
    const deletedLeads = await prisma.lead.deleteMany({});
    const deletedPromotions = await prisma.promotion.deleteMany({});
    console.log(`✓ ${deletedLeads.count} سرنخ، ${deletedDeals.count} معامله، ${deletedPromotions.count} تبلیغ حذف شد\n`);

    // 22. حذف کاربران (به جز ادمین)
    console.log('22. حذف کاربران (به جز ادمین)...');
    const deletedUsers = await prisma.user.deleteMany({
      where: {
        id: { not: adminUser.id }
      }
    });
    console.log(`✓ ${deletedUsers.count} کاربر حذف شد (کاربر ادمین نگه داشته شد)\n`);

    // 23. حذف لاگ‌های فعالیت
    console.log('23. حذف لاگ‌های فعالیت...');
    const deletedActivityLogs = await prisma.activityLog.deleteMany({});
    console.log(`✓ ${deletedActivityLogs.count} لاگ فعالیت حذف شد\n`);

    // 24. حذف توکن‌های بازنشانی رمز عبور
    console.log('24. حذف توکن‌های بازنشانی رمز عبور...');
    const deletedPasswordTokens = await prisma.passwordResetToken.deleteMany({});
    console.log(`✓ ${deletedPasswordTokens.count} توکن حذف شد\n`);

    // 25. حذف داده‌های امانی
    console.log('25. حذف داده‌های امانی...');
    const deletedCommissions = await prisma.consignmentCommission.deleteMany({});
    const deletedConsignmentWarehouses = await prisma.warehouse.deleteMany({
      where: { isVirtual: true }
    });
    console.log(`✓ ${deletedCommissions.count} کمیسیون و ${deletedConsignmentWarehouses.count} انبار امانی حذف شد\n`);


    console.log('\n=== ✅ پاک‌سازی کامل شد ===');
    console.log(`✓ کاربر ادمین نگه داشته شد: ${adminUser.email}`);
    console.log('✓ تمام داده‌های تست حذف شدند\n');

  } catch (error: any) {
    console.error('\n❌ خطا در پاک‌سازی:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main()
  .catch(e => {
    console.error('خطای غیرمنتظره:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

