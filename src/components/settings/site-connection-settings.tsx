'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { saveSiteConnection, syncSiteCatalogue, testSiteConnection } from '@/actions/site-connection';
import type { SiteConnectionForm } from '@/lib/site-connection';
import { formatJalaliDate } from '@/lib/date-utils';

const fa = (n: number) => n.toLocaleString('fa-IR');
const PREVIEW = 10;

function listPreview(values: string[]) {
  const shown = values.slice(0, PREVIEW).join('، ');
  return values.length > PREVIEW ? `${shown} و ${fa(values.length - PREVIEW)} مورد دیگر` : shown;
}

export function SiteConnectionSettings({ initial }: { initial: SiteConnectionForm }) {
  const router = useRouter();
  const [siteUrl, setSiteUrl] = useState(initial.siteUrl);
  const [secret, setSecret] = useState('');
  const [accountId, setAccountId] = useState(initial.paymentAccountId ?? '');
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId ?? '');
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'sync'>(null);

  const report = (ok: boolean, message: string) => (ok ? toast.success(message) : toast.error(message));

  const save = async () => {
    setBusy('save');
    try {
      const result = await saveSiteConnection({ siteUrl, webhookSecret: secret, paymentAccountId: accountId, warehouseId });
      report(result.success, result.message);
      if (result.success) {
        setSecret('');
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const result = await testSiteConnection();
      report(result.success, result.message);
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync');
    try {
      const result = await syncSiteCatalogue();
      report(result.ok, result.message);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const last = initial.lastSync;
  // Test and sync always use what is saved, so they wait until edits are saved.
  const unsaved = siteUrl.trim() !== initial.siteUrl || secret.trim() !== '';
  const usable = !!initial.siteUrl && initial.hasSecret && !unsaved;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>اتصال به سایت</CardTitle>
          <CardDescription>
            آدرس و رمزی که ERP با آن سایت را صدا می‌زند، و انتخاب‌هایی که فروش‌های سایت با آن ثبت می‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="siteUrl">آدرس سایت</Label>
            <Input
              id="siteUrl"
              dir="ltr"
              placeholder="https://api.themoak.com"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">همان آدرسی که کاتالوگ و وبهوک سایت روی آن هستند.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhookSecret">رمز وبهوک</Label>
            <Input
              id="webhookSecret"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              placeholder={initial.hasSecret ? '•••••••• ثبت شده؛ برای تغییر، رمز تازه را بنویسید' : 'از پنل سایت'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              جدا از توکنی است که سایت با آن ERP را صدا می‌زند. بعد از ذخیره دیگر نمایش داده نمی‌شود.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>حساب دریافت پول فروش سایت</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب حساب" />
                </SelectTrigger>
                <SelectContent>
                  {initial.accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>انبار سایت</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب انبار" />
                </SelectTrigger>
                <SelectContent>
                  {initial.warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy !== null || !siteUrl.trim() || !accountId || !warehouseId}>
              {busy === 'save' ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
            <Button variant="outline" onClick={test} disabled={busy !== null || !usable}>
              {busy === 'test' ? 'در حال آزمایش...' : 'آزمایش اتصال'}
            </Button>
          </div>
          {unsaved && (
            <p className="text-xs text-muted-foreground">آزمایش با مقادیر ذخیره‌شده انجام می‌شود؛ اول ذخیره کنید.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>عکس محصولات از سایت</CardTitle>
          <CardDescription>
            عکس روبه‌روی هر فریم و لینک صفحه‌اش در سایت، با «شناسهٔ سایت» خوانده می‌شود. هر روز یک بار هم خودکار
            اجرا می‌شود. کالایی که شناسهٔ سایت ندارد دست نمی‌خورد.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {last ? (
            <div className={`rounded-lg border p-3 text-sm ${last.ok ? '' : 'border-red-200 bg-red-50 dark:bg-red-950/30'}`}>
              <div className="font-medium">{last.message}</div>
              <div className="text-xs text-muted-foreground mt-1">
                آخرین اجرا: {formatJalaliDate(last.at)}{' '}
                {new Date(last.at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
              </div>
              {last.ok && (
                <ul className="text-xs text-muted-foreground mt-2 space-y-1">
                  <li>بدون تغییر: {fa(last.unchanged ?? 0)}</li>
                  {!!last.notInErp?.length && (
                    <li>
                      در سایت هست ولی هیچ کالایی در ERP این شناسه را ندارد ({fa(last.notInErp.length)}):{' '}
                      <span dir="ltr">{listPreview(last.notInErp)}</span>
                    </li>
                  )}
                  {!!last.notOnSite?.length && (
                    <li>
                      در ERP شناسه دارد ولی سایت برنگرداند ({fa(last.notOnSite.length)}):{' '}
                      <span dir="ltr">{listPreview(last.notOnSite)}</span>
                    </li>
                  )}
                  {!!last.skipped?.length && (
                    <li>
                      نادیده گرفته شد ({fa(last.skipped.length)}):{' '}
                      {listPreview(last.skipped.map((s) => `${s.key} (${s.why})`))}
                    </li>
                  )}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">هنوز اجرا نشده است.</p>
          )}
          <Button onClick={sync} disabled={busy !== null || !usable}>
            {busy === 'sync' ? 'در حال هم‌گام‌سازی...' : 'هم‌گام‌سازی الان'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
