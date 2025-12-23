
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowDownIcon, ArrowUpIcon, DollarSignIcon } from 'lucide-react';

interface ProfitLossCardProps {
  data: {
    totalIncome: number;
    totalExpense: number;
    netProfit: number;
  };
}

export function ProfitLossCard({ data }: ProfitLossCardProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">درآمد کل</CardTitle>
          <ArrowUpIcon className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {data.totalIncome.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">تومان</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">هزینه کل</CardTitle>
          <ArrowDownIcon className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">
            {data.totalExpense.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">تومان</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">سود خالص</CardTitle>
          <DollarSignIcon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${data.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {data.netProfit.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">تومان</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
