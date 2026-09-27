import Link from 'next/link';
import { SectionCard } from './section-card';

interface LowStockItem {
  id: string;
  name: string;
  sku: string;
  totalStock: number;
  warehouses: Array<{ name: string; quantity: number }>;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n);

/** Products running low: a meter, the name and SKU, what is left and where, and its status in words. */
export function LowStockAlert({ items }: { items: LowStockItem[] }) {
  return (
    <SectionCard
      title="هشدار موجودی"
      count={fa(items.length)}
      link={{ href: '/dashboard/inventory/products', label: 'همه ←' }}
    >
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">همهٔ کالاها موجودی کافی دارند.</p>
      ) : (
        <div className="divide-y">
          {items.map((item) => {
            const out = item.totalStock <= 0;
            return (
              <Link
                key={item.id}
                href={`/dashboard/inventory/products/${item.id}`}
                className="-mx-2 flex min-h-11 items-center gap-3 rounded px-2 py-1.5 transition-colors duration-150 hover:bg-brand/[.04]"
              >
                <span className="flex h-7 w-1.5 shrink-0 items-end bg-secondary">
                  <span
                    className={`block w-full ${out ? 'h-full bg-danger' : 'bg-warning'}`}
                    style={out ? undefined : { height: `${Math.max(20, Math.min(100, item.totalStock * 15))}%` }}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12.5px]" dir="ltr" style={{ textAlign: 'start' }}>
                    {item.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    <span className="font-mono">{item.sku}</span>
                    {item.warehouses.length > 0 && ` · ${item.warehouses.map((w) => `${w.name}: ${fa(w.quantity)}`).join('، ')}`}
                  </span>
                </span>
                <span className="w-8 shrink-0 text-end text-[13.5px] font-medium tabular-nums">{fa(item.totalStock)}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${out ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}
                >
                  {out ? 'تمام شد' : 'کم'}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
