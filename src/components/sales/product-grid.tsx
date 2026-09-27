'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ScanBarcode } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { buildScanIndex, resolveScan } from '@/lib/audit-scan';
import { foldSearchText } from '@/components/inventory/audit-count-view';
import { cn } from '@/lib/utils';

interface Product {
  id: string;
  name: string;
  sku: string;
  sellPrice: any;
  image?: string;
  imageUrl?: string;
  barcode?: string;
  webId?: string;
}

interface ProductGridProps {
  products: Product[];
  onAddToCart: (product: Product) => void;
  cart?: { product: Product; quantity: number }[];
  /** Quantity per product in the sale's warehouse; null when the role may not see stock. */
  stock?: Record<string, number> | null;
  warehouseName?: string;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;

/** Typing in a field, or inside an open dialog, sheet, list or menu: the page's shortcuts stay out of the way. */
function isBusyTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return true;
  return !!el.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [role="combobox"]');
}

/**
 * The POS catalogue, barcode first: F focuses the search, a scanner types into it and ends with Enter, and Enter adds
 * the exact code (barcode, SKU or website ID) or else the first product whose name matches.
 */
export function ProductGrid({ products, onAddToCart, cart = [], stock = null, warehouseName }: ProductGridProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const scanIndex = useMemo(
    () => buildScanIndex(products.map((p) => ({ productId: p.id, barcode: p.barcode, sku: p.sku, webId: p.webId }))),
    [products],
  );
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const searchable = useMemo(
    () =>
      products.map((p) => ({
        product: p,
        text: [p.name, p.sku, p.barcode, p.webId].filter((v): v is string => !!v).map(foldSearchText),
      })),
    [products],
  );

  const query = foldSearchText(search);
  const scan = resolveScan(scanIndex, search);
  const exact = scan.kind === 'match' ? byId.get(scan.productId) : undefined;
  const matches = useMemo(
    () => (query ? searchable.filter((s) => s.text.some((t) => t.includes(query))).map((s) => s.product) : products),
    [searchable, products, query],
  );
  // The exact code first: that is what Enter adds.
  const results = exact ? [exact, ...matches.filter((p) => p.id !== exact.id)] : matches;
  const enterTarget = !query || scan.kind === 'ambiguous' ? undefined : exact ?? results[0];

  const quantityInCart = (productId: string) => cart.find((item) => item.product.id === productId)?.quantity ?? 0;

  // Ready to scan on a desktop; a phone would pop its keyboard up instead.
  useEffect(() => {
    if (isDesktop()) inputRef.current?.focus();
  }, []);

  // F focuses the search (by key position, so it works on a Persian layout too). A digit typed outside any field
  // moves focus to the search first, so a scan is not lost after clicking a card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isBusyTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      if (event.code === 'KeyF') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (/^(Digit|Numpad)\d$/.test(event.code)) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const add = (product: Product) => {
    onAddToCart(product);
    if (isDesktop()) inputRef.current?.focus();
  };

  const addFromSearch = () => {
    if (scan.kind === 'empty') return;
    if (scan.kind === 'ambiguous') {
      toast.error(`کد «${scan.code}» به چند کالا می‌خورد؛ کالا را از فهرست انتخاب کنید.`);
      inputRef.current?.select();
      return;
    }
    if (!enterTarget) {
      toast.error(
        scan.kind === 'unknown' && scan.persianLayout
          ? 'کالایی پیدا نشد. صفحه‌کلید روی فارسی است؛ آن را انگلیسی کنید و دوباره اسکن کنید.'
          : `کالایی با «${search.trim()}» پیدا نشد.`,
      );
      inputRef.current?.select();
      return;
    }
    onAddToCart(enterTarget);
    setSearch('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <ScanBarcode className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addFromSearch();
            } else if (e.key === 'Escape' && search) {
              e.preventDefault();
              setSearch('');
            }
          }}
          placeholder="بارکد را اسکن کنید، یا نام، SKU یا شناسهٔ سایت را بنویسید"
          autoComplete="off"
          spellCheck={false}
          aria-label="جستجوی کالا یا بارکد"
          className="ps-9 md:pe-10"
        />
        <kbd className="pointer-events-none absolute end-2.5 top-1/2 hidden -translate-y-1/2 rounded border bg-secondary px-1.5 font-mono text-[10.5px] text-muted-foreground md:block">
          F
        </kbd>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        <span className="min-w-0 truncate">
          {query ? `${fa(results.length)} نتیجه` : `${fa(products.length)} کالا`}
          {enterTarget && (
            <>
              {' · '}
              <span className="font-mono">↵</span> «<bdi>{enterTarget.name}</bdi>» را اضافه می‌کند
            </>
          )}
        </span>
        <span>
          قیمت‌ها به تومان
          {stock && warehouseName && ` · موجودی انبار ${warehouseName}`}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
            {products.length === 0
              ? 'هنوز کالایی تعریف نشده است؛ کالاها را از بخش انبارداری اضافه کنید.'
              : 'کالایی با این نام، SKU یا بارکد پیدا نشد. املای آن را بررسی کنید یا بارکد را دوباره اسکن کنید.'}
          </div>
        ) : (
          // As many columns as the catalogue's own width holds: it shares the row with the cart.
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
            {results.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                inCart={quantityInCart(product.id)}
                stock={stock ? stock[product.id] ?? 0 : null}
                isEnterTarget={enterTarget?.id === product.id}
                onAdd={add}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({
  product,
  inCart,
  stock,
  isEnterTarget,
  onAdd,
}: {
  product: Product;
  inCart: number;
  stock: number | null;
  isEnterTarget: boolean;
  onAdd: (product: Product) => void;
}) {
  const photo = product.imageUrl || product.image;
  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border bg-card text-start transition-colors duration-150 hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        (inCart > 0 || isEnterTarget) && 'border-brand',
      )}
    >
      <div className="relative aspect-[4/3] w-full bg-secondary">
        {photo ? (
          // The website's photo is portrait with the frame just below the middle.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={product.name} loading="lazy" className="h-full w-full object-cover object-[50%_59%]" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[11.5px] text-muted-foreground">بدون تصویر</span>
        )}
        {inCart > 0 && (
          <span className="absolute start-2 top-2 rounded-full bg-brand px-2 py-0.5 text-[11px] tabular-nums text-white">
            {fa(inCart)} در سبد
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <p dir="auto" className="line-clamp-2 min-h-[2.5em] text-[13px] font-medium leading-snug">
          {product.name}
        </p>
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
          <span className="truncate font-mono" dir="ltr">
            {product.sku}
          </span>
          {stock !== null &&
            (stock <= 0 ? (
              <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] text-danger">ناموجود</span>
            ) : (
              <span className="shrink-0 tabular-nums">{fa(stock)} موجود</span>
            ))}
        </div>
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-[13.5px] font-medium tabular-nums">{fa(Number(product.sellPrice))}</span>
          <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-soft text-brand">
            <Plus className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </button>
  );
}
