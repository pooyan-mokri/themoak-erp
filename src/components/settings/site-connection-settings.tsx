'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
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
import { FieldRow, PanelActions, SettingsPanel, StatusNote } from './settings-panel';
import type { SiteOrderRow, SiteOrderSummary } from './site-orders';

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

/** An order's state as on the orders page: cancelled, or how far it is paid. */
function orderStatus(o: Pick<SiteOrderRow, 'status' | 'paymentStatus'>) {
  if (o.status === 'CANCELLED') return { label: 'لغو شده', tone: 'bg-danger-soft text-danger' };
  if (o.paymentStatus === 'PAID') return { label: 'پرداخت شده', tone: 'bg-success-soft text-success' };
  if (o.paymentStatus === 'PARTIAL') return { label: 'پرداخت جزئی', tone: 'bg-brand-soft text-brand' };
  return { label: 'پرداخت نشده', tone: 'bg-warning-soft text-warning' };
}

const NO_ORDERS: SiteOrderSummary = { today: 0, week: 0, revenue7d: 0, total: 0, recent: [] };

type Busy = 'save' | 'test' | 'sync' | 'check' | 'enable' | 'disable' | 'resync' | 'release' | 'retry';
/** A site check, and what its confirm button does: switch on, or send everything again. */
type Preview = { purpose: 'enable' | 'resync'; result: Extract<StockPushPreview, { ok: true }> };

