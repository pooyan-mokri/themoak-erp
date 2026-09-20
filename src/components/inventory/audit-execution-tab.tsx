'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  acceptSystemForUncounted,
  finalizeAllFromLastCount,
  setFinalQuantity,
  setZeroForUncounted,
} from '@/actions/inventory-audit';
import { toast } from 'sonner';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, ListChecks, Search } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AuditCountQueue } from '@/lib/audit-scan-queue';
import {
  AuditSaveStatus,
  AuditScanPanel,
  savedCount,
  useAuditCountQueue,
} from '@/components/inventory/audit-scan-panel';
import {
  ITEM_FILTERS,
  RESOLVE_CONFLICTS_FIRST,
  foldSearchText,
  lastCount,
  matchesFilter,
  matchesSearch,
  parseRound,
  parseWholeNumber,
  type ItemFilter,
  type Round,
} from '@/components/inventory/audit-count-view';

interface Product {
  id: string;
  name: string;
  sku: string;
  webId?: string | null;
  barcode?: string | null;
}

interface InventoryAuditItem {
  id: string;
  productId: string;
  systemQuantity: number;
  countedQuantity1?: number | null;
  countedQuantity2?: number | null;
  countedQuantity3?: number | null;
  finalQuantity?: number | null;
  notes?: string;
  product: Product;
}

interface InventoryAudit {
  id: string;
  status: string;
  items?: InventoryAuditItem[];
}

interface ExecutionTabProps {
  audit: InventoryAudit;
}

const CONNECTION_LOST = 'ارتباط قطع شد؛ ثبت نشد. دوباره بزنید.';
const NO_ITEMS: InventoryAuditItem[] = [];

