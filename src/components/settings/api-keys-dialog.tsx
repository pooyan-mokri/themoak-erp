'use client';

import { useEffect, useState } from 'react';
import { Copy, Download, KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyRow } from '@/actions/api-keys';
import { formatJalaliDate } from '@/lib/date-utils';

interface ApiKeysDialogProps {
  user?: { id: string; name: string };
  onOpenChange: (open: boolean) => void;
}

/**
 * A user's personal keys for Claude's ERP connector (src/lib/api-keys.ts): what
 * the connector does with one is done as this user, with their role, and
 * carries their name. A new key is shown once, here, and never again.
 */
export function ApiKeysDialog({ user, onOpenChange }: ApiKeysDialogProps) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [label, setLabel] = useState('Claude ویندوز');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (userId: string) => {
    const result = await listApiKeys(userId);
    if (result.success) setKeys(result.keys);
    else toast.error(result.message);
  };

  useEffect(() => {
    setFresh(null);
    setKeys(null);
    if (user) load(user.id);
  }, [user]);

  const make = async () => {
    if (!user) return;
    setBusy(true);
    const result = await createApiKey(user.id, label);
    setBusy(false);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    setFresh(result.key);
    await load(user.id);
  };

  const revoke = async (row: ApiKeyRow) => {
    if (!user || !confirm(`کلید «${row.name}» (${row.prefix}…) باطل شود؟ کانکتوری که با آن کار می‌کند دیگر وصل نمی‌شود.`)) return;
    const result = await revokeApiKey(row.id);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
    await load(user.id);
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      toast.success('کلید کپی شد.');
    } catch {
      toast.error('کپی نشد؛ کلید را انتخاب و دستی کپی کنید.');
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>کلیدهای Claude برای {user?.name}</DialogTitle>
          <DialogDescription>
            کانکتور ERP در Claude با این کلید وصل می‌شود. هر کاری که با آن انجام شود (سفارش، پرداخت، مرجوعی، انتقال، واریز و هزینه) به نام {user?.name} و با همان دسترسی‌های نقش او ثبت می‌شود.
          </DialogDescription>
        </DialogHeader>

        {fresh ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/30">
            <p className="text-[13px] font-medium">کلید ساخته شد. فقط همین یک بار نشان داده می‌شود؛ همین حالا آن را در نصب کانکتور وارد کنید.</p>
            <div className="flex gap-2">
              <Input readOnly value={fresh} dir="ltr" className="font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} aria-label="کلید تازه" />
              <Button type="button" variant="outline" onClick={copy}>
                <Copy className="h-4 w-4" />
                کپی
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="api-key-label">برای چه؟</Label>
              <Input id="api-key-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
            </div>
            <Button type="button" onClick={make} disabled={busy}>
              <KeyRound className="h-4 w-4" />
              {busy ? 'در حال ساخت…' : 'ساخت کلید'}
            </Button>
          </div>
        )}

        <div className="mt-2 divide-y rounded-lg border">
          {keys === null ? (
            <p className="p-3 text-[13px] text-muted-foreground">در حال خواندن…</p>
          ) : keys.length === 0 ? (
            <p className="p-3 text-[13px] text-muted-foreground">هنوز کلیدی ساخته نشده است.</p>
          ) : (
            keys.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 p-3 text-[13px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="font-mono text-[11.5px] text-muted-foreground" dir="ltr">{row.prefix}…</span>
                    {row.revokedAt ? <Badge variant="secondary">باطل</Badge> : <Badge variant="success">فعال</Badge>}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">
                    ساخته‌شده {formatJalaliDate(row.createdAt)} · {row.lastUsedAt ? `آخرین استفاده ${formatJalaliDate(row.lastUsedAt)}` : 'هنوز استفاده نشده'}
                  </p>
                </div>
                {!row.revokedAt && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => revoke(row)} title="باطل کردن" aria-label={`باطل کردن ${row.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>

        {/* The connector itself (src/app/api/connector/route.ts): one file for macOS and Windows, with no key in it. */}
        <div className="mt-2 space-y-2 rounded-lg border p-3">
          <p className="text-[13px] font-medium">نصب کانکتور در Claude Desktop</p>
          <ol className="list-decimal space-y-1 ps-5 text-[12.5px] text-muted-foreground">
            <li>فایل کانکتور را دانلود کنید؛ همین یک فایل روی مک و ویندوز نصب می‌شود.</li>
            <li>در Claude Desktop به Settings ← Extensions بروید و فایل را آن‌جا بکشید (یا روی فایل دو بار کلیک کنید) و Install را بزنید.</li>
            <li>آدرس ERP از قبل پر شده است؛ کلیدی را که این‌جا ساخته‌اید در «کلید Claude» وارد کنید و کانکتور را روشن کنید.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button asChild variant="outline">
              <a href="/api/connector" download>
                <Download className="h-4 w-4" />
                دانلود کانکتور (مک و ویندوز)
              </a>
            </Button>
            <a href="/api/connector?file=server" download className="text-[12px] text-muted-foreground underline underline-offset-4">
              فقط فایل سرور، برای نصب دستی
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
