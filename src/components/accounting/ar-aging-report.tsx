import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ARAgingBucket {
  customerName: string;
  totalDue: number;
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  days90Plus: number;
}

interface ARAgingReportProps {
  data: ARAgingBucket[];
}

export function ARAgingReport({ data }: ARAgingReportProps) {
  const totals = data.reduce((acc, curr) => ({
    totalDue: acc.totalDue + curr.totalDue,
    current: acc.current + curr.current,
    days1_30: acc.days1_30 + curr.days1_30,
    days31_60: acc.days31_60 + curr.days31_60,
    days61_90: acc.days61_90 + curr.days61_90,
    days90Plus: acc.days90Plus + curr.days90Plus,
  }), {
    totalDue: 0,
    current: 0,
    days1_30: 0,
    days31_60: 0,
    days61_90: 0,
    days90Plus: 0,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>گزارش سنی حساب‌های دریافتنی</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">مشتری</TableHead>
                <TableHead className="text-right">کل بدهی</TableHead>
                <TableHead className="text-right">جاری</TableHead>
                <TableHead className="text-right">1-30 روز</TableHead>
                <TableHead className="text-right">31-60 روز</TableHead>
                <TableHead className="text-right">61-90 روز</TableHead>
                <TableHead className="text-right">+90 روز</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    هیچ داده‌ای یافت نشد.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {data.map((row, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{row.customerName}</TableCell>
                      <TableCell>{new Intl.NumberFormat('fa-IR').format(row.totalDue)}</TableCell>
                      <TableCell>{new Intl.NumberFormat('fa-IR').format(row.current)}</TableCell>
                      <TableCell>{new Intl.NumberFormat('fa-IR').format(row.days1_30)}</TableCell>
                      <TableCell>{new Intl.NumberFormat('fa-IR').format(row.days31_60)}</TableCell>
                      <TableCell>{new Intl.NumberFormat('fa-IR').format(row.days61_90)}</TableCell>
                      <TableCell className="text-red-600 font-medium">
                        {new Intl.NumberFormat('fa-IR').format(row.days90Plus)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted font-bold">
                    <TableCell>جمع کل</TableCell>
                    <TableCell>{new Intl.NumberFormat('fa-IR').format(totals.totalDue)}</TableCell>
                    <TableCell>{new Intl.NumberFormat('fa-IR').format(totals.current)}</TableCell>
                    <TableCell>{new Intl.NumberFormat('fa-IR').format(totals.days1_30)}</TableCell>
                    <TableCell>{new Intl.NumberFormat('fa-IR').format(totals.days31_60)}</TableCell>
                    <TableCell>{new Intl.NumberFormat('fa-IR').format(totals.days61_90)}</TableCell>
                    <TableCell className="text-red-600">
                      {new Intl.NumberFormat('fa-IR').format(totals.days90Plus)}
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