export function SiteConnectionSettings({
  initial,
  siteOrders = NO_ORDERS,
}: {
  initial: SiteConnectionForm;
  /** The website's orders from the ERP: today, 7 days and the latest few. */
  siteOrders?: SiteOrderSummary;
}) {
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

  // The connection at a glance, from what is saved and the stock push panel.
  const connection: { label: string; tone: string; note: string } = !initial.siteUrl || !initial.hasSecret
    ? { label: 'تنظیم نشده', tone: 'bg-warning-soft text-warning', note: 'آدرس سایت و رمز وبهوک را ذخیره کنید.' }
    : !panel
      ? { label: 'در حال خواندن', tone: 'bg-secondary text-muted-foreground', note: 'وضعیت ارسال موجودی خوانده می‌شود.' }
      : !panel.enabled
        ? { label: 'ارسال موجودی خاموش', tone: 'bg-secondary text-muted-foreground', note: 'فروش‌های سایت ثبت می‌شوند؛ موجودی فرستاده نمی‌شود.' }
        : panel.status.paused
          ? { label: 'ارسال متوقف شده', tone: 'bg-danger-soft text-danger', note: panel.status.paused.why }
          : panel.status.failingSince
            ? { label: 'ارسال ناموفق', tone: 'bg-danger-soft text-danger', note: `از ${when(panel.status.failingSince)}` }
            : {
                label: 'برقرار',
                tone: 'bg-success-soft text-success',
                note: panel.status.lastOkAt ? `آخرین ارسال موفق: ${when(panel.status.lastOkAt)}` : 'هنوز ارسالی نشده',
              };
  const matched = last?.ok ? (last.updated ?? 0) + (last.unchanged ?? 0) : null;

  return (
    <>
      {/* The site at a glance */}
      <div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-x-reverse">
        <div className="border-b p-4 lg:border-b-0">
          <p className="text-xs text-muted-foreground">وضعیت اتصال</p>
          <span className={cn('mt-2 inline-flex rounded-full px-2 py-0.5 text-[11.5px]', connection.tone)}>{connection.label}</span>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">{connection.note}</p>
        </div>
        <div className="border-b p-4 lg:border-b-0">
          <p className="text-xs text-muted-foreground">سفارش‌های سایت امروز</p>
          <p className="mt-1.5 text-[19px] font-medium tabular-nums">{fa(siteOrders.today)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{fa(siteOrders.week)} سفارش در ۷ روز اخیر · بدون لغوشده‌ها</p>
        </div>
        <div className="border-b p-4 sm:border-b-0">
          <p className="text-xs text-muted-foreground">فروش سایت در ۷ روز</p>
          <p className="mt-1.5 text-[19px] font-medium tabular-nums">
            {fa(Math.round(siteOrders.revenue7d))}
            <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">مبلغ پس از تخفیف</p>
        </div>
        <div className="p-4">
          <p className="text-xs text-muted-foreground">کالاهای جفت‌شده با سایت</p>
          <p className="mt-1.5 text-[19px] font-medium tabular-nums">{matched === null ? '—' : fa(matched)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {matched === null ? 'هنوز هم‌گام‌سازی موفقی نبوده' : `از ${fa(last?.read ?? 0)} کالای سایت، در آخرین هم‌گام‌سازی`}
            {panel && (
              <>
                {' · '}
                <span className={panel.pending ? 'text-warning' : undefined}>{fa(panel.pending)} تغییر در صف</span>
                {' · '}
                <span className={panel.skipped.length ? 'text-danger' : undefined}>{fa(panel.skipped.length)} رد شده</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Latest website orders */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            سفارش‌های سایت
            <span className="rounded bg-secondary px-1.5 font-mono text-[11px] font-normal text-muted-foreground">{fa(siteOrders.total)}</span>
          </h3>
          <Link href="/dashboard/sales/history" className="text-xs text-brand hover:underline">
            همه سفارش‌ها
          </Link>
        </div>
        {siteOrders.recent.length === 0 ? (
          <p className="border-t px-4 py-8 text-center text-[13px] text-muted-foreground">
            هنوز سفارشی از سایت ثبت نشده است. سفارش‌های سایت بعد از اتصال، خودکار اینجا و در «سفارش‌ها و فروش» می‌آیند.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>سفارش</TableHead>
                <TableHead>مرجع سایت</TableHead>
                <TableHead>مشتری</TableHead>
                <TableHead className="text-end">مبلغ (تومان)</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>زمان</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {siteOrders.recent.map((order) => {
                const status = orderStatus(order);
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link href={`/dashboard/sales/history/${order.id}`} className="font-mono font-bold hover:text-brand">
                        #{order.number}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-muted-foreground" dir="ltr" style={{ textAlign: 'end' }}>
                      {order.reference}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">{order.customer}</TableCell>
                    <TableCell className="text-end font-medium">{fa(Math.round(order.final))}</TableCell>
                    <TableCell>
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', status.tone)}>{status.label}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                      {formatJalaliDate(order.createdAt, 'jMM/jDD HH:mm')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href="/dashboard/inventory/web-ids">شناسه‌های سایت</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/sales/site-review">بررسی پول سفارش‌های سایت</Link>
        </Button>
      </div>

      <SettingsPanel
        title="اتصال به سایت"
        description="آدرس و رمزی که ERP با آن سایت را صدا می‌زند، و انتخاب‌هایی که فروش‌های سایت با آن ثبت می‌شوند."
      >
        <FieldRow label="آدرس سایت" htmlFor="siteUrl" hint="همان آدرسی که کاتالوگ و وبهوک سایت روی آن هستند.">
          <Input
            id="siteUrl"
            dir="ltr"
            className="font-mono"
            placeholder="https://api.themoak.com"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
          />
        </FieldRow>

        <FieldRow
          label="رمز وبهوک"
          htmlFor="webhookSecret"
          hint="جدا از توکنی است که سایت با آن ERP را صدا می‌زند. بعد از ذخیره دیگر نمایش داده نمی‌شود."
        >
          <Input
            id="webhookSecret"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            placeholder={initial.hasSecret ? '•••••••• ثبت شده؛ برای تغییر، رمز تازه را بنویسید' : 'از پنل سایت'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </FieldRow>

        <FieldRow label="حساب دریافت پول فروش سایت" htmlFor="siteAccount">
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger id="siteAccount">
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
        </FieldRow>
        <FieldRow label="انبار سایت" htmlFor="siteWarehouse">
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger id="siteWarehouse">
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
        </FieldRow>

        <PanelActions>
          <Button onClick={save} disabled={busy !== null || !siteUrl.trim() || !accountId || !warehouseId}>
            {busy === 'save' ? 'در حال ذخیره...' : 'ذخیره'}
          </Button>
          <Button variant="outline" onClick={test} disabled={busy !== null || !usable}>
            {busy === 'test' ? 'در حال آزمایش...' : 'آزمایش اتصال'}
          </Button>
          {unsaved && (
            <p className="text-xs text-muted-foreground">آزمایش با مقادیر ذخیره‌شده انجام می‌شود؛ اول ذخیره کنید.</p>
          )}
        </PanelActions>
      </SettingsPanel>

      <SettingsPanel
        title="عکس محصولات از سایت"
        description={
          <>
            عکس روبه‌روی هر فریم و لینک صفحه‌اش در سایت، با «شناسهٔ سایت» خوانده می‌شود. هر روز یک بار هم خودکار اجرا
            می‌شود. کالایی که شناسهٔ سایت ندارد دست نمی‌خورد.
          </>
        }
        action={
          <Button onClick={sync} disabled={busy !== null || !usable}>
            {busy === 'sync' ? 'در حال هم‌گام‌سازی...' : 'هم‌گام‌سازی الان'}
          </Button>
        }
      >
        {last ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span
                className={`rounded-full px-2 py-0.5 text-[11.5px] ${last.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
              >
                {last.ok ? 'انجام شد' : 'ناموفق'}
              </span>
              <span className="font-medium">{last.message}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              آخرین اجرا: <span className="font-mono">{formatJalaliDate(last.at)}</span>{' '}
              <span className="font-mono">
                {new Date(last.at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </p>
            {last.ok && (
              <ul className="space-y-1 border-t pt-2 text-xs leading-relaxed text-muted-foreground">
                <li>بدون تغییر: {fa(last.unchanged ?? 0)}</li>
                {!!last.notInErp?.length && (
                  <li>
                    در سایت هست ولی هیچ کالایی در ERP این شناسه را ندارد ({fa(last.notInErp.length)}):{' '}
                    <span dir="ltr" className="font-mono">{listPreview(last.notInErp)}</span>
                  </li>
                )}
                {!!last.notOnSite?.length && (
                  <li>
                    در ERP شناسه دارد ولی سایت برنگرداند ({fa(last.notOnSite.length)}):{' '}
                    <span dir="ltr" className="font-mono">{listPreview(last.notOnSite)}</span>
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
          <p className="text-[13px] text-muted-foreground">هنوز اجرا نشده است. پس از ذخیرهٔ اتصال، «هم‌گام‌سازی الان» را بزنید.</p>
        )}
      </SettingsPanel>

      <SettingsPanel
        title="ارسال موجودی به سایت"
        description="موجودی انبار سایت با «شناسهٔ سایت» به سایت فرستاده می‌شود؛ فقط تعداد، نه قیمت. هر تغییر موجودی چند دقیقه‌ای به سایت می‌رسد."
        action={
          panel && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11.5px] ${panel.enabled ? 'bg-success-soft text-success' : 'bg-secondary text-muted-foreground'}`}
            >
              {panel.enabled ? 'روشن' : 'خاموش'}
            </span>
          )
        }
      >
        {!panel ? (
          <p className="text-[13px] text-muted-foreground">در حال خواندن وضعیت...</p>
        ) : (
          <div className="space-y-3">
            <StatusNote tone="warning">
              فقط وقتی روشن کنید که سایت تأیید کرده باشد: کالاها را فقط با شناسهٔ سایت (webId) تطبیق می‌دهد، در
              createSale برای هر قلم webId می‌فرستد، و ثبت فروش‌هایش در ERP روشن است. وگرنه موجودی فریمی که فروشش
              هنوز در ERP ثبت نشده به سایت برمی‌گردد و فریم دو بار فروخته می‌شود.
            </StatusNote>

            <div className="flex flex-wrap items-center gap-2">
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
              <div className="space-y-2 rounded-lg border p-3 text-[13px]">
                <div className="font-medium">
                  سایت تأیید کرد که موجودی انبار «{warehouseName(preview.result.warehouseId)}» (
                  <span dir="ltr" className="font-mono text-[12px]">{preview.result.warehouseId}</span>) را می‌گیرد.
                </div>
                <ul className="space-y-1.5 text-xs leading-relaxed">
                  <li>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11.5px] ${preview.result.goingOut.length ? 'bg-danger-soft text-danger' : 'bg-secondary text-muted-foreground'}`}
                    >
                      ناموجود می‌شود: {fa(preview.result.goingOut.length)}
                    </span>{' '}
                    <span className="text-muted-foreground">در سایت موجود است ولی در ERP نه، پس در سایت ناموجود می‌شود.</span>
                    {!!preview.result.goingOut.length && (
                      <div dir="ltr" className="mt-1 font-mono text-danger" style={{ textAlign: 'right' }}>
                        {preview.result.goingOut.join('، ')}
                      </div>
                    )}
                  </li>
                  <li className="text-muted-foreground">
                    در سایت ناموجود است و در ERP موجود، پس دوباره موجود می‌شود: {fa(preview.result.comingIn.length)}
                    {!!preview.result.comingIn.length && (
                      <>
                        {' '}
                        <span dir="ltr" className="font-mono">{listPreview(preview.result.comingIn)}</span>
                      </>
                    )}
                  </li>
                  <li className="text-muted-foreground">بدون تغییر: {fa(preview.result.unchanged)}</li>
                  <li className="text-muted-foreground">
                    در ERP شناسه دارد ولی در سایت نیست: {fa(preview.result.notOnSite.length)}
                    {!!preview.result.notOnSite.length && (
                      <>
                        {' '}
                        <span dir="ltr" className="font-mono">{listPreview(preview.result.notOnSite)}</span>
                      </>
                    )}
                  </li>
                </ul>
                <div className="flex flex-wrap gap-2 border-t pt-2">
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
              <StatusNote tone={panel.status.paused || panel.status.failingSince ? 'danger' : 'neutral'} className="space-y-1">
                <div>
                  آخرین ارسال موفق:{' '}
                  <span className="font-mono">{panel.status.lastOkAt ? when(panel.status.lastOkAt) : 'هنوز نه'}</span>
                </div>
                {panel.status.failingSince && (
                  <div>
                    ناموفق از: <span className="font-mono">{when(panel.status.failingSince)}</span>
                  </div>
                )}
                {panel.status.paused ? (
                  <div className="space-y-2 pt-1">
                    <div className="font-medium">ارسال خودکار متوقف شد: {panel.status.paused.why}</div>
                    <div className="text-xs">
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
              </StatusNote>
            )}

            {panel.hold?.state === 'held' && (
              <StatusNote tone="warning" className="space-y-2">
                <div className="font-medium">
                  {fa(panel.hold.webIds.length)} فریم منتظر تأیید شما برای ناموجود شدن در سایت
                </div>
                <p className="text-xs">
                  موجودی این فریم‌ها در ERP به صفر رسیده، ولی چون فریم‌های زیادی با هم ناموجود می‌شدند ارسالشان از{' '}
                  {when(panel.hold.since)} نگه داشته شده است. تا آزاد نکنید در سایت موجود می‌مانند و فروخته
                  می‌شوند. اگر صفر شدنشان درست است آزاد کنید؛ اگر نه، اول موجودی ERP را درست کنید. فریمی که
                  موجودی‌اش در ERP بیشتر از صفر شود، خودش از این فهرست بیرون می‌رود و با ارسال بعدی فرستاده می‌شود.
                </p>
                <div dir="ltr" className="font-mono text-xs" style={{ textAlign: 'right' }}>
                  {panel.hold.webIds.join('، ')}
                </div>
                <Button
                  size="sm"
                  onClick={() => run('release', () => releaseStockHold(panel.hold?.webIds ?? []))}
                  disabled={busy !== null}
                >
                  {busy === 'release' ? 'در حال آزاد کردن...' : 'آزاد کردن'}
                </Button>
              </StatusNote>
            )}

            {panel.skipped.length > 0 && (
              <div className="space-y-1 border-t pt-3 text-[13px]">
                <div className="font-medium">شناسه‌هایی که سایت نپذیرفت ({fa(panel.skipped.length)})</div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {panel.skipped.map((s) => (
                    <li key={s.webId}>
                      <span dir="ltr" className="font-mono">{s.webId}</span>: {s.why}
                      {s.at && ` (${when(s.at)})`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </SettingsPanel>
    </>
  );
}
