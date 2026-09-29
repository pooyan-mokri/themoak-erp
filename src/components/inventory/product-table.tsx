'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  Barcode,
  ClipboardCheck,
  Edit,
  ExternalLink,
  Globe,
  Package,
  PackageCheck,
  PackageX,
  Plus,
  Search,
  Trash,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
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
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { deleteProduct } from '@/actions/product';
import { cn } from '@/lib/utils';
import { foldSearchText } from './audit-count-view';
import { GiftProductDialog } from './gift-product-dialog';
import { ProductForm } from './product-form';
import { ProductActions as ExcelActions } from './product-actions';
import { holdsStock } from '@/lib/stock-levels';
import { LOW_STOCK_MAX, PRODUCT_TYPE_LABELS, STOCK_STATUS, productTypeLabel, stockStatus } from './stock-status';

interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  productType?: string;
  costPrice?: any; // Decimal; absent without cost.view
  sellPrice?: any; // Decimal; absent without sales.view
  wooId?: number;
  webId?: string;
  image?: string;
  imageUrl?: string;
  siteUrl?: string;
}

/** Units in every warehouse, and in the physical ones (what can be sold). */
export type ProductStock = { total: number; sellable: number };

interface ProductTableProps {
  products: Product[];
  /** By product id; null when the stock could not be read. */
  stock: Record<string, ProductStock> | null;
  canSeeCost: boolean;
  canSeeSellPrice: boolean;
  canEditCost: boolean;
  canManage: boolean;
  canGift: boolean;
}

type Row = Product & { total: number; sellable: number; value: number };
const isStock = (r: Row) => holdsStock(r.productType || 'SALEABLE');

const VIEWS = [
  { id: 'all', label: 'همه', match: () => true },
  // Low and out of stock are stock products' states, as the dashboard's alert counts them.
  { id: 'low', label: 'موجودی کم', match: (r: Row) => isStock(r) && stockStatus(r.total) === 'low' },
  { id: 'out', label: 'ناموجود', match: (r: Row) => isStock(r) && stockStatus(r.total) === 'out' },
] as const;

type SortKey = 'name' | 'sku' | 'barcode' | 'productType' | 'total' | 'sellable' | 'costPrice' | 'sellPrice' | 'value';
const PAGE_SIZE = 25;
const RECEIVING_HREF = '/dashboard/suppliers/orders';
const AUDITS_HREF = '/dashboard/inventory/audits';
const NEW_HREF = '/dashboard/inventory/products/new';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-secondary px-1 font-mono text-[10px] font-normal leading-4 text-muted-foreground">
      {children}
    </kbd>
  );
}

