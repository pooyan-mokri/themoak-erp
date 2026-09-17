'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { applyWebIdSeed, setProductWebId } from '@/actions/web-id';
import { SEED_STATUS_LABEL, type SeedPlan } from '@/lib/web-id-seed-plan';

type MissingProduct = { id: string; name: string; sku: string; sellPrice?: number };

const fa = (n: number) => n.toLocaleString('fa-IR');

export function WebIdManager({
  preview,
  missing,
  isAdmin,
}: {
  preview: SeedPlan;
  missing: MissingProduct[];
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-6">
      <SeedCard plan={preview} isAdmin={isAdmin} />
      <MissingCard products={missing} />
    </div>
  );
}

function SeedCard({ plan, isAdmin }: { plan: SeedPlan; isAdmin: boolean }) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const { counts } = plan;
  const flagged = plan.rows.filter((r) => r.status !== 'SET' && r.status !== 'ALREADY_SET');
  const allDone = plan.problems === 0 && counts.toSet === 0;

  const apply = async () => {
    setApplying(true);
    // Send the numbers the admin approved; the server refuses if they changed.
    const result = await applyWebIdSeed({ total: counts.total, toSet: counts.toSet });
    setApplying(false);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
    router.refresh();
  };

  const tiles: Array<{ label: string; value: number; bad?: boolean }> = [
    { label: 'سطر در فایل', value: counts.total },
    { label: 'آمادهٔ ثبت', value: counts.toSet },
    { label: 'از قبل ثبت‌شده', value: counts.alreadySet },
    { label: 'پیدا نشد', value: counts.notFound, bad: true },
    { label: 'تکراری در فایل', value: counts.duplicates, bad: true },
    { label: 'SKU عوض شده', value: counts.skuMismatch, bad: true },
    { label: 'تعارض شناسه', value: counts.conflicts, bad: true },
    ...(counts.badFormat > 0 ? [{ label: 'قالب نامعتبر', value: counts.badFormat, bad: true }] : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">پر کردن شناسه‌ها از فایل سایت</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          این فایل شناسهٔ هر عینک در سایت را کنار شناسهٔ همان کالا در ERP گذاشته. ثبت با شناسهٔ کالا انجام
          می‌شود، نه با نام. تا وقتی همهٔ سطرها بی‌مشکل نباشند، هیچ چیزی نوشته نمی‌شود.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border p-3 text-center">
              <div className={`text-2xl font-bold ${t.bad && t.value > 0 ? 'text-red-600' : ''}`}>{fa(t.value)}</div>
              <div className="text-xs text-muted-foreground mt-1">{t.label}</div>
            </div>
          ))}
        </div>

        {flagged.length > 0 && (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">شناسهٔ سایت</TableHead>
                  <TableHead className="text-right">کالا در فایل</TableHead>
                  <TableHead className="text-right">وضعیت فعلی در ERP</TableHead>
                  <TableHead className="text-right">مشکل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flagged.map((r) => (
                  <TableRow key={`${r.webId}-${r.erpProductId}`}>
                    <TableCell className="font-mono text-xs" dir="ltr">{r.webId}</TableCell>
                    <TableCell className="text-sm">
                      {r.erpName} <span className="font-mono text-xs text-muted-foreground">({r.erpSku})</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.currentSku ? (
                        <>
                          {r.currentName}{' '}
                          <span className="font-mono text-xs text-muted-foreground">({r.currentSku})</span>
                          {r.currentWebId && (
                            <div className="font-mono text-xs text-muted-foreground" dir="ltr">{r.currentWebId}</div>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="destructive">{SEED_STATUS_LABEL[r.status]}</Badge>
                      {r.takenBy && <div className="text-xs text-muted-foreground mt-1">{r.takenBy}</div>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {allDone ? (
          <p className="text-sm text-green-700">همهٔ شناسه‌های این فایل ثبت شده‌اند.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {plan.canApply
                ? `با تأیید، ${fa(counts.toSet)} کالا شناسهٔ سایت می‌گیرند.`
                : 'تا وقتی مشکلات بالا حل نشده، ثبت انجام نمی‌شود.'}
            </p>
            {isAdmin ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!plan.canApply || applying}>
                    {applying ? 'در حال ثبت...' : 'ثبت شناسه‌ها'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{`ثبت ${fa(counts.toSet)} شناسهٔ سایت؟`}</AlertDialogTitle>
                    <AlertDialogDescription>
                      بعد از ثبت، شناسه‌ها قفل می‌شوند و سایت کالاها را با همین‌ها پیدا می‌کند. اگر کالایی در این
                      فاصله تغییر کرده باشد، هیچ چیزی نوشته نمی‌شود.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>انصراف</AlertDialogCancel>
                    <AlertDialogAction onClick={apply}>ثبت</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <p className="text-xs text-muted-foreground">ثبت یک‌جا فقط برای مدیر سیستم است.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MissingCard({ products }: { products: MissingProduct[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">کالاهای فروختنی بدون شناسهٔ سایت ({fa(products.length)})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">همهٔ کالاهای فروختنی شناسهٔ سایت دارند.</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">کالا</TableHead>
                  <TableHead className="text-right">SKU</TableHead>
                  <TableHead className="text-right">شناسهٔ سایت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <MissingRow key={p.id} product={p} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          شناسه‌ای که یک بار ثبت شد را فقط از فرم ویرایش کالا و بعد از هشدار می‌شود عوض کرد.
        </p>
      </CardContent>
    </Card>
  );
}

function MissingRow({ product }: { product: MissingProduct }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const result = await setProductWebId(product.id, value);
    setSaving(false);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link href={`/dashboard/inventory/products/${product.id}`} className="hover:underline">
          {product.name}
        </Link>
      </TableCell>
      <TableCell className="font-mono text-xs">{product.sku}</TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Input
            dir="ltr"
            className="font-mono h-8 w-56"
            placeholder="MOAK-PANJ-BLUE"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim() && !saving) save();
            }}
          />
          <Button size="sm" onClick={save} disabled={saving || !value.trim()}>
            {saving ? '...' : 'ثبت'}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
