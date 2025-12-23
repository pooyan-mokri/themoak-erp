
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package } from 'lucide-react';

interface SalesByProductProps {
  data: {
    name: string;
    quantity: number;
    total: number;
  }[];
}

export function SalesByProduct({ data }: SalesByProductProps) {
  return (
    <Card className="col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          فروش به تفکیک محصول
        </CardTitle>
        <Package className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground">داده‌ای برای نمایش وجود ندارد.</p>
          ) : (
            <div className="space-y-2">
              {data.slice(0, 5).map((item, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-muted-foreground text-xs">({item.quantity} عدد)</span>
                  </div>
                  <div className="font-bold">
                    {item.total.toLocaleString('fa-IR')} تومان
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
