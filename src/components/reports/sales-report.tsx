'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface SalesData {
  salesOverTime: Array<{
    period: string;
    revenue: number;
    orders: number;
  }>;
  salesByProduct: Array<{
    name: string;
    quantity: number;
    revenue: number;
  }>;
  salesByCustomer: Array<{
    name: string;
    orderCount: number;
    revenue: number;
  }>;
}

interface SalesReportProps {
  data: SalesData;
}

export function SalesReport({ data }: SalesReportProps) {
  const { salesOverTime, salesByProduct, salesByCustomer } = data;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(value)) + ' تومان';
  };

  const topProducts = salesByProduct.slice(0, 10);
  const topCustomers = salesByCustomer.slice(0, 10);

  const totalRevenue = salesOverTime.reduce((sum, item) => sum + item.revenue, 0);
  const totalOrders = salesOverTime.reduce((sum, item) => sum + item.orders, 0);
const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>فروش کل</CardDescription>
            <CardTitle className="text-2xl text-green-600">
              {formatCurrency(totalRevenue)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>تعداد سفارش</CardDescription>
            <CardTitle className="text-2xl">
              {totalOrders.toLocaleString('fa-IR')}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>میانگین ارزش سفارش</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(avgOrderValue)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Sales Trend */}
      <Card>
        <CardHeader>
          <CardTitle>روند فروش</CardTitle>
          <CardDescription>فروش در طول زمان</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={salesOverTime}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" />
              <YAxis />
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#10b981" name="فروش" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Products */}
      <Card>
        <CardHeader>
          <CardTitle>محصولات پرفروش</CardTitle>
          <CardDescription>10 محصول برتر</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topProducts} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={150} />
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              <Bar dataKey="revenue" fill="#3b82f6" name="فروش" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Customers */}
      <Card>
        <CardHeader>
          <CardTitle>مشتریان برتر</CardTitle>
          <CardDescription>10 مشتری برتر بر اساس فروش</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>مشتری</TableHead>
                <TableHead className="text-right">تعداد سفارش</TableHead>
                <TableHead className="text-right">فروش کل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topCustomers.map((customer, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell className="text-right">{customer.orderCount}</TableCell>
                  <TableCell className="text-right">{formatCurrency(customer.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