export function ExecutionTab({ audit }: ExecutionTabProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const round = parseRound(searchParams.get('round'));
  const items = audit.items ?? NO_ITEMS;
  const inProgress = audit.status === 'IN_PROGRESS';
  const queue = useAuditCountQueue(audit.id, round, items, inProgress);

  // The round lives in the URL so a reload keeps it. The scan panel changes it only with every count saved.
  const goToRound = (next: Round) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('round', String(next));
    // Next.js keeps useSearchParams in step with replaceState, with no request to the server.
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  };

  // Check if audit is in progress
  if (!inProgress) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            {audit.status === 'COMPLETED'
              ? 'انبارگردانی تکمیل شده است؛ شمارش بسته است.'
              : 'برای شروع شمارش، ابتدا موجودی را فریز کنید.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <AuditSaveStatus auditId={audit.id} round={round} items={items} queue={queue} />

      <Tabs defaultValue="count" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="count">ثبت شمارش</TabsTrigger>
          <TabsTrigger value="items">لیست آیتم‌ها</TabsTrigger>
        </TabsList>

        {/* Stays mounted while the list is open, so the last scans and a typed quantity are kept. */}
        <TabsContent value="count" forceMount className="space-y-4 data-[state=inactive]:hidden">
          <AuditScanPanel
            key={round}
            items={items}
            round={round}
            queue={queue}
            onRoundChange={goToRound}
          />
        </TabsContent>

        <TabsContent value="items">
          <AuditItemsList auditId={audit.id} items={items} round={round} queue={queue} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type ListItem = InventoryAuditItem & {
  countedQuantity1: number | null;
  countedQuantity2: number | null;
  countedQuantity3: number | null;
};

const getCountStatus = (item: ListItem) => {
  if (item.finalQuantity != null) {
    return { status: 'final', label: 'نهایی شده', variant: 'default' as const };
  }
  if (item.countedQuantity3 !== null) {
    return { status: 'third', label: 'شمارش سوم', variant: 'secondary' as const };
  }
  if (item.countedQuantity2 !== null) {
    return { status: 'second', label: 'شمارش دوم', variant: 'outline' as const };
  }
  if (item.countedQuantity1 !== null) {
    return { status: 'first', label: 'شمارش اول', variant: 'outline' as const };
  }
  return { status: 'none', label: 'شمارش نشده', variant: 'outline' as const };
};

type ItemsListProps = {
  auditId: string;
  items: InventoryAuditItem[];
  round: Round;
  queue: AuditCountQueue | null;
};

function AuditItemsList({ auditId, items, round, queue }: ItemsListProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [finalDrafts, setFinalDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Counts as this page knows them: the page data, saves confirmed since, and this round's totals still being saved.
  const countFor = (item: InventoryAuditItem, r: Round) =>
    r === round && queue ? queue.getTotal(item.productId) : savedCount(auditId, r, item);
  const view: ListItem[] = items.map((item) => ({
    ...item,
    countedQuantity1: countFor(item, 1),
    countedQuantity2: countFor(item, 2),
    countedQuantity3: countFor(item, 3),
  }));
  const query = foldSearchText(searchQuery);
  const searched = view.filter((item) => matchesSearch(item, query));
  const shown = searched.filter((item) => matchesFilter(item, filter));
  const notFinalCount = view.filter((item) => matchesFilter(item, 'notFinal')).length;

  const run = async (call: () => Promise<{ success?: boolean; message?: string }>) => {
    setBusy(true);
    try {
      // Counts this device has not saved yet go first, so the page data loaded after the call already holds them.
      await queue?.flush();
      const result = await call();
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error(CONNECTION_LOST);
    } finally {
      setBusy(false);
    }
  };

  const handleSetFinal = (item: ListItem, finalQuantity: number | null) => {
    if (finalQuantity === null || finalQuantity > 100000) {
      toast.error('لطفاً مقدار معتبری وارد کنید.');
      return;
    }
    if (!confirm(`مقدار نهایی «${item.product.name}» برابر ${finalQuantity} ثبت شود؟`)) {
      return;
    }
    void run(() => setFinalQuantity(auditId, item.productId, finalQuantity));
  };

  const handleFinalizeAll = () => {
    // A conflict never saves by itself, and finalising would take the other person's number for it.
    if (queue && queue.conflicts().length > 0) {
      toast.error(RESOLVE_CONFLICTS_FIRST);
      return;
    }
    if (!confirm(`مقدار نهایی ${notFinalCount} آیتم شمارش‌شده از آخرین شمارش هر کدام ثبت شود؟`)) {
      return;
    }
    void run(async () => {
      // The server finalises from saved counts, so what was counted on this device has to be saved first.
      await queue?.flush();
      if (queue && queue.conflicts().length > 0) {
        return { success: false, message: RESOLVE_CONFLICTS_FIRST };
      }
      const unsaved = queue?.pendingCount() ?? 0;
      if (unsaved > 0) {
        return {
          success: false,
          message: `${unsaved} شمارش هنوز ذخیره نشده است. صبر کنید تا ذخیره شود، سپس دوباره بزنید.`,
        };
      }
      return finalizeAllFromLastCount(auditId);
    });
  };

  const handleZero = (targets: ListItem[]) => {
    const names = targets
      .slice(0, 40)
      .map((item) => `«${item.product.name}»`)
      .join('\n');
    const more = targets.length > 40 ? `\nو ${targets.length - 40} کالای دیگر` : '';
    const question =
      targets.length === 1
        ? `مقدار نهایی «${targets[0].product.name}» صفر ثبت شود؟ (موجودی سیستم: ${targets[0].systemQuantity})`
        : `مقدار نهایی این ${targets.length} کالای شمارش‌نشده صفر ثبت شود؟ با صدور اسناد اصلاحی، موجودی آن‌ها صفر می‌شود.\n\n${names}${more}`;
    if (!confirm(question)) {
      return;
    }
    void run(() => setZeroForUncounted(auditId, targets.map((item) => item.productId)));
  };

  const handleAcceptSystem = (targets: ListItem[]) => {
    const names = targets
      .slice(0, 40)
      .map((item) => `«${item.product.name}» (${item.systemQuantity})`)
      .join('\n');
    const more = targets.length > 40 ? `\nو ${targets.length - 40} کالای دیگر` : '';
    const question =
      targets.length === 1
        ? `موجودی سیستم «${targets[0].product.name}» برابر ${targets[0].systemQuantity} به عنوان مقدار نهایی ثبت شود؟ موجودی این کالا تغییر نمی‌کند.`
        : `موجودی سیستم این ${targets.length} کالای شمارش‌نشده به عنوان مقدار نهایی ثبت شود؟ موجودی آن‌ها تغییر نمی‌کند.\n\n${names}${more}`;
    if (!confirm(question)) {
      return;
    }
    void run(() => acceptSystemForUncounted(auditId, targets.map((item) => item.productId)));
  };

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle>لیست آیتم‌های شمارش</CardTitle>
        <CardDescription>
          وضعیت شمارش تمام آیتم‌ها را مشاهده و مدیریت کنید.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="جستجو: نام، SKU، کد وب یا بارکد..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {ITEM_FILTERS.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? 'default' : 'outline'}
              className="h-8 gap-1.5 rounded-full hover:scale-100"
              onClick={() => setFilter(value)}
            >
              {label}
              <span className="tabular-nums opacity-70">
                {searched.filter((item) => matchesFilter(item, value)).length}
              </span>
            </Button>
          ))}
        </div>

        {filter === 'uncounted' && shown.length > 0 && (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            تا وقتی این آیتم‌ها مقدار نهایی نگیرند، اسناد اصلاحی صادر نمی‌شود. «موجودی سیستم» یعنی موجودی همان است که
            سیستم می‌گوید و دست نمی‌خورد؛ «۰» یعنی کالا در انبار نیست و موجودی‌اش صفر می‌شود. پس اگر فقط موجودی یک کالا
            را می‌خواهید عوض کنید، همان یک کالا را بشمارید و برای بقیه «موجودی سیستم» را ثبت کنید.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={busy || notFinalCount === 0}
            onClick={handleFinalizeAll}
          >
            <ListChecks className="h-4 w-4" />
            نهایی کردن همه از آخرین شمارش
          </Button>
          {filter === 'uncounted' && shown.length > 0 && (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => handleAcceptSystem(shown)}>
                ثبت موجودی سیستم برای همهٔ این‌ها
              </Button>
              <Button type="button" variant="destructive" disabled={busy} onClick={() => handleZero(shown)}>
                ثبت ۰ برای همهٔ این‌ها
              </Button>
            </>
          )}
        </div>

        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {shown.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">آیتمی با این شرایط نیست.</p>
          )}
          {shown.map((item) => {
            const countStatus = getCountStatus(item);
            const last = lastCount(item);
            const draft = finalDrafts[item.productId] ?? (last === null ? '' : String(last));
            return (
              <div
                key={item.id}
                className="p-3 sm:p-4 border rounded-lg space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{item.product.name}</p>
                    <p className="text-sm text-muted-foreground">
                      <bdi>{item.product.sku}</bdi>
                    </p>
                  </div>
                  <Badge variant={countStatus.variant} className="shrink-0">{countStatus.label}</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">موجودی سیستم:</span>
                    <span className="font-medium mr-2">{item.systemQuantity}</span>
                  </div>
                  {item.countedQuantity1 !== null && (
                    <div>
                      <span className="text-muted-foreground">شمارش اول:</span>
                      <span className="font-medium mr-2">{item.countedQuantity1}</span>
                    </div>
                  )}
                  {item.countedQuantity2 !== null && (
                    <div>
                      <span className="text-muted-foreground">شمارش دوم:</span>
                      <span className="font-medium mr-2">{item.countedQuantity2}</span>
                    </div>
                  )}
                  {item.countedQuantity3 !== null && (
                    <div>
                      <span className="text-muted-foreground">شمارش سوم:</span>
                      <span className="font-medium mr-2">{item.countedQuantity3}</span>
                    </div>
                  )}
                  {item.finalQuantity != null && (
                    <div>
                      <span className="text-muted-foreground">مقدار نهایی:</span>
                      <span className="font-medium mr-2 text-green-600">
                        {item.finalQuantity}
                      </span>
                    </div>
                  )}
                </div>
                {item.notes && (
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">توضیحات:</span> {item.notes}
                  </div>
                )}
                {last !== null && item.finalQuantity == null && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <Input
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="مقدار نهایی"
                      aria-label={`مقدار نهایی ${item.product.name}`}
                      className="h-9 w-24 text-center"
                      value={draft}
                      onChange={(e) => {
                        const value = e.target.value;
                        setFinalDrafts((previous) => ({ ...previous, [item.productId]: value }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !busy) {
                          handleSetFinal(item, parseWholeNumber(draft));
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => handleSetFinal(item, last)}
                      title="استفاده از آخرین شمارش"
                    >
                      آخرین شمارش
                    </Button>
                    <Button
                      size="sm"
                      className="gap-2"
                      disabled={busy}
                      onClick={() => handleSetFinal(item, parseWholeNumber(draft))}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      ثبت نهایی
                    </Button>
                  </div>
                )}
                {filter === 'uncounted' && (
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => handleAcceptSystem([item])}
                      title="ثبت موجودی سیستم به عنوان مقدار نهایی: موجودی تغییر نمی‌کند"
                    >
                      موجودی سیستم
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => handleZero([item])}
                      title="ثبت ۰ به عنوان مقدار نهایی"
                    >
                      ۰
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
