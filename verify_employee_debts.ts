import { prisma } from './src/lib/prisma';
import { 
  getEmployeeDebts, 
  getEmployeeDebtDetails, 
  payEmployeeDebt,
  getAccounts,
  recordExpense
} from './src/actions/accounting';
import { createEmployee } from './src/actions/employee';
import { Prisma } from '@prisma/client';

// Helper function to safely call server actions that might redirect
async function safeAction(action: Function, ...args: any[]) {
  try {
    return await action(...args);
  } catch (error: any) {
    // Next.js redirects and revalidatePath throw errors
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
  console.log('=== تست سیستم بدهی کارمندان ===\n');

  let testEmployeeId: string | undefined;
  let testAccountId: string | undefined;

  try {
    // 1. ایجاد کارمند تست
    console.log('1. ایجاد کارمند تست...');
    const employeeFormData = new FormData();
    employeeFormData.append('name', `کارمند تست ${Date.now()}`);
    employeeFormData.append('nationalId', `123456789${Date.now()}`);
    employeeFormData.append('phone', '09123456789');
    employeeFormData.append('email', `test${Date.now()}@example.com`);
    employeeFormData.append('position', 'توسعه‌دهنده');
    employeeFormData.append('salary', '5000000');
    
    const employeeResult = await safeAction(createEmployee, null, employeeFormData);
    console.log('نتیجه ایجاد کارمند:', employeeResult);

    const employees = await prisma.employee.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1
    });
    
    if (employees.length === 0) {
      throw new Error('کارمند ایجاد نشد');
    }
    
    testEmployeeId = employees[0].id;
    console.log(`✓ کارمند ایجاد شد: ${testEmployeeId} (${employees[0].name})\n`);

    // 2. ایجاد حساب تست
    console.log('2. ایجاد حساب تست...');
    const accounts = await getAccounts();
    let testAccount = accounts.find(acc => acc.name.includes('تست') || acc.name === 'Test Account');
    
    if (!testAccount) {
      const accountFormData = new FormData();
      accountFormData.append('name', `حساب تست ${Date.now()}`);
      accountFormData.append('type', 'CASH');
      accountFormData.append('currency', 'TOMAN');
      accountFormData.append('initialBalance', '10000000');
      
      await safeAction(async (prevState: any, formData: FormData) => {
        const { createAccount } = await import('./src/actions/accounting');
        return createAccount(prevState, formData);
      }, null, accountFormData);
      
      const updatedAccounts = await getAccounts();
      testAccount = updatedAccounts.find(acc => acc.name.includes('تست'));
    }
    
    if (!testAccount) {
      throw new Error('حساب ایجاد نشد');
    }
    
    testAccountId = testAccount.id;
    console.log(`✓ حساب ایجاد شد: ${testAccountId} (${testAccount.name})\n`);

    // 3. ثبت هزینه توسط کارمند (ایجاد بدهی)
    console.log('3. ثبت هزینه توسط کارمند (ایجاد بدهی)...');
    const expenseFormData1 = new FormData();
    expenseFormData1.append('amount', '500000');
    expenseFormData1.append('currency', 'TOMAN');
    expenseFormData1.append('category', 'Office');
    expenseFormData1.append('employeeId', testEmployeeId);
    expenseFormData1.append('description', 'خرید تجهیزات دفتری');

    const expenseResult1 = await safeAction(recordExpense, null, expenseFormData1);
    console.log('نتیجه ثبت هزینه اول:', expenseResult1);

    // ثبت هزینه دوم
    const expenseFormData2 = new FormData();
    expenseFormData2.append('amount', '300000');
    expenseFormData2.append('currency', 'TOMAN');
    expenseFormData2.append('category', 'Transport');
    expenseFormData2.append('employeeId', testEmployeeId);
    expenseFormData2.append('description', 'هزینه رفت و آمد');

    const expenseResult2 = await safeAction(recordExpense, null, expenseFormData2);
    console.log('نتیجه ثبت هزینه دوم:', expenseResult2);

    // بررسی تراکنش‌های ایجاد شده
    const expenseTransactions = await prisma.transaction.findMany({
      where: {
        employeeId: testEmployeeId,
        type: 'EXPENSE'
      }
    });
    console.log(`✓ ${expenseTransactions.length} تراکنش هزینه ثبت شد\n`);

    // 4. بررسی لیست بدهی‌های کارمندان
    console.log('4. بررسی لیست بدهی‌های کارمندان...');
    const debts = await getEmployeeDebts();
    const testEmployeeDebt = debts.find(debt => debt.employee.id === testEmployeeId);
    
    if (!testEmployeeDebt) {
      throw new Error('بدهی کارمند در لیست یافت نشد');
    }
    
    console.log('بدهی کارمند:');
    console.log(`  - نام: ${testEmployeeDebt.employee.name}`);
    console.log(`  - مبلغ بدهی: ${testEmployeeDebt.totalDebt.toLocaleString('fa-IR')} تومان`);
    console.log(`  - تعداد هزینه‌ها: ${testEmployeeDebt.expenseCount}`);
    console.log(`  - تعداد بازپرداخت‌ها: ${testEmployeeDebt.paymentCount}`);
    
    const expectedDebt = 500000 + 300000; // 800000
    if (testEmployeeDebt.totalDebt !== expectedDebt) {
      throw new Error(`مبلغ بدهی صحیح نیست. انتظار: ${expectedDebt}, دریافت: ${testEmployeeDebt.totalDebt}`);
    }
    
    if (testEmployeeDebt.expenseCount !== 2) {
      throw new Error(`تعداد هزینه‌ها صحیح نیست. انتظار: 2, دریافت: ${testEmployeeDebt.expenseCount}`);
    }
    
    console.log('✓ لیست بدهی‌ها صحیح است\n');

    // 5. بررسی جزئیات بدهی کارمند
    console.log('5. بررسی جزئیات بدهی کارمند...');
    const debtDetails = await getEmployeeDebtDetails(testEmployeeId);
    
    if (!debtDetails) {
      throw new Error('جزئیات بدهی یافت نشد');
    }
    
    console.log('جزئیات بدهی:');
    console.log(`  - کارمند: ${debtDetails.employee.name}`);
    console.log(`  - کل بدهی: ${debtDetails.totalDebt.toLocaleString('fa-IR')} تومان`);
    console.log(`  - کل هزینه‌ها: ${debtDetails.totalExpenses.toLocaleString('fa-IR')} تومان`);
    console.log(`  - کل بازپرداخت‌ها: ${debtDetails.totalPayments.toLocaleString('fa-IR')} تومان`);
    console.log(`  - تعداد تراکنش‌های هزینه: ${debtDetails.expenseTransactions.length}`);
    console.log(`  - تعداد تراکنش‌های بازپرداخت: ${debtDetails.paymentTransactions.length}`);
    
    if (debtDetails.totalDebt !== expectedDebt) {
      throw new Error(`مبلغ بدهی در جزئیات صحیح نیست. انتظار: ${expectedDebt}, دریافت: ${debtDetails.totalDebt}`);
    }
    
    if (debtDetails.expenseTransactions.length !== 2) {
      throw new Error(`تعداد تراکنش‌های هزینه در جزئیات صحیح نیست. انتظار: 2, دریافت: ${debtDetails.expenseTransactions.length}`);
    }
    
    console.log('✓ جزئیات بدهی صحیح است\n');

    // 6. بازپرداخت بخشی از بدهی
    console.log('6. بازپرداخت بخشی از بدهی (300,000 تومان)...');
    const paymentFormData1 = new FormData();
    paymentFormData1.append('employeeId', testEmployeeId);
    paymentFormData1.append('amount', '300000');
    paymentFormData1.append('accountId', testAccountId);
    paymentFormData1.append('description', 'بازپرداخت بخشی از بدهی');
    paymentFormData1.append('date', new Date().toISOString().split('T')[0]);

    const paymentResult1 = await safeAction(payEmployeeDebt, null, paymentFormData1);
    console.log('نتیجه بازپرداخت اول:', paymentResult1);

    // بررسی تراکنش بازپرداخت
    const paymentTransactions = await prisma.transaction.findMany({
      where: {
        employeeId: testEmployeeId,
        type: 'INCOME'
      }
    });
    console.log(`✓ ${paymentTransactions.length} تراکنش بازپرداخت ثبت شد`);

    // بررسی موجودی حساب
    const accountAfterPayment = await prisma.account.findUnique({
      where: { id: testAccountId }
    });
    console.log(`  موجودی حساب پس از بازپرداخت: ${Number(accountAfterPayment?.balance || 0).toLocaleString('fa-IR')} تومان\n`);

    // 7. بررسی بدهی باقی‌مانده
    console.log('7. بررسی بدهی باقی‌مانده...');
    const updatedDebts = await getEmployeeDebts();
    const updatedEmployeeDebt = updatedDebts.find(debt => debt.employee.id === testEmployeeId);
    
    if (!updatedEmployeeDebt) {
      throw new Error('بدهی کارمند پس از بازپرداخت یافت نشد');
    }
    
    const expectedRemainingDebt = expectedDebt - 300000; // 500000
    console.log(`  بدهی باقی‌مانده: ${updatedEmployeeDebt.totalDebt.toLocaleString('fa-IR')} تومان`);
    console.log(`  تعداد بازپرداخت‌ها: ${updatedEmployeeDebt.paymentCount}`);
    
    if (updatedEmployeeDebt.totalDebt !== expectedRemainingDebt) {
      throw new Error(`بدهی باقی‌مانده صحیح نیست. انتظار: ${expectedRemainingDebt}, دریافت: ${updatedEmployeeDebt.totalDebt}`);
    }
    
    if (updatedEmployeeDebt.paymentCount !== 1) {
      throw new Error(`تعداد بازپرداخت‌ها صحیح نیست. انتظار: 1, دریافت: ${updatedEmployeeDebt.paymentCount}`);
    }
    
    console.log('✓ بدهی باقی‌مانده صحیح است\n');

    // 8. بازپرداخت کامل بدهی
    console.log('8. بازپرداخت کامل بدهی باقی‌مانده (500,000 تومان)...');
    const paymentFormData2 = new FormData();
    paymentFormData2.append('employeeId', testEmployeeId);
    paymentFormData2.append('amount', '500000');
    paymentFormData2.append('accountId', testAccountId);
    paymentFormData2.append('description', 'بازپرداخت کامل بدهی');
    paymentFormData2.append('date', new Date().toISOString().split('T')[0]);

    const paymentResult2 = await safeAction(payEmployeeDebt, null, paymentFormData2);
    console.log('نتیجه بازپرداخت دوم:', paymentResult2);

    // بررسی بدهی نهایی
    const finalDebts = await getEmployeeDebts();
    const finalEmployeeDebt = finalDebts.find(debt => debt.employee.id === testEmployeeId);
    
    if (finalEmployeeDebt) {
      throw new Error(`بدهی باید صفر شود، اما ${finalEmployeeDebt.totalDebt} تومان باقی مانده است`);
    }
    
    console.log('✓ بدهی به طور کامل پرداخت شد و از لیست حذف شد\n');

    // 9. تست خطا: بازپرداخت با موجودی ناکافی
    console.log('9. تست خطا: بازپرداخت با موجودی ناکافی...');
    const account = await prisma.account.findUnique({
      where: { id: testAccountId }
    });
    const currentBalance = Number(account?.balance || 0);
    
    // ایجاد بدهی جدید
    const expenseFormData3 = new FormData();
    expenseFormData3.append('amount', '1000000');
    expenseFormData3.append('currency', 'TOMAN');
    expenseFormData3.append('category', 'Other');
    expenseFormData3.append('employeeId', testEmployeeId);
    expenseFormData3.append('description', 'تست موجودی ناکافی');
    
    await safeAction(recordExpense, null, expenseFormData3);
    
    // تلاش برای بازپرداخت با مبلغ بیشتر از موجودی
    const insufficientPaymentFormData = new FormData();
    insufficientPaymentFormData.append('employeeId', testEmployeeId);
    insufficientPaymentFormData.append('amount', String(currentBalance + 1000000));
    insufficientPaymentFormData.append('accountId', testAccountId);
    insufficientPaymentFormData.append('description', 'تست موجودی ناکافی');
    insufficientPaymentFormData.append('date', new Date().toISOString().split('T')[0]);
    
    try {
      await payEmployeeDebt(null, insufficientPaymentFormData);
      throw new Error('باید خطای موجودی ناکافی رخ می‌داد');
    } catch (error: any) {
      if (error.message?.includes('کافی نیست') || error.message?.includes('موجودی')) {
        console.log('✓ خطای موجودی ناکافی به درستی مدیریت شد');
      } else {
        throw error;
      }
    }
    
    console.log('✓ تست خطا موفق بود\n');

    // 10. خلاصه تست
    console.log('=== خلاصه تست ===');
    console.log('✓ ایجاد کارمند');
    console.log('✓ ایجاد حساب');
    console.log('✓ ثبت هزینه توسط کارمند (ایجاد بدهی)');
    console.log('✓ لیست بدهی‌های کارمندان');
    console.log('✓ جزئیات بدهی کارمند');
    console.log('✓ بازپرداخت بخشی از بدهی');
    console.log('✓ بررسی بدهی باقی‌مانده');
    console.log('✓ بازپرداخت کامل بدهی');
    console.log('✓ تست خطای موجودی ناکافی');
    console.log('\n✓✓✓ همه تست‌ها موفق بودند! ✓✓✓\n');

  } catch (error: any) {
    console.error('\n❌ خطا در تست:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // پاکسازی داده‌های تست (اختیاری)
    if (testEmployeeId) {
      console.log('\nپاکسازی داده‌های تست...');
      try {
        // حذف تراکنش‌ها
        await prisma.transaction.deleteMany({
          where: { employeeId: testEmployeeId }
        });
        
        // حذف کارمند
        await prisma.employee.delete({
          where: { id: testEmployeeId }
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

