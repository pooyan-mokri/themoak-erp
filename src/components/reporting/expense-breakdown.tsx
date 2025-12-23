
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart } from 'lucide-react';

interface ExpenseBreakdownProps {
  data: {
    category: string;
    amount: number;
  }[];
}

export function ExpenseBreakdown({ data }: ExpenseBreakdownProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          هزینه‌ها به تفکیک دسته‌بندی
        </CardTitle>
        <PieChart className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground">داده‌ای برای نمایش وجود ندارد.</p>
          ) : (
            <div className="space-y-2">
              {data.map((item, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{item.category}</span>
                  <div className="font-bold text-red-600">
                    {item.amount.toLocaleString('fa-IR')} تومان
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
