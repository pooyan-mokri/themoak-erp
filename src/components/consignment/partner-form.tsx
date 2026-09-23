'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import { createConsignmentPartner } from '@/actions/consignment';
import { CHANNELS_FIELD, DEFAULT_CHANNEL_NAME } from '@/lib/consignment-channels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const initialState = {
  message: '',
  errors: {},
};

/** A sale channel while it is being edited: the rate stays a string so the input can be emptied. */
export interface ChannelRow {
  key: string;
  /** An existing channel's id, so a rename lands on the right channel. */
  id?: string;
  name: string;
  commissionRate: string;
  isDefault: boolean;
  isActive: boolean;
}

interface StoredChannel {
  id: string;
  name: string;
  commissionRate: number;
  isDefault: boolean;
  isActive: boolean;
}

let rowCounter = 0;

/** What a brand-new partner starts with: one default channel at ۰٪. */
export function newChannelRows(): ChannelRow[] {
  return [
    { key: `channel-${++rowCounter}`, name: DEFAULT_CHANNEL_NAME, commissionRate: '0', isDefault: true, isActive: true },
  ];
}

/** A partner's saved channels as rows — the closed ones too, shown as inactive. */
export function channelRowsOf(channels: StoredChannel[] | undefined): ChannelRow[] {
  if (!channels || channels.length === 0) return newChannelRows();
  return channels.map((channel) => ({
    key: channel.id,
    id: channel.id,
    name: channel.name,
    commissionRate: String(channel.commissionRate),
    isDefault: channel.isDefault,
    isActive: channel.isActive,
  }));
}

/** The first thing wrong with the rows, in Persian — the rules the server also enforces. */
export function channelRowsError(rows: ChannelRow[]): string | null {
  if (rows.length === 0) return 'حداقل یک کانال فروش لازم است.';
  const names = rows.map((row) => row.name.trim());
  if (names.some((name) => name === '')) return 'نام کانال فروش نمی‌تواند خالی باشد.';
  if (new Set(names).size !== names.length) return 'نام کانال‌های فروش نباید تکراری باشد.';
  const badRate = rows.some((row) => {
    const rate = Number(row.commissionRate);
    return row.commissionRate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100;
  });
  if (badRate) return 'درصد کمیسیون باید عددی بین ۰ تا ۱۰۰ باشد.';
  const active = rows.filter((row) => row.isActive);
  if (active.length === 0) return 'حداقل یک کانال فروش باید فعال باشد.';
  if (!active.some((row) => row.isDefault)) return 'یک کانال فروش فعال باید پیش‌فرض باشد.';
  return null;
}

/** The rows as the server reads them back out of the CHANNELS_FIELD input. */
function channelRowsJson(rows: ChannelRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      name: row.name.trim(),
      commissionRate: Number(row.commissionRate),
      isDefault: row.isDefault,
      isActive: row.isActive,
    }))
  );
}

/** Leaves the default on an active channel after one is closed or removed. */
function withActiveDefault(rows: ChannelRow[]): ChannelRow[] {
  if (rows.some((row) => row.isDefault && row.isActive)) return rows;
  const fallback = rows.find((row) => row.isActive);
  return fallback ? rows.map((row) => ({ ...row, isDefault: row.key === fallback.key })) : rows;
}

interface ChannelsEditorProps {
  rows: ChannelRow[];
  setRows: (rows: ChannelRow[]) => void;
  /** Keeps the «پیش‌فرض» radios of two forms on one page apart. */
  idPrefix: string;
  error: string | null;
}

export function ChannelsEditor({ rows, setRows, idPrefix, error }: ChannelsEditorProps) {
  const patch = (key: string, change: Partial<ChannelRow>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const makeDefault = (key: string) =>
    setRows(
      rows.map((row) =>
        row.key === key ? { ...row, isDefault: true, isActive: true } : { ...row, isDefault: false }
      )
    );

  const setActive = (key: string, isActive: boolean) =>
    setRows(
      withActiveDefault(
        rows.map((row) => (row.key === key ? { ...row, isActive, isDefault: row.isDefault && isActive } : row))
      )
    );

  const remove = (key: string) => setRows(withActiveDefault(rows.filter((row) => row.key !== key)));

  const add = () =>
    setRows([...rows, { key: `channel-${++rowCounter}`, name: '', commissionRate: '0', isDefault: false, isActive: true }]);

  return (
    <div className="space-y-2">
      <Label>کانال‌های فروش و درصد کمیسیون</Label>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className={`rounded-md border p-2 space-y-2 ${row.isActive ? '' : 'bg-muted/50'}`}>
            <div className="flex items-center gap-2">
              <Input
                aria-label="نام کانال"
                value={row.name}
                onChange={(event) => patch(row.key, { name: event.target.value })}
                placeholder="مثال: آنلاین"
                className="h-8 flex-1"
              />
              <Input
                aria-label="درصد کمیسیون"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={row.commissionRate}
                onChange={(event) => patch(row.key, { commissionRate: event.target.value })}
                className="h-8 w-16 px-2"
              />
              <span className="text-xs text-muted-foreground">٪</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="radio"
                  name={`${idPrefix}-default`}
                  checked={row.isDefault}
                  onChange={() => makeDefault(row.key)}
                />
                پیش‌فرض
              </label>
              <span className="flex items-center gap-1">
                <Switch
                  aria-label="کانال فعال"
                  checked={row.isActive}
                  onCheckedChange={(checked) => setActive(row.key, checked)}
                />
                فعال
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 mr-auto text-red-600"
                onClick={() => remove(row.key)}
                disabled={rows.length === 1}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">حذف کانال</span>
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={add}>
        <Plus className="h-3.5 w-3.5 ml-1" />
        افزودن کانال
      </Button>
      <p className="text-xs text-muted-foreground">
        کانالی که فروش ثبت‌شده دارد حذف نمی‌شود و فقط بسته (غیرفعال) می‌شود.
      </p>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <input type="hidden" name={CHANNELS_FIELD} value={channelRowsJson(rows)} />
    </div>
  );
}

export function PartnerForm() {
  const [state, dispatch] = useFormState(createConsignmentPartner, initialState);
  const [rows, setRows] = useState<ChannelRow[]>(newChannelRows);
  const [channelError, setChannelError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>تعریف همکار امانی جدید</CardTitle>
      </CardHeader>
      <form
        action={dispatch}
        onSubmit={(event) => {
          const problem = channelRowsError(rows);
          setChannelError(problem);
          if (problem) event.preventDefault();
        }}
      >
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام همکار / فروشگاه</Label>
            <Input id="name" name="name" placeholder="مثال: گالری نور" required />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.name && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.name}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">شماره تماس</Label>
            <Input id="phone" name="phone" placeholder="0912..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">آدرس</Label>
            <Textarea id="address" name="address" placeholder="آدرس کامل..." />
          </div>
          <ChannelsEditor rows={rows} setRows={setRows} idPrefix="new-partner" error={channelError} />
          {state.message && (
            <div className={`text-sm p-2 rounded ${state.message.includes('موفقیت') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {state.message}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end">
          <SubmitButton />
        </CardFooter>
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت همکار'}
    </Button>
  );
}