export function ProductTable({ products, stock, canSeeCost, canSeeSellPrice, canEditCost, canManage, canGift }: ProductTableProps) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);

  const rows = useMemo<Row[]>(
    () =>
      products.map((p) => {
        const s = stock?.[p.id] ?? { total: 0, sellable: 0 };
        // Stock value is units × cost: only for roles that see the cost (the cost is not sent otherwise), and only
        // for the types held as stock (SALEABLE and OTHER, src/lib/stock-levels.ts), as on every stock screen.
        const value = canSeeCost && holdsStock(p.productType || 'SALEABLE') ? s.total * Number(p.costPrice ?? 0) : 0;
        return { ...p, total: s.total, sellable: s.sellable, value };
      }),
    [products, stock, canSeeCost],
  );
  const searchText = useMemo(
    () =>
      new Map(
        rows.map((r) => [r.id, [r.name, r.sku, r.webId, r.barcode].filter((v): v is string => !!v).map(foldSearchText)]),
      ),
    [rows],
  );

  // The type filter scopes everything: figures, view counts and the table.
  const scoped = useMemo(() => (type === 'all' ? rows : rows.filter((r) => (r.productType || 'SALEABLE') === type)), [rows, type]);
  const currentView = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const filtered = useMemo(() => {
    const q = foldSearchText(query);
    const list = scoped.filter((r) => {
      if (stock && !currentView.match(r)) return false;
      if (q && !(searchText.get(r.id) ?? []).some((t) => t.includes(q))) return false;
      return true;
    });
    const value = (r: Row): number | string =>
      sort.key === 'name' ? r.name
      : sort.key === 'sku' ? r.sku
      : sort.key === 'barcode' ? r.barcode ?? ''
      : sort.key === 'productType' ? productTypeLabel(r.productType)
      : sort.key === 'costPrice' ? Number(r.costPrice ?? 0)
      : sort.key === 'sellPrice' ? Number(r.sellPrice ?? 0)
      : r[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'fa') * dir;
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
    });
  }, [scoped, stock, currentView, query, searchText, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => {
    setPage(0);
    setCursor(0);
  }, [view, query, type, sort]);

  const counts = {
    all: scoped.length,
    low: scoped.filter((r) => isStock(r) && stockStatus(r.total) === 'low').length,
    out: scoped.filter((r) => isStock(r) && stockStatus(r.total) === 'out').length,
  };
  const units = scoped.reduce((sum, r) => sum + r.total, 0);
  const sellableUnits = scoped.reduce((sum, r) => sum + r.sellable, 0);
  const stockValue = scoped.reduce((sum, r) => sum + r.value, 0);

  // J/K move, Enter opens the product, F or / searches; R receiving, A stock counts, N a new product. Not while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable)) return;
      if (target?.closest?.('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [role="combobox"]')) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      // By key position, so the shortcuts work on a Persian layout too.
      const key = event.code;
      // Enter on a focused link or button is that control's own.
      if (key === 'Enter' && target && /^(A|BUTTON)$/.test(target.tagName)) return;
      if (key === 'KeyJ' || key === 'ArrowDown') {
        event.preventDefault();
        setCursor((c) => Math.min(pageRows.length - 1, c + 1));
      } else if (key === 'KeyK' || key === 'ArrowUp') {
        event.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (key === 'Enter' && pageRows[cursor]) {
        event.preventDefault();
        router.push(`/dashboard/inventory/products/${pageRows[cursor].id}`);
      } else if (key === 'KeyF' || key === 'Slash') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (key === 'KeyR') {
        event.preventDefault();
        router.push(RECEIVING_HREF);
      } else if (key === 'KeyA') {
        event.preventDefault();
        router.push(AUDITS_HREF);
      } else if (key === 'KeyN' && canManage) {
        event.preventDefault();
        router.push(NEW_HREF);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pageRows, cursor, router, canManage]);

  const SortHead = ({ k, children, end, className }: { k: SortKey; children: React.ReactNode; end?: boolean; className?: string }) => (
    <th className={cn('h-9 whitespace-nowrap bg-secondary px-3 text-xs font-normal text-muted-foreground', end ? 'text-end' : 'text-start', className)}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' }))}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {children}
        {sort.key === k && (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );
  const Head = ({ children, end, className }: { children?: React.ReactNode; end?: boolean; className?: string }) => (
    <th className={cn('h-9 whitespace-nowrap bg-secondary px-3 text-xs font-normal text-muted-foreground', end ? 'text-end' : 'text-start', className)}>
      {children}
    </th>
  );

  const filtersOn = view !== 'all' || !!query || type !== 'all';
  const columnCount = 4 + (stock ? 3 : 0) + (canSeeCost ? 2 : 0) + (canSeeSellPrice ? 1 : 0) + 1 + (canManage ? 1 : 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="تعریف کالا"
        description={
          <>
            {fa(products.length)} کالا · <Kbd>J</Kbd> <Kbd>K</Kbd> حرکت، <Kbd>↵</Kbd> باز کردن، <Kbd>F</Kbd> جستجو
          </>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={RECEIVING_HREF} title="سفارش‌های خرید و دریافت کالا در انبار">
                <PackageCheck className="h-4 w-4" />
                ورود کالا
                <Kbd>R</Kbd>
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={AUDITS_HREF}>
                <ClipboardCheck className="h-4 w-4" />
                انبارگردانی
                <Kbd>A</Kbd>
              </Link>
            </Button>
            <ExcelActions products={products} canSeeCost={canSeeCost} canSeeSellPrice={canSeeSellPrice} canManage={canManage} />
            <Button variant="outline" asChild>
              <Link href="/dashboard/inventory/products/labels">
                <Barcode className="h-4 w-4" />
                چاپ گروهی بارکد
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/inventory/web-ids">
                <Globe className="h-4 w-4" />
                شناسه‌های سایت
              </Link>
            </Button>
            {canManage && (
              <Button asChild>
                <Link href={NEW_HREF}>
                  <Plus className="h-4 w-4" />
                  افزودن کالا
                  <kbd className="rounded border border-white/30 px-1 font-mono text-[10px] font-normal leading-4 text-white/80">N</kbd>
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="کالاها"
          icon={Package}
          value={fa(scoped.length)}
          note={stock ? `${fa(units)} عدد در همهٔ انبارها` : undefined}
        />
        {stock && (
          <>
            <KpiCard label="موجودی کم" icon={TriangleAlert} value={fa(counts.low)} note={`${fa(LOW_STOCK_MAX)} عدد یا کمتر`} />
            <KpiCard label="ناموجود" icon={PackageX} value={fa(counts.out)} note="موجودی صفر یا کمتر" />
            {canSeeCost ? (
              <KpiCard label="ارزش موجودی" icon={Wallet} value={fa(stockValue)} unit="تومان" note="به قیمت خرید" />
            ) : (
              <KpiCard label="قابل فروش" value={fa(sellableUnits)} unit="عدد" note="در انبارهای فیزیکی" />
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {stock &&
          VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
                view === v.id ? 'border-foreground bg-foreground text-white' : 'bg-card hover:border-foreground/40',
              )}
            >
              {v.label}
              <span className="font-mono text-[11px] opacity-70">{fa(counts[v.id])}</span>
            </button>
          ))}
        <div className="flex-1" />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                e.currentTarget.blur();
              }
            }}
            placeholder="نام، SKU، بارکد یا شناسهٔ سایت"
            className="ps-8"
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-44" aria-label="نوع کالا">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">همهٔ انواع کالا</SelectItem>
            {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b">
                <SortHead k="name">نام کالا</SortHead>
                <SortHead k="sku">SKU</SortHead>
                <SortHead k="barcode" className="hidden 2xl:table-cell">بارکد</SortHead>
                <SortHead k="productType" className="hidden 2xl:table-cell">نوع</SortHead>
                {stock && <SortHead k="total" end>موجودی</SortHead>}
                {stock && <SortHead k="sellable" end>قابل فروش</SortHead>}
                {canSeeCost && <SortHead k="costPrice" end>قیمت خرید (تومان)</SortHead>}
                {canSeeSellPrice && <SortHead k="sellPrice" end>قیمت فروش (تومان)</SortHead>}
                {canSeeCost && <SortHead k="value" end className="hidden xl:table-cell">ارزش موجودی</SortHead>}
                {stock && <Head>وضعیت</Head>}
                <Head className="hidden 2xl:table-cell">ووکامرس (قدیمی)</Head>
                {canManage && <Head end>عملیات</Head>}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="h-24 px-4 text-center text-[13px] text-muted-foreground">
                    {products.length === 0 ? (
                      <>هنوز کالایی تعریف نشده است. با «افزودن کالا» یا «ورود از اکسل» شروع کنید.</>
                    ) : (
                      <>
                        کالایی با این نما، نوع یا جستجو پیدا نشد.{' '}
                        {filtersOn && (
                          <button
                            className="text-brand hover:underline"
                            onClick={() => {
                              setView('all');
                              setQuery('');
                              setType('all');
                            }}
                          >
                            نمایش همه
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              )}
              {pageRows.map((product, index) => {
                const photo = product.imageUrl || product.image;
                const status = STOCK_STATUS[stockStatus(product.total)];
                return (
                  <tr
                    key={product.id}
                    onClick={() => {
                      setCursor(index);
                      router.push(`/dashboard/inventory/products/${product.id}`);
                    }}
                    className={cn(
                      'h-11 cursor-pointer border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]',
                      index === cursor && 'shadow-[inset_-2px_0_0_#353DB2]',
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex min-w-[200px] items-center gap-2.5">
                        {/* The website's front-of-frame photo first: many frames share a code
                            family and a colour, and the photo is what tells them apart. */}
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-md border bg-secondary object-cover object-[50%_60%]" />
                        ) : (
                          <div className="h-9 w-9 shrink-0 rounded-md border bg-secondary" />
                        )}
                        <Link
                          href={`/dashboard/inventory/products/${product.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="min-w-0 truncate font-medium hover:text-brand hover:underline"
                        >
                          <bdi>{product.name}</bdi>
                        </Link>
                        {product.siteUrl && (
                          <a
                            href={product.siteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="مشاهده در سایت"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 text-muted-foreground hover:text-brand"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 font-mono text-[12px]">
                      <div className="flex flex-col items-start">
                        <span dir="ltr">{product.sku}</span>
                        {/* The barcode sits under the SKU until the screen has room for its own column. */}
                        {product.barcode && (
                          <span dir="ltr" className="text-[11px] text-muted-foreground 2xl:hidden">
                            {product.barcode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 font-mono text-[12px] text-muted-foreground 2xl:table-cell">
                      <span dir="ltr">{product.barcode || '—'}</span>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 2xl:table-cell">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
                        {productTypeLabel(product.productType)}
                      </span>
                    </td>
                    {stock && <td className="px-3 text-end font-medium tabular-nums">{fa(product.total)}</td>}
                    {stock && <td className="px-3 text-end tabular-nums text-muted-foreground">{fa(product.sellable)}</td>}
                    {canSeeCost && <td className="whitespace-nowrap px-3 text-end tabular-nums">{fa(Number(product.costPrice))}</td>}
                    {canSeeSellPrice && <td className="whitespace-nowrap px-3 text-end tabular-nums">{fa(Number(product.sellPrice))}</td>}
                    {canSeeCost && (
                      <td className="hidden whitespace-nowrap px-3 text-end tabular-nums text-muted-foreground xl:table-cell">
                        {product.value ? fa(product.value) : '—'}
                      </td>
                    )}
                    {stock && (
                      <td className="px-3">
                        <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', status.tone)}>{status.label}</span>
                      </td>
                    )}
                    <td className="hidden whitespace-nowrap px-3 text-[12.5px] text-muted-foreground 2xl:table-cell">
                      {product.wooId ? 'ثبت‌شده' : 'داخلی'}
                    </td>
                    {canManage && (
                      <td className="px-3" onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          product={product}
                          canEditCost={canEditCost}
                          canSeeSellPrice={canSeeSellPrice}
                          canManage={canManage}
                          canGift={canGift}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && stock && (
              <tfoot>
                <tr className="border-t bg-secondary text-[12.5px]">
                  <td className="h-9 px-3 text-muted-foreground" colSpan={2}>
                    {fa(filtered.length)} کالا
                  </td>
                  <td className="hidden 2xl:table-cell" />
                  <td className="hidden 2xl:table-cell" />
                  <td className="px-3 text-end font-medium tabular-nums">{fa(filtered.reduce((sum, r) => sum + r.total, 0))}</td>
                  <td className="px-3 text-end tabular-nums text-muted-foreground">{fa(filtered.reduce((sum, r) => sum + r.sellable, 0))}</td>
                  {canSeeCost && <td />}
                  {canSeeSellPrice && <td />}
                  {canSeeCost && (
                    <td className="hidden px-3 text-end font-medium tabular-nums xl:table-cell">
                      {fa(filtered.reduce((sum, r) => sum + r.value, 0))}
                    </td>
                  )}
                  <td />
                  <td className="hidden 2xl:table-cell" />
                  {canManage && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-[12.5px] text-muted-foreground">
            <span>
              {fa(page * PAGE_SIZE + 1)} تا {fa(Math.min(filtered.length, (page + 1) * PAGE_SIZE))} از {fa(filtered.length)}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                قبلی
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                بعدی
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RowActions({
  product,
  canEditCost,
  canSeeSellPrice,
  canManage,
  canGift,
}: {
  product: Product;
  canEditCost: boolean;
  canSeeSellPrice: boolean;
  canManage: boolean;
  canGift: boolean;
}) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteProduct(product.id);
    setIsDeleting(false);

    if (result.success) {
      toast.success(result.message);
      setIsDeleteOpen(false);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="flex items-center justify-end gap-0.5">
      {canGift && <GiftProductDialog productId={product.id} productName={product.name} />}

      {canManage && (
        <>
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="ویرایش">
                <Edit className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>ویرایش محصول</DialogTitle>
              </DialogHeader>
              <ProductForm
                initialData={product}
                onSuccess={() => setIsEditOpen(false)}
                canEditCost={canEditCost}
                canSeeSellPrice={canSeeSellPrice}
              />
            </DialogContent>
          </Dialog>

          <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-danger-soft hover:text-danger" title="حذف">
                <Trash className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  حذف «<bdi>{product.name}</bdi>»؟
                </AlertDialogTitle>
                <AlertDialogDescription>
                  کالای <span className="font-mono">{product.sku}</span> برای همیشه حذف می‌شود و این عملیات قابل بازگشت نیست. در صورت
                  وجود موجودی یا سفارش، امکان حذف وجود ندارد.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>انصراف</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: 'destructive' })}
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    handleDelete();
                  }}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'در حال حذف...' : 'حذف کالا'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
