'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  disableStockPush,
  enableStockPush,
  getSiteHookPanel,
  previewStockPush,
  releaseStockHold,
  resyncStockPush,
  retryStockPush,
  saveSiteConnection,
  syncSiteCatalogue,
  testSiteConnection,
  type SiteHookPanel,
} from '@/actions/site-connection';
import type { SiteConnectionForm } from '@/lib/site-connection';
import type { StockPushPreview } from '@/lib/site-hook';
import { formatJalaliDate } from '@/lib/date-utils';

const fa = (n: number) => n.toLocaleString('fa-IR');
const PREVIEW = 10;

function listPreview(values: string[]) {
  const shown = values.slice(0, PREVIEW).join('، ');
  return values.length > PREVIEW ? `${shown} و ${fa(values.length - PREVIEW)} مورد دیگر` : shown;
}

function when(iso: string) {
  return `${formatJalaliDate(iso)} ${new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}`;
}

function age(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'کمتر از یک دقیقه';
  if (minutes < 120) return `${fa(minutes)} دقیقه`;
  if (minutes < 2_880) return `${fa(Math.floor(minutes / 60))} ساعت`;
  return `${fa(Math.floor(minutes / 1_440))} روز`;
}

type Busy = 'save' | 'test' | 'sync' | 'check' | 'enable' | 'disable' | 'resync' | 'release' | 'retry';
/** A site check, and what its confirm button does: switch on, or send everything again. */
type Preview = { purpose: 'enable' | 'resync'; result: Extract<StockPushPreview, { ok: true }> };

