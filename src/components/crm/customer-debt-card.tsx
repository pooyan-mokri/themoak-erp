import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle } from "lucide-react";

interface CustomerDebtCardProps {
  creditLimit: number;
  totalDebt: number;
  paymentTerms: number;
}

export function CustomerDebtCard({ creditLimit, totalDebt, paymentTerms }: CustomerDebtCardProps) {
  const creditUsage = creditLimit > 0 ? (totalDebt / creditLimit) * 100 : 0;
  const isOverLimit = totalDebt > creditLimit && creditLimit > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">وضعیت اعتبار و بدهی</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-2xl font-bold">
                {new Intl.NumberFormat('fa-IR').format(totalDebt)} تومان
              </span>
              {isOverLimit && (
                <span className="flex items-center text-red-500 text-xs font-medium">
                  <AlertTriangle className="h-3 w-3 ml-1" />
                  بیش از حد اعتبار
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">کل بدهی جاری</p>
            
            {creditLimit > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>استفاده از اعتبار</span>
                  <span>{Math.round(creditUsage)}%</span>
                </div>
                <Progress value={creditUsage} className={isOverLimit ? "bg-red-100 [&>div]:bg-red-500" : ""} />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>0</span>
                  <span>سقف: {new Intl.NumberFormat('fa-IR').format(creditLimit)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">شرایط پرداخت</p>
              <p className="font-medium">{paymentTerms} روزه</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">وضعیت حساب</p>
              <div className="flex items-center mt-0.5">
                {totalDebt === 0 ? (
                    <span className="flex items-center text-green-600 text-sm">
                        <CheckCircle className="h-3 w-3 ml-1" />
                        تسویه
                    </span>
                ) : (
                    <span className="text-sm text-yellow-600">
                        دارای بدهی
                    </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
