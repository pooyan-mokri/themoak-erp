import { prisma } from './src/lib/prisma';
import { 
  getShareholders,
  depositShareholderFunds,
  withdrawShareholderFunds,
  getShareholderBalance,
  getShareholdersWithBalance
} from './src/actions/shareholder';
import { getAccounts } from './src/actions/accounting';
import { Prisma } from '@prisma/client';

// Helper function to safely call server actions
async function safeAction(action: Function, ...args: any[]) {
  try {
    return await action(...args);
  } catch (error: any) {
    if (
      error.digest?.startsWith('NEXT_REDIRECT') || 
      error.message === 'NEXT_REDIRECT' ||
      error.message?.includes('static generation store missing') ||
      error.message?.includes('Invariant: static generation store missing')
    ) {
      return { success: true, message: 'Action completed (revalidate/redirect skipped)' };
    }
    throw error;
  }
}

async function main() {
  console.log('=== تست سیستم طلب و بدهی سهامداران ===\n');

  let testShareholderId: string | undefined;
  let testAccountId: string | undefined;

  try {
    // 1. ایجاد سهامدار تست
    console.log('1. ایجاد سهامدار تست...');
    const shareholder = await prisma.shareholder.create({
      data: {
        name: `سهامدار تست ${Date.now()}`,
        percentage: new Prisma.Decimal(50),
        phone: '09123456789',
        email: `test${Date.now()}@example.com`
      }
    });
    testShareholderId = shareholder.id;
    console.log(`✓ سهامدار ایجاد شد: ${testShareholderId} (${shareholder.name})\n`);

    // 2. ایجاد حساب تست
    console.log('2. ایجاد حساب تست...');
    const account = await prisma.account.create({
      data: {
        name: `حساب تست ${Date.now()}`,
        type: 'CASH',
        currency: 'TOMAN',
        balance: new Prisma.Decimal(10000000)
      }
    });
    testAccountId = account.id;
    console.log(`✓ حساب ایجاد شد: ${testAccountId} (${account.name})\n`);

    // 3. واریز سرمایه توسط سهامدار (باید طلبکار شود)
    console.log('3. واریز سرمایه توسط سهامدار (سهامدار باید طلبکار شود)...');
    const depositFormData = new FormData();
    depositFormData.append('shareholderId', testShareholderId);
    depositFormData.append('accountId', testAccountId);
    depositFormData.append('amount', '5000000');
    depositFormData.append('currency', 'TOMAN');
    depositFormData.append('description', 'واریز تست');

    const depositResult = await safeAction(depositShareholderFunds, null, depositFormData);
    console.log('نتیجه واریز:', depositResult);

    // بررسی balance
    const balanceAfterDeposit = await getShareholderBalance(testShareholderId);
    console.log(`  موجودی پس از واریز: ${balanceAfterDeposit.toLocaleString('fa-IR')} تومان`);
    
    if (balanceAfterDeposit !== 5000000) {
      throw new Error(`موجودی صحیح نیست. انتظار: 5000000, دریافت: ${balanceAfterDeposit}`);
    }
    if (balanceAfterDeposit <= 0) {
      throw new Error('سهامدار باید طلبکار باشد (موجودی مثبت) اما مقدار منفی است');
    }
    console.log('✓ سهامدار به درستی طلبکار شد\n');

    // 4. برداشت سرمایه توسط سهامدار (باید بدهکار شود)
    console.log('4. برداشت سرمایه توسط سهامدار (سهامدار باید بدهکار شود)...');
    const withdrawFormData = new FormData();
    withdrawFormData.append('shareholderId', testShareholderId);
    withdrawFormData.append('accountId', testAccountId);
    withdrawFormData.append('amount', '2000000');
    withdrawFormData.append('currency', 'TOMAN');
    withdrawFormData.append('description', 'برداشت تست');

    const withdrawResult = await safeAction(withdrawShareholderFunds, null, withdrawFormData);
    console.log('نتیجه برداشت:', withdrawResult);

    // بررسی balance
    const balanceAfterWithdraw = await getShareholderBalance(testShareholderId);
    console.log(`  موجودی پس از برداشت: ${balanceAfterWithdraw.toLocaleString('fa-IR')} تومان`);
    
    const expectedBalance = 5000000 - 2000000; // 3000000
    if (balanceAfterWithdraw !== expectedBalance) {
      throw new Error(`موجودی صحیح نیست. انتظار: ${expectedBalance}, دریافت: ${balanceAfterWithdraw}`);
    }
    if (balanceAfterWithdraw <= 0) {
      throw new Error('سهامدار هنوز باید طلبکار باشد (موجودی مثبت) اما مقدار منفی است');
    }
    console.log('✓ موجودی به درستی محاسبه شد\n');

    // 5. برداشت بیشتر (باید بدهکار شود)
    console.log('5. برداشت بیشتر (سهامدار باید بدهکار شود)...');
    const withdrawFormData2 = new FormData();
    withdrawFormData2.append('shareholderId', testShareholderId);
    withdrawFormData2.append('accountId', testAccountId);
    withdrawFormData2.append('amount', '4000000');
    withdrawFormData2.append('currency', 'TOMAN');
    withdrawFormData2.append('description', 'برداشت تست دوم');

    const withdrawResult2 = await safeAction(withdrawShareholderFunds, null, withdrawFormData2);
    console.log('نتیجه برداشت دوم:', withdrawResult2);

    // بررسی balance (باید منفی شود)
    const balanceAfterWithdraw2 = await getShareholderBalance(testShareholderId);
    console.log(`  موجودی پس از برداشت دوم: ${balanceAfterWithdraw2.toLocaleString('fa-IR')} تومان`);
    
    const expectedBalance2 = 3000000 - 4000000; // -1000000
    if (balanceAfterWithdraw2 !== expectedBalance2) {
      throw new Error(`موجودی صحیح نیست. انتظار: ${expectedBalance2}, دریافت: ${balanceAfterWithdraw2}`);
    }
    if (balanceAfterWithdraw2 >= 0) {
      throw new Error('سهامدار باید بدهکار باشد (موجودی منفی) اما مقدار مثبت است');
    }
    console.log('✓ سهامدار به درستی بدهکار شد\n');

    // 6. بررسی لیست سهامداران با موجودی
    console.log('6. بررسی لیست سهامداران با موجودی...');
    const shareholdersWithBalance = await getShareholdersWithBalance();
    const testShareholder = shareholdersWithBalance.find(s => s.id === testShareholderId);
    
    if (!testShareholder) {
      throw new Error('سهامدار در لیست یافت نشد');
    }
    
    console.log(`  نام: ${testShareholder.name}`);
    console.log(`  موجودی/بدهی: ${testShareholder.balance.toLocaleString('fa-IR')} تومان`);
    
    if (testShareholder.balance !== expectedBalance2) {
      throw new Error(`موجودی در لیست صحیح نیست. انتظار: ${expectedBalance2}, دریافت: ${testShareholder.balance}`);
    }
    console.log('✓ لیست سهامداران با موجودی صحیح است\n');

    // 7. خلاصه تست
    console.log('=== خلاصه تست ===');
    console.log('✓ ایجاد سهامدار');
    console.log('✓ ایجاد حساب');
    console.log('✓ واریز سرمایه (سهامدار طلبکار شد)');
    console.log('✓ برداشت سرمایه (موجودی کاهش یافت)');
    console.log('✓ برداشت بیشتر (سهامدار بدهکار شد)');
    console.log('✓ محاسبه موجودی/بدهی');
    console.log('✓ لیست سهامداران با موجودی');
    console.log('\n✓✓✓ همه تست‌ها موفق بودند! ✓✓✓\n');

  } catch (error: any) {
    console.error('\n❌ خطا در تست:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // پاکسازی داده‌های تست
    if (testShareholderId) {
      console.log('\nپاکسازی داده‌های تست...');
      try {
        // حذف تراکنش‌ها
        await prisma.transaction.deleteMany({
          where: { shareholderId: testShareholderId }
        });
        
        // حذف سهامدار
        await prisma.shareholder.delete({
          where: { id: testShareholderId }
        });
        
        console.log('✓ داده‌های تست پاک شدند');
      } catch (cleanupError: any) {
        console.warn('هشدار در پاکسازی:', cleanupError.message);
      }
    }
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

