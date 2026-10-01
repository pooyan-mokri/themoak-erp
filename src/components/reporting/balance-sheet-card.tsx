
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface BalanceSheetCardProps {
  data: {
    assets: {
      cashAndBank: number;
      inventory: number;
      consignmentInventory?: number;
      accountsReceivable: number;
      prepaidPurchases?: number;
      rentDeposits?: number;
      partnerLoans?: number;
      total: number;
    };
    liabilities: {
      accountsPayable?: number;
      total: number;
    };
    equity: {
      total: number;
    };
  };
}

export function BalanceSheetCard({ data }: BalanceSheetCardProps) {
  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle>ترازنامه (وضعیت مالی)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">دارایی‌ها</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between border-b pb-1">
                <span>نقد و بانک:</span>
                <span>{data.assets.cashAndBank.toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex justify-between border-b pb-1">
                <span>ارزش موجودی کالا (انبار خودی):</span>
                <span>{data.assets.inventory.toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex justify-between border-b pb-1">
                <span>کالای امانی نزد همکاران:</span>
                <span>{(data.assets.consignmentInventory ?? 0).toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex justify-between border-b pb-1">
                <span>حساب‌های دریافتنی:</span>
                <span>{data.assets.accountsReceivable.toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex justify-between border-b pb-1">
                <span>پیش‌پرداخت خرید:</span>
                <span>{(data.assets.prepaidPurchases ?? 0).toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex justify-between border-b pb-1">
                <span>ودیعه‌ها:</span>
                <span>{(data.assets.rentDeposits ?? 0).toLocaleString('fa-IR')}</span>
              </div>
              {data.assets.partnerLoans ? (
                <div className="flex justify-between border-b pb-1">
                  <span>طلب از شرکا:</span>
                  <span>{data.assets.partnerLoans.toLocaleString('fa-IR')}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-bold pt-1">
                <span>جمع دارایی‌ها:</span>
                <span>{data.assets.total.toLocaleString('fa-IR')}</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="text-sm font-semibold mb-2">بدهی‌ها و حقوق صاحبان سهام</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between border-b pb-1">
                <span>بدهی به تأمین‌کنندگان:</span>
                <span>{(data.liabilities.accountsPayable ?? 0).toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex justify-between border-b pb-1">
                <span>جمع بدهی‌ها:</span>
                <span>{data.liabilities.total.toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex justify-between font-bold pt-1">
                <span>حقوق صاحبان سهام:</span>
                <span>{data.equity.total.toLocaleString('fa-IR')}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