export function SiteConnectionSettings({ initial }: { initial: SiteConnectionForm }) {
  const router = useRouter();
  const [siteUrl, setSiteUrl] = useState(initial.siteUrl);
  const [secret, setSecret] = useState('');
  const [accountId, setAccountId] = useState(initial.paymentAccountId ?? '');
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId ?? '');
  const [busy, setBusy] = useState<null | Busy>(null);
  const [panel, setPanel] = useState<SiteHookPanel | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const report = (ok: boolean, message: string) => (ok ? toast.success(message) : toast.error(message));

  const loadPanel = useCallback(async () => {
    const result = await getSiteHookPanel();
    if (result.success) setPanel(result);
    else toast.error(result.message);
  }, []);

  useEffect(() => {
    loadPanel().catch(() => toast.error('وضعیت ارسال موجودی خوانده نشد.'));
  }, [loadPanel]);

  const save = async () => {
    setBusy('save');
    try {
      const result = await saveSiteConnection({ siteUrl, webhookSecret: secret, paymentAccountId: accountId, warehouseId });
      report(result.success, result.message);
      if (result.success) {
        setSecret('');
        setPreview(null);
        router.refresh();
        await loadPanel();
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

  const check = async (purpose: Preview['purpose']) => {
    setBusy('check');
    setPreview(null);
    try {
      const result = await previewStockPush();
      if (result.success) setPreview({ purpose, result: result.preview });
      else toast.error(result.message);
    } finally {
      setBusy(null);
    }
  };

  const run = async (kind: Busy, action: () => Promise<{ success: boolean; message: string }>) => {
    setBusy(kind);
    try {
      const result = await action();
      report(result.success, result.message);
      if (result.success) {
        setPreview(null);
        router.refresh();
      }
      // The action already answered: a failed reload must not read as the action failing.
      await loadPanel().catch(() => toast.error('وضعیت ارسال موجودی خوانده نشد.'));
    } catch {
      toast.error('انجام نشد؛ صفحه را تازه کنید و دوباره امتحان کنید.');
    } finally {
      setBusy(null);
    }
  };

  const last = initial.lastSync;
  // Test and sync always use what is saved, so they wait until edits are saved.
  const unsaved = siteUrl.trim() !== initial.siteUrl || secret.trim() !== '';
  const usable = !!initial.siteUrl && initial.hasSecret && !unsaved;
  // The site check also uses the saved warehouse.
  const pushUsable = usable && warehouseId === (initial.warehouseId ?? '');
  const warehouseName = (id: string) => initial.warehouses.find((w) => w.id === id)?.name ?? id;

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

      <Card>
        <CardHeader>
          <CardTitle>ارسال موجودی به سایت</CardTitle>
          <CardDescription>
            موجودی انبار سایت با «شناسهٔ سایت» به سایت فرستاده می‌شود؛ فقط تعداد، نه قیمت. هر تغییر موجودی چند
            دقیقه‌ای به سایت می‌رسد.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!panel ? (
            <p className="text-sm text-muted-foreground">در حال خواندن وضعیت...</p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                وضعیت:
                <Badge variant={panel.enabled ? 'default' : 'secondary'}>{panel.enabled ? 'روشن' : 'خاموش'}</Badge>
              </div>

              <div className="rounded-md border border-amber-500 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                فقط وقتی روشن کنید که سایت تأیید کرده باشد: کالاها را فقط با شناسهٔ سایت (webId) تطبیق می‌دهد، در
                createSale برای هر قلم webId می‌فرستد، و ثبت فروش‌هایش در ERP روشن است. وگرنه موجودی فریمی که فروشش
                هنوز در ERP ثبت نشده به سایت برمی‌گردد و فریم دو بار فروخته می‌شود.
              </div>

              <div className="flex flex-wrap gap-2">
                {panel.enabled ? (
                  <Button variant="outline" onClick={() => run('disable', disableStockPush)} disabled={busy !== null}>
                    {busy === 'disable' ? 'در حال خاموش کردن...' : 'خاموش کردن'}
                  </Button>
                ) : (
                  <Button onClick={() => check('enable')} disabled={busy !== null || !pushUsable}>
                    {busy === 'check' ? 'در حال بررسی...' : 'بررسی سایت'}
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => check('resync')}
                  disabled={busy !== null || !panel.enabled || !pushUsable}
                >
                  {busy === 'check' && panel.enabled ? 'در حال بررسی...' : 'ارسال دوبارهٔ همهٔ موجودی'}
                </Button>
              </div>
              {!pushUsable && (
                <p className="text-xs text-muted-foreground">
                  بررسی سایت با آدرس، رمز و انبار ذخیره‌شده انجام می‌شود؛ اول آن‌ها را ذخیره کنید.
                </p>
              )}

              {preview && (
                <div className="rounded-lg border p-3 text-sm space-y-2">
                  <div className="font-medium">
                    سایت تأیید کرد که موجودی انبار «{warehouseName(preview.result.warehouseId)}» (
                    <span dir="ltr">{preview.result.warehouseId}</span>) را می‌گیرد.
                  </div>
                  <ul className="text-xs space-y-1">
                    <li className={preview.result.goingOut.length ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}>
                      در سایت موجود است ولی در ERP نه، پس در سایت ناموجود می‌شود: {fa(preview.result.goingOut.length)}
                      {!!preview.result.goingOut.length && (
                        <div dir="ltr" className="mt-1 text-right">
                          {preview.result.goingOut.join('، ')}
                        </div>
                      )}
                    </li>
                    <li className="text-muted-foreground">
                      در سایت ناموجود است و در ERP موجود، پس دوباره موجود می‌شود: {fa(preview.result.comingIn.length)}
                      {!!preview.result.comingIn.length && (
                        <>
                          {' '}
                          <span dir="ltr">{listPreview(preview.result.comingIn)}</span>
                        </>
                      )}
                    </li>
                    <li className="text-muted-foreground">بدون تغییر: {fa(preview.result.unchanged)}</li>
                    <li className="text-muted-foreground">
                      در ERP شناسه دارد ولی در سایت نیست: {fa(preview.result.notOnSite.length)}
                      {!!preview.result.notOnSite.length && (
                        <>
                          {' '}
                          <span dir="ltr">{listPreview(preview.result.notOnSite)}</span>
                        </>
                      )}
                    </li>
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        preview.purpose === 'enable'
                          ? run('enable', () => enableStockPush(preview.result.goingOut))
                          : run('resync', () => resyncStockPush(preview.result.goingOut))
                      }
                      disabled={busy !== null}
                    >
                      {busy === 'enable' || busy === 'resync'
                        ? 'در حال انجام...'
                        : preview.purpose === 'enable'
                          ? 'تأیید و روشن کردن'
                          : 'تأیید و ارسال دوباره'}
                    </Button>
                    <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy !== null}>
                      انصراف
                    </Button>
                  </div>
                </div>
              )}

              {panel.enabled && (
                <div
                  className={`rounded-lg border p-3 text-sm space-y-1 ${
                    panel.status.paused || panel.status.failingSince ? 'border-red-200 bg-red-50 dark:bg-red-950/30' : ''
                  }`}
                >
                  <div>آخرین ارسال موفق: {panel.status.lastOkAt ? when(panel.status.lastOkAt) : 'هنوز نه'}</div>
                  {panel.status.failingSince && <div>ناموفق از: {when(panel.status.failingSince)}</div>}
                  {panel.status.paused ? (
                    <div className="space-y-2 pt-1">
                      <div className="font-medium">ارسال خودکار متوقف شد: {panel.status.paused.why}</div>
                      <div className="text-xs text-muted-foreground">
                        از {when(panel.status.paused.at)}؛ تا آن وقت هر ۱۰ دقیقه یک بار امتحان می‌شود. بعد از درست
                        کردن تنظیمات سایت یا ERP، «تلاش دوباره» را بزنید.
                      </div>
                      <Button size="sm" variant="outline" onClick={() => run('retry', retryStockPush)} disabled={busy !== null}>
                        {busy === 'retry' ? 'در حال انجام...' : 'تلاش دوباره'}
                      </Button>
                    </div>
                  ) : (
                    panel.status.lastMessage && (
                      <div className="text-xs text-muted-foreground">{panel.status.lastMessage}</div>
                    )
                  )}
                  <div>
                    تغییرهای ارسال‌نشده: {fa(panel.pending)}
                    {panel.oldestPendingAt && ` (قدیمی‌ترین: ${age(panel.oldestPendingAt)} پیش)`}
                  </div>
                </div>
              )}

              {panel.hold?.state === 'held' && (
                <div className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 space-y-2">
                  <div className="font-medium">
                    {fa(panel.hold.webIds.length)} فریم منتظر تأیید شما برای ناموجود شدن در سایت
                  </div>
                  <p className="text-xs">
                    موجودی این فریم‌ها در ERP به صفر رسیده، ولی چون فریم‌های زیادی با هم ناموجود می‌شدند ارسالشان از{' '}
                    {when(panel.hold.since)} نگه داشته شده است. تا آزاد نکنید در سایت موجود می‌مانند و فروخته
                    می‌شوند. اگر صفر شدنشان درست است آزاد کنید؛ اگر نه، اول موجودی ERP را درست کنید. فریمی که
                    موجودی‌اش در ERP بیشتر از صفر شود، خودش از این فهرست بیرون می‌رود و با ارسال بعدی فرستاده می‌شود.
                  </p>
                  <div dir="ltr" className="text-xs text-right">
                    {panel.hold.webIds.join('، ')}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => run('release', () => releaseStockHold(panel.hold?.webIds ?? []))}
                    disabled={busy !== null}
                  >
                    {busy === 'release' ? 'در حال آزاد کردن...' : 'آزاد کردن'}
                  </Button>
                </div>
              )}

              {panel.skipped.length > 0 && (
                <div className="text-sm space-y-1">
                  <div className="font-medium">شناسه‌هایی که سایت نپذیرفت ({fa(panel.skipped.length)})</div>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    {panel.skipped.map((s) => (
                      <li key={s.webId}>
                        <span dir="ltr">{s.webId}</span>: {s.why}
                        {s.at && ` (${when(s.at)})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
