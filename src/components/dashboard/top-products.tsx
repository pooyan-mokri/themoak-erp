import { SectionCard } from './section-card';

const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n);

/** The best sellers of the last 30 days, with a bar against the first. */
export function TopProducts({ products }: { products: Array<{ id: string; name: string; units: number }> }) {
  const most = Math.max(1, ...products.map((product) => product.units));
  return (
    <SectionCard title="پرفروش‌ترین" count="۳۰ روز">
      {products.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">در ۳۰ روز اخیر فروشی ثبت نشده است.</p>
      ) : (
        <div className="divide-y">
          {products.map((product, index) => (
            <div key={product.id} className="flex min-h-10 items-center gap-3 py-1.5">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded font-mono text-[11px] ${index < 3 ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground'}`}
              >
                {fa(index + 1)}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" dir="ltr" style={{ textAlign: 'start' }}>
                {product.name}
              </span>
              <span className="hidden h-1.5 w-20 bg-secondary sm:block">
                <span className="block h-full bg-brand" style={{ width: `${(product.units / most) * 100}%` }} />
              </span>
              <span className="w-14 shrink-0 text-end text-[12.5px] text-muted-foreground">{fa(product.units)} عدد</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
