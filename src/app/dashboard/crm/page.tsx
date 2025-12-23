import { getCRMDashboardStats } from '@/actions/crm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, DollarSign, Ticket, TrendingUp, Activity } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { faIR } from 'date-fns/locale';

export default async function CRMDashboardPage() {
  const stats = await getCRMDashboardStats();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل مشتریان</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalCustomers}</div>
            <p className="text-xs text-muted-foreground">مشتری ثبت شده در سیستم</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ارزش فرصت‌های فعال</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat('fa-IR').format(stats.activeDealsValue)} تومان
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.activeDealsCount} فرصت فروش باز
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تیکت‌های باز</CardTitle>
            <Ticket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.openTicketsCount}</div>
            <p className="text-xs text-muted-foreground">نیاز به پاسخگویی</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">نرخ تبدیل</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">-- %</div>
            <p className="text-xs text-muted-foreground">نسبت سرنخ به مشتری</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>فرصت‌های فروش اخیر</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              {stats.recentDeals.length === 0 ? (
                <p className="text-sm text-muted-foreground">هیچ فرصت فروشی یافت نشد.</p>
              ) : (
                stats.recentDeals.map((deal) => (
                  <div key={deal.id} className="flex items-center">
                    <div className="ml-4 space-y-1">
                      <p className="text-sm font-medium leading-none">{deal.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {deal.customer.name}
                      </p>
                    </div>
                    <div className="mr-auto font-medium">
                      {new Intl.NumberFormat('fa-IR').format(Number(deal.value))} تومان
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>سرنخ‌های اخیر</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              {stats.recentLeads.length === 0 ? (
                <p className="text-sm text-muted-foreground">هیچ سرنخی یافت نشد.</p>
              ) : (
                stats.recentLeads.map((lead) => (
                  <div key={lead.id} className="flex items-center">
                    <div className="ml-4 space-y-1">
                      <p className="text-sm font-medium leading-none">{lead.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {lead.company || lead.email || lead.phone}
                      </p>
                    </div>
                    <div className="mr-auto text-sm text-muted-foreground">
                      {lead.status}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>برترین مشتریان (بر اساس فروش)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.topCustomers.length === 0 ? (
                <p className="text-sm text-muted-foreground">هیچ داده‌ای یافت نشد.</p>
              ) : (
                stats.topCustomers.map((customer, index) => (
                  <Link 
                    key={customer.id} 
                    href={`/dashboard/crm/customers/${customer.id}`}
                    className="flex items-center justify-between hover:bg-accent p-2 rounded-md transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <span className="text-sm font-medium">{index + 1}</span>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{customer.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {customer.email || 'بدون ایمیل'}
                        </p>
                      </div>
                    </div>
                    <div className="text-sm font-medium">
                      {new Intl.NumberFormat('fa-IR').format(customer.totalRevenue)} تومان
                    </div>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>فعالیت‌های اخیر</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">هیچ فعالیتی یافت نشد.</p>
              ) : (
                stats.recentActivity.map((activity) => (
                  <div key={activity.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                      {activity !== stats.recentActivity[stats.recentActivity.length - 1] && (
                        <div className="h-full w-px bg-border" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1 pb-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{activity.action}</p>
                        <Badge variant="outline" className="text-xs">
                          {formatDistanceToNow(new Date(activity.createdAt), { 
                            addSuffix: true,
                            locale: faIR 
                          })}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{activity.details}</p>
                      {activity.user && (
                        <p className="text-xs text-muted-foreground">
                          توسط {activity.user.name}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link href="/dashboard/crm/customers" className="block">
            <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
                <CardHeader>
                    <CardTitle className="text-center">مشتریان</CardTitle>
                </CardHeader>
            </Card>
        </Link>
        <Link href="/dashboard/crm/leads" className="block">
            <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
                <CardHeader>
                    <CardTitle className="text-center">سرنخ‌ها</CardTitle>
                </CardHeader>
            </Card>
        </Link>
        <Link href="/dashboard/crm/deals" className="block">
            <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
                <CardHeader>
                    <CardTitle className="text-center">فرصت‌های فروش</CardTitle>
                </CardHeader>
            </Card>
        </Link>
        <Link href="/dashboard/crm/support" className="block">
            <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
                <CardHeader>
                    <CardTitle className="text-center">پشتیبانی</CardTitle>
                </CardHeader>
            </Card>
        </Link>
      </div>
    </div>
  );
}

