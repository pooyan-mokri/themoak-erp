
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SalesChartProps {
  data: {
    topProducts: {
      name: string;
      quantity: number;
      total: number;
    }[];
  };
}

export function SalesChart({ data }: SalesChartProps) {
  return (
    <Card className="col-span-1">
      <CardHeader>
        <CardTitle>محصولات پرفروش</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center">داده‌ای موجود نیست.</p>
          ) : (
            data.topProducts.map((product, index) => (
              <div key={index} className="flex items-center">
                <div className="w-full space-y-1">
                  <div className="flex justify-between text-sm font-medium">
                    <span>{product.name}</span>
                    <span>{product.total.toLocaleString()}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{
                        width: `${(product.total / data.topProducts[0].total) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground text-left">
                    {product.quantity} عدد
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
