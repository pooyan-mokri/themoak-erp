'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { toast } from 'sonner';
import { Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  countNonStandardBarcodes,
  getProductsForLabels,
  replaceNonStandardBarcodes,
} from '@/actions/product';
import { barcodeFormatFor, isStandardBarcode } from '@/lib/barcode-format';
import { BarcodeLabel } from './barcode-label';
import { BarcodeSizeSelector } from './barcode-size-selector';

type LabelProduct = Awaited<ReturnType<typeof getProductsForLabels>>[number];

const ALL_WAREHOUSES = 'all';

// getProductsForLabels returns at most this many rows.
const LABEL_ROWS_CAP = 2000;

const fa = (n: number) => n.toLocaleString('fa-IR');

interface BarcodeLabelsViewProps {
  warehouses: Array<{ id: string; name: string }>;
  isAdmin: boolean;
  initialNonStandardCount: number;
}

export function BarcodeLabelsView({ warehouses, isAdmin, initialNonStandardCount }: BarcodeLabelsViewProps) {
  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState(ALL_WAREHOUSES);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [nonStandardOnly, setNonStandardOnly] = useState(false);

  // Results
  const [products, setProducts] = useState<LabelProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set<string>());

  // Print options
  const [copies, setCopies] = useState<'one' | 'stock'>('one');
  const [layout, setLayout] = useState<'label' | 'a4'>('label');
  const [width, setWidth] = useState(70);
  const [height, setHeight] = useState(40);

  // Admin: replace non-standard barcodes
  const [nonStandardCount, setNonStandardCount] = useState(initialNonStandardCount);
  const [replacing, setReplacing] = useState(false);
  // After a replace, only the products given a new code are listed, chosen for printing their new labels.
  const [replacedIds, setReplacedIds] = useState<Set<string> | null>(null);

  const hasWarehouse = warehouseId !== ALL_WAREHOUSES;
  const perStock = copies === 'stock' && hasWarehouse;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getProductsForLabels({
      search: debouncedSearch || undefined,
      warehouseId: hasWarehouse ? warehouseId : undefined,
      inStockOnly: hasWarehouse && inStockOnly,
      nonStandardOnly,
    })
      .then((list) => {
        if (cancelled) return;
        setProducts(list);
        // Keep only choices still in the list, so nothing off-screen gets printed.
        setSelected((prev) => new Set(list.filter((p) => prev.has(p.id)).map((p) => p.id)));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Error loading products for labels:', error);
        toast.error('خطا در دریافت لیست کالاها.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, warehouseId, hasWarehouse, inStockOnly, nonStandardOnly, reloadKey]);

  const visible = useMemo(
    () => (replacedIds ? products.filter((p) => replacedIds.has(p.id)) : products),
    [products, replacedIds],
  );
  const chosen = useMemo(() => products.filter((p) => selected.has(p.id)), [products, selected]);
  const withoutBarcode = chosen.filter((p) => !p.barcode).length;

  const labels = useMemo(() => {
    const list: Array<{ key: string; name: string; sku: string; barcode: string }> = [];
    for (const p of chosen) {
      if (!p.barcode) continue;
      const count = perStock ? Math.max(0, p.quantity ?? 0) : 1;
      for (let i = 0; i < count; i++) {
        list.push({ key: `${p.id}-${i}`, name: p.name, sku: p.sku, barcode: p.barcode });
      }
    }
    return list;
  }, [chosen, perStock]);

  const allSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(visible.map((p) => p.id)) : new Set<string>());
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleReplace = async () => {
    if (!confirm(`بارکد ${fa(nonStandardCount)} کالا با بارکد استاندارد ۱۳ رقمی عوض می‌شود. برچسب‌های قبلی این کالاها دیگر خوانده نمی‌شوند. ادامه؟`)) {
      return;
    }

    setReplacing(true);
    try {
      const result = await replaceNonStandardBarcodes();
      if (result.success) {
        toast.success(result.message);
        const ids = new Set(result.replacedIds ?? []);
        if (ids.size > 0) {
          // List every product again, then show and choose just the replaced ones.
          setSearch('');
          setDebouncedSearch('');
          setInStockOnly(false);
          setNonStandardOnly(false);
          setReplacedIds(ids);
          setSelected(ids);
        }
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error('Error replacing non-standard barcodes:', error);
      toast.error('خطا در جایگزینی بارکدها. لطفاً دوباره تلاش کنید.');
    } finally {
      setReplacing(false);
      setReloadKey((key) => key + 1);
      countNonStandardBarcodes()
        .then(setNonStandardCount)
        .catch((error) => console.error('Error counting non-standard barcodes:', error));
    }
  };

  // Label printer: the page is the label. A4: labels flow in a grid inside the page margins.
  const printCss =
    layout === 'label'
      ? `@media print { @page { size: ${width}mm ${height}mm; margin: 0; } body { margin: 0; padding: 0; } }`
      : `@media print { @page { size: A4; margin: 8mm; } body { margin: 0; padding: 0; } }`;

  const sheet = useMemo(() => {
    const box: CSSProperties = { width: `${width}mm`, height: `${height}mm`, overflow: 'hidden' };

    if (layout === 'label') {
      return (
        <div className="flex flex-wrap gap-4 print:block">
          {labels.map((label, index) => {
            const last = index === labels.length - 1;
            return (
              <div
                key={label.key}
                style={{ ...box, breakAfter: last ? 'auto' : 'page', pageBreakAfter: last ? 'auto' : 'always' }}
              >
                <BarcodeLabel
                  productName={label.name}
                  sku={label.sku}
                  barcode={label.barcode}
                  format={barcodeFormatFor(label.barcode)}
                  width={width}
                  height={height}
                />
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${width}mm)`, gap: '2mm' }}>
        {labels.map((label) => (
          <div key={label.key} style={{ ...box, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <BarcodeLabel
              productName={label.name}
              sku={label.sku}
              barcode={label.barcode}
              format={barcodeFormatFor(label.barcode)}
              width={width}
              height={height}
            />
          </div>
        ))}
      </div>
    );
  }, [labels, layout, width, height]);

  return (
    <div>
      <style>{printCss}</style>

      <div className="space-y-6 print:hidden">
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>جایگزینی بارکدهای غیراستاندارد</CardTitle>
              <CardDescription>
                تعداد کالاهای دارای بارکد غیراستاندارد: {fa(nonStandardCount)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                onClick={handleReplace}
                disabled={replacing || nonStandardCount === 0}
              >
                {replacing ? (
                  <>
                    <RefreshCw className="h-4 w-4 ml-2 animate-spin" />
                    در حال جایگزینی...
                  </>
                ) : (
                  'جایگزینی با بارکد استاندارد'
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>فیلترها</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="labels-search">جستجو</Label>
              <Input
                id="labels-search"
                value={search}
                onChange={(e) => {
                  setReplacedIds(null);
                  setSearch(e.target.value);
                }}
                placeholder="جستجوی کالا..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="labels-warehouse">انبار</Label>
              <Select
                value={warehouseId}
                onValueChange={(value) => {
                  setReplacedIds(null);
                  setWarehouseId(value);
                }}
              >
                <SelectTrigger id="labels-warehouse">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_WAREHOUSES}>همهٔ انبارها</SelectItem>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="labels-in-stock"
                checked={hasWarehouse && inStockOnly}
                disabled={!hasWarehouse}
                onCheckedChange={(checked) => {
                  setReplacedIds(null);
                  setInStockOnly(checked === true);
                }}
              />
              <Label htmlFor="labels-in-stock">فقط کالاهای موجود در این انبار</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="labels-non-standard"
                checked={nonStandardOnly}
                onCheckedChange={(checked) => {
                  setReplacedIds(null);
                  setNonStandardOnly(checked === true);
                }}
              />
              <Label htmlFor="labels-non-standard">فقط بارکدهای غیراستاندارد</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>کالاها</CardTitle>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="labels-select-all"
                  checked={allSelected}
                  disabled={visible.length === 0}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                />
                <Label htmlFor="labels-select-all">انتخاب همه</Label>
              </div>
            </div>
            <CardDescription>
              {loading
                ? 'در حال بارگذاری...'
                : `${fa(visible.length)} کالا، ${fa(chosen.length)} انتخاب‌شده`}
            </CardDescription>
            {replacedIds && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <span>
                  بارکد {fa(replacedIds.size)} کالا عوض شد و برای چاپ انتخاب شده‌اند. برچسب‌های قبلی این کالاها را از روی فریم‌ها بردارید.
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => setReplacedIds(null)}>
                  نمایش همهٔ کالاها
                </Button>
              </div>
            )}
            {!loading && products.length >= LABEL_ROWS_CAP && (
              <p className="text-sm text-amber-600">
                فقط {fa(LABEL_ROWS_CAP)} کالای اول نشان داده می‌شود؛ برای دیدن بقیه، جستجو یا فیلتر را دقیق‌تر کنید.
              </p>
            )}
          </CardHeader>
          <CardContent>
            <div className="max-h-[28rem] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>نام کالا</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>بارکد</TableHead>
                    {hasWarehouse && <TableHead>موجودی</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={hasWarehouse ? 5 : 4} className="text-center text-muted-foreground">
                        {loading ? 'در حال بارگذاری...' : 'کالایی یافت نشد.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visible.map((p) => {
                      const nonStandard = !isStandardBarcode(p.barcode);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(p.id)}
                              onCheckedChange={(checked) => toggleOne(p.id, checked === true)}
                              aria-label={`انتخاب ${p.name}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs" dir="ltr">{p.sku}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              {p.barcode ? (
                                <span className="font-mono text-xs" dir="ltr">{p.barcode}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">بدون بارکد</span>
                              )}
                              {nonStandard && <Badge variant="destructive">غیراستاندارد</Badge>}
                            </div>
                          </TableCell>
                          {hasWarehouse && <TableCell>{fa(p.quantity ?? 0)}</TableCell>}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>تنظیمات چاپ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>تعداد برچسب</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={perStock ? 'outline' : 'default'}
                      onClick={() => setCopies('one')}
                    >
                      یک برچسب برای هر کالا
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={perStock ? 'default' : 'outline'}
                      disabled={!hasWarehouse}
                      onClick={() => setCopies('stock')}
                    >
                      به تعداد موجودی در انبار انتخاب‌شده
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>چیدمان</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={layout === 'label' ? 'default' : 'outline'}
                      onClick={() => setLayout('label')}
                    >
                      چاپگر برچسب (هر برچسب یک صفحه)
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={layout === 'a4' ? 'default' : 'outline'}
                      onClick={() => setLayout('a4')}
                    >
                      برگهٔ A4
                    </Button>
                  </div>
                </div>
              </div>
              <BarcodeSizeSelector
                currentWidth={width}
                currentHeight={height}
                onSizeChange={(newWidth, newHeight) => {
                  setWidth(newWidth);
                  setHeight(newHeight);
                }}
              />
            </div>

            {withoutBarcode > 0 && (
              <p className="text-sm text-amber-600">
                {fa(withoutBarcode)} کالای انتخاب‌شده بارکد ندارد و برچسبی برایش چاپ نمی‌شود.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <Button onClick={() => window.print()} disabled={loading || labels.length === 0}>
                <Printer className="h-4 w-4 ml-2" />
                چاپ {fa(labels.length)} برچسب
              </Button>
              <p className="text-xs text-muted-foreground">
                {layout === 'label'
                  ? 'در پنجرهٔ چاپ، Margins را روی «None» بگذارید.'
                  : 'در پنجرهٔ چاپ، Margins را روی «Default» بگذارید.'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 print:mt-0">
        <p className="mb-3 text-sm text-muted-foreground print:hidden">
          {labels.length === 0
            ? 'برای چاپ، کالاها را از جدول انتخاب کنید.'
            : `پیش‌نمایش ${fa(labels.length)} برچسب`}
        </p>
        {sheet}
      </div>
    </div>
  );
}
