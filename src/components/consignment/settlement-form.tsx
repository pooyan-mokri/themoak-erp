'use client';

import { useState, useTransition } from 'react';
import { recordConsignmentSales } from '@/actions/consignment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRequestId } from '@/components/ui/request-id';
import { channelSummary, defaultChannelOf } from '@/lib/consignment-channels';

interface Channel {
  id: string;
  name: string;
  commissionRate: number;
  isDefault: boolean;
  isActive: boolean;
}

interface Partner {
  id: string;
  name: string;
  customer?: { id: string; name: string; commissionRate?: number; channels?: Channel[] };
}

interface Product {
  id: string;
  name: string;
  sku: string;
  sellPrice?: number;
}

interface SettlementFormProps {
  partners: Partner[];
  products: Product[];
}

interface RowItem {
  productId: string;
  quantity: string;
  unitPrice: string;
  /** The partner's sale channel this line was sold through. */
  channelId: string;
}

const emptyRow = (channelId: string): RowItem => ({ productId: '', quantity: '1', unitPrice: '', channelId });

export function SettlementForm({ partners, products }: SettlementFormProps) {
  const [partnerWarehouseId, setPartnerWarehouseId] = useState('');
  const [saleDate, setSaleDate] = useState<Date>(new Date());
  // The channel new lines start on: the partner's default until it is changed.
  const [reportChannelId, setReportChannelId] = useState('');
  const [items, setItems] = useState<RowItem[]>([emptyRow('')]);
  const [isPending, startTransition] = useTransition();
  // Kept across a failed attempt, so a retry of the same report is booked once.
  const [requestId, renewRequestId] = useRequestId();

  const selectedPartner = partners.find((p) => p.id === partnerWarehouseId);
  const channels = (selectedPartner?.customer?.channels ?? []).filter((channel) => channel.isActive);
  const legacyRate = selectedPartner?.customer?.commissionRate ?? 0;
  const rateOf = (channelId: string) =>
    channels.find((channel) => channel.id === channelId)?.commissionRate ?? (channels.length ? 0 : legacyRate);

  // Picking a partner puts the whole report on that partner's default channel.
  const choosePartner = (id: string) => {
    setPartnerWarehouseId(id);
    const partner = partners.find((p) => p.id === id);
    const fallback = defaultChannelOf(partner?.customer?.channels ?? [])?.id ?? '';
    setReportChannelId(fallback);
    setItems((rows) => rows.map((row) => ({ ...row, channelId: fallback })));
  };

  // Changing the report's channel moves every line that was still on the old one.
  const chooseReportChannel = (id: string) => {
    setItems((rows) => rows.map((row) => (row.channelId === reportChannelId ? { ...row, channelId: id } : row)));
    setReportChannelId(id);
  };

  const addRow = () => setItems([...items, emptyRow(reportChannelId)]);
  const removeRow = (idx: number) =>
    setItems(items.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<RowItem>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  // A product's price in the system fills the line, and stays editable: what
  // the partner reports is what is booked, higher or lower.
  const chooseProduct = (idx: number, productId: string) => {
    const sellPrice = products.find((product) => product.id === productId)?.sellPrice;
    updateRow(idx, { productId, unitPrice: sellPrice ? String(sellPrice) : items[idx].unitPrice });
  };
  const systemPrice = (productId: string) => products.find((product) => product.id === productId)?.sellPrice ?? 0;

  // Live totals, per channel and altogether
  const lineGross = (it: RowItem) => (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
  const grossTotal = items.reduce((s, it) => s + lineGross(it), 0);
  const byChannel = items.reduce((rows, it) => {
    const gross = lineGross(it);
    if (gross <= 0) return rows;
    const name = channels.find((channel) => channel.id === it.channelId)?.name ?? 'پیش‌فرض';
    const rate = rateOf(it.channelId);
    const row = rows.find((one) => one.name === name) ?? { name, rate, gross: 0 };
    row.gross += gross;
    return rows.includes(row) ? rows : [...rows, row];
  }, [] as Array<{ name: string; rate: number; gross: number }>);
  const commissionAmount = byChannel.reduce((s, row) => s + (row.gross * row.rate) / 100, 0);
  const netAmount = grossTotal - commissionAmount;

  const handleSubmit = () => {
    if (!partnerWarehouseId) {
      toast.error('لطفاً همکار را انتخاب کنید');
      return;
    }
    const cleaned = items
      .filter((it) => it.productId && Number(it.quantity) > 0 && Number(it.unitPrice) >= 0)
      .map((it) => ({
        productId: it.productId,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        channelId: it.channelId || undefined,
      }));
    if (cleaned.length === 0) {
      toast.error('حداقل یک آیتم با اطلاعات کامل وارد کنید');
      return;
    }
    startTransition(async () => {
      const report = {
        partnerWarehouseId,
        saleDate: saleDate.toISOString().slice(0, 10),
        items: cleaned,
        requestId,
      };
      let result = await recordConsignmentSales(report);
      // The same lines are already on that day's invoice: book them again only on purpose.
      if (!result.success && result.data?.repeatOf && window.confirm(result.message ?? '')) {
        result = await recordConsignmentSales({ ...report, confirmRepeat: true });
      }
      if (result.success) {
        toast.success(result.message);
        renewRequestId();
        setItems([emptyRow(reportChannelId)]);
      } else {
        toast.error(result.message || 'خطا در ثبت فروش');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ثبت فروش امانی</CardTitle>
        <CardDescription>
          گزارش فروش هفتگی/ماهانه همکار — هر کانال فروش فاکتور خودش را می‌گیرد.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>همکار</Label>
            <Select value={partnerWarehouseId} onValueChange={choosePartner}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب همکار" />
              </SelectTrigger>
              <SelectContent>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.customer?.name || p.name}
                    {p.customer?.channels?.length
                      ? ` (${channelSummary(p.customer.channels)})`
                      : p.customer?.commissionRate
                        ? ` (کمیسیون ${p.customer.commissionRate}%)`
                        : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <JalaliDatePicker
            name="saleDate"
            label="تاریخ گزارش فروش"
            defaultValue={saleDate}
            onChange={(d) => d && setSaleDate(d)}
            required
          />

          {channels.length > 1 && (
            <div className="space-y-2">
              <Label>کانال فروش</Label>
              <Select value={reportChannelId} onValueChange={chooseReportChannel}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کانال" />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.name} — کمیسیون {channel.commissionRate.toLocaleString('fa-IR')}٪
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                کانال هر ردیف را جداگانه هم می‌توانید عوض کنید؛ هر کانال فاکتور خودش را می‌گیرد.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>آیتم‌های فروخته شده</Label>
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className={channels.length > 1 ? 'col-span-12 md:col-span-4' : 'col-span-6'}>
                <Select
                  value={item.productId}
                  onValueChange={(v) => chooseProduct(idx, v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="محصول" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {channels.length > 1 && (
                <div className="col-span-5 md:col-span-2">
                  <Select value={item.channelId} onValueChange={(v) => updateRow(idx, { channelId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="کانال" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className={channels.length > 1 ? 'col-span-2 md:col-span-2' : 'col-span-2'}>
                <Input
                  type="number"
                  min="1"
                  placeholder="تعداد"
                  value={item.quantity}
                  onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                />
              </div>
              <div className={channels.length > 1 ? 'col-span-4 md:col-span-3' : 'col-span-3'}>
                <Input
                  type="number"
                  min="0"
                  placeholder="قیمت واحد"
                  value={item.unitPrice}
                  onChange={(e) => updateRow(idx, { unitPrice: e.target.value })}
                />
                {item.productId &&
                  item.unitPrice !== '' &&
                  Number(item.unitPrice) < systemPrice(item.productId) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      کمتر از قیمت سیستم: {systemPrice(item.productId).toLocaleString('fa-IR')}
                    </p>
                  )}
              </div>
              <div className="col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(idx)}
                  disabled={items.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 ml-1" />
            افزودن آیتم
          </Button>
        </div>

        {grossTotal > 0 && (
          <div className="rounded-lg border p-4 bg-muted/30 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>مبلغ کل فروش (ناخالص):</span>
              <span className="font-medium">{grossTotal.toLocaleString('fa-IR')} تومان</span>
            </div>
            {byChannel.map((row) => (
              <div key={row.name} className="flex justify-between text-muted-foreground">
                <span>
                  {byChannel.length > 1 ? `${row.name}: ` : ''}
                  فروش {row.gross.toLocaleString('fa-IR')} — سهم همکار {row.rate.toLocaleString('fa-IR')}٪ (قبلاً کسر شده)
                </span>
                <span>{((row.gross * row.rate) / 100).toLocaleString('fa-IR')} تومان</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1 mt-1 font-bold text-base">
              <span>سهم ما (مبلغ قابل دریافت):</span>
              <span className="text-green-700">
                {netAmount.toLocaleString('fa-IR')} تومان
              </span>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'در حال ثبت...' : 'ثبت فاکتور فروش'}
        </Button>
      </CardFooter>
    </Card>
  );
}
