'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Area, AreaChart
} from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUp, ArrowDown, TrendingUp, ShoppingCart, DollarSign, Users, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SalesAnalyticsData {
  summary: {
    totalRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
    revenueGrowth: number;
    ordersGrowth: number;
  };
  salesOverTime: Array<{
    date: string;
    dateFormatted: string;
    revenue: number;
    orders: number;
  }>;
  topProducts: Array<{
    id: string;
    name: string;
    quantity: number;
    revenue: number;
  }>;
  topCustomers: Array<{
    id: string;
    name: string;
    orders: number;
    revenue: number;
  }>;
  categoryDistribution: Array<{
    type: string;
    revenue: number;
    quantity: number;
  }>;
  forecast: Array<{
    date: string;
    dateFormatted: string;
    revenue: number;
    orders: number;
    isForecast: boolean;
  }>;
}

interface SalesAnalyticsDashboardProps {
  data: SalesAnalyticsData;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

const getCategoryLabel = (type: string) => {
  const labels: Record<string, string> = {
    SALEABLE: 'قابل فروش',
    FIXED_ASSET: 'دارایی ثابت',
    CONSUMABLE: 'مصرفی',
  };
  return labels[type] || type;
};

export function SalesAnalyticsDashboard({ data }: SalesAnalyticsDashboardProps) {
  const { summary, salesOverTime, topProducts, topCustomers, categoryDistribution, forecast } = data;
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount));
  };

  // Combine actual and forecast data
  const combinedSalesData = [
    ...salesOverTime,
    ...forecast,
  ];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل فروش</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.totalRevenue)} تومان</div>
            <div className="flex items-center text-xs text-muted-foreground mt-1">
              {summary.revenueGrowth >= 0 ? (
                <>
                  <ArrowUp className="h-3 w-3 text-green-500 ml-1" />
                  <span className="text-green-500">
                    {summary.revenueGrowth.toFixed(1)}%
                  </span>
                </>
              ) : (
                <>
                  <ArrowDown className="h-3 w-3 text-red-500 ml-1" />
                  <span className="text-red-500">
                    {Math.abs(summary.revenueGrowth).toFixed(1)}%
                  </span>
                </>
              )}
              <span className="mr-1">نسبت به دوره قبل</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تعداد سفارشات</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalOrders.toLocaleString('fa-IR')}</div>
            <div className="flex items-center text-xs text-muted-foreground mt-1">
              {summary.ordersGrowth >= 0 ? (
                <>
                  <ArrowUp className="h-3 w-3 text-green-500 ml-1" />
                  <span className="text-green-500">
                    {summary.ordersGrowth.toFixed(1)}%
                  </span>
                </>
              ) : (
                <>
                  <ArrowDown className="h-3 w-3 text-red-500 ml-1" />
                  <span className="text-red-500">
                    {Math.abs(summary.ordersGrowth).toFixed(1)}%
                  </span>
                </>
              )}
              <span className="mr-1">نسبت به دوره قبل</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">میانگین فروش</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.averageOrderValue)} تومان</div>
            <p className="text-xs text-muted-foreground mt-1">
              میانگین هر سفارش
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">مشتریان فعال</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{topCustomers.length.toLocaleString('fa-IR')}</div>
            <p className="text-xs text-muted-foreground mt-1">
              در این دوره
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sales Trend with Forecast */}
      <Card>
        <CardHeader>
          <CardTitle>روند فروش و پیش‌بینی</CardTitle>
          <CardDescription>
            فروش واقعی (90 روز گذشته) و پیش‌بینی (7 روز آینده)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={combinedSalesData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#82ca9d" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="dateFormatted"
                style={{ fontSize: '11px' }}
                interval="preserveStartEnd"
              />
              <YAxis 
                tickFormatter={(value) => formatCurrency(value)}
                style={{ fontSize: '11px' }}
              />
              <Tooltip 
                formatter={(value: number) => [formatCurrency(value) + ' تومان', 'فروش']}
                labelStyle={{ textAlign: 'right' }}
              />
              <Legend 
                formatter={(value) => {
                  if (value === 'revenue') return 'فروش واقعی';
                  if (value === 'forecast') return 'پیش‌بینی';
                  return value;
                }}
              />
              <Area 
                type="monotone" 
                dataKey="revenue" 
                stroke="#8884d8" 
                fillOpacity={1} 
                fill="url(#colorRevenue)"
                name="revenue"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              <p className="text-sm text-blue-900 dark:text-blue-100">
                <strong>پیش‌بینی 7 روز آینده:</strong> بر اساس میانگین فروش 7 روز گذشته، 
                فروش روزانه حدود <strong>{formatCurrency(forecast[0]?.revenue || 0)} تومان</strong> پیش‌بینی می‌شود.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <Card>
          <CardHeader>
            <CardTitle>محصولات پرفروش</CardTitle>
            <CardDescription>10 محصول برتر بر اساس درآمد</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(value) => formatCurrency(value)} />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  width={120}
                  style={{ fontSize: '11px' }}
                />
                <Tooltip 
                  formatter={(value: number) => [formatCurrency(value) + ' تومان', 'درآمد']}
                />
                <Bar dataKey="revenue" fill="#3b82f6" name="درآمد" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Category Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>توزیع فروش بر اساس نوع محصول</CardTitle>
            <CardDescription>سهم هر دسته از کل فروش</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie
                  data={categoryDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry: any) => {
                    const dataEntry = entry as { type: string; percent: number };
                    return `${getCategoryLabel(dataEntry.type)} (${(dataEntry.percent * 100).toFixed(0)}%)`;
                  }}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="revenue"
                >
                  {categoryDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => [formatCurrency(value) + ' تومان', 'درآمد']}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Customers Table */}
      <Card>
        <CardHeader>
          <CardTitle>مشتریان برتر</CardTitle>
          <CardDescription>10 مشتری برتر بر اساس درآمد</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">رتبه</TableHead>
                <TableHead className="text-right">نام مشتری</TableHead>
                <TableHead className="text-right">تعداد سفارشات</TableHead>
                <TableHead className="text-right">کل خرید</TableHead>
                <TableHead className="text-right">میانگین خرید</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topCustomers.map((customer, index) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <Badge variant={index < 3 ? "default" : "outline"}>
                      #{index + 1}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell>{customer.orders.toLocaleString('fa-IR')}</TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(customer.revenue)} تومان
                  </TableCell>
                  <TableCell>
                    {formatCurrency(customer.revenue / customer.orders)} تومان
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Product Details Table */}
      <Card>
        <CardHeader>
          <CardTitle>جزئیات محصولات پرفروش</CardTitle>
          <CardDescription>اطلاعات کامل محصولات برتر</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">رتبه</TableHead>
                <TableHead className="text-right">نام محصول</TableHead>
                <TableHead className="text-right">تعداد فروش</TableHead>
                <TableHead className="text-right">کل درآمد</TableHead>
                <TableHead className="text-right">قیمت میانگین</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topProducts.map((product, index) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={index < 3 ? "default" : "outline"}>
                        #{index + 1}
                      </Badge>
                      {index < 3 && <Package className="h-3 w-3 text-yellow-500" />}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>{product.quantity.toLocaleString('fa-IR')} عدد</TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(product.revenue)} تومان
                  </TableCell>
                  <TableCell>
                    {formatCurrency(product.revenue / product.quantity)} تومان
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}


