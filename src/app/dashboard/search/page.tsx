'use client';

import { useState, useTransition, useEffect } from 'react';
import { globalSearch, SearchResult } from '@/actions/search';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Loader2, ShoppingCart, User, Package, Receipt, Truck } from 'lucide-react';
import Link from 'next/link';
import { formatJalaliDate } from '@/lib/date-utils';

const TYPE_LABELS: Record<string, { label: string; color: string; Icon: any }> = {
  order:       { label: 'فاکتور', color: 'bg-purple-100 text-purple-700', Icon: ShoppingCart },
  customer:    { label: 'مشتری', color: 'bg-blue-100 text-blue-700', Icon: User },
  product:     { label: 'محصول', color: 'bg-green-100 text-green-700', Icon: Package },
  transaction: { label: 'تراکنش', color: 'bg-orange-100 text-orange-700', Icon: Receipt },
  purchase:    { label: 'خرید', color: 'bg-red-100 text-red-700', Icon: Truck },
};

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      setSearched(true);
      startTransition(async () => {
        const res = await globalSearch(query.trim());
        setResults(res);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold tracking-tight">جستجوی کلی</h1>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          className="pr-10 h-12 text-base"
          placeholder="جستجو در مشتریان، فاکتورها، محصولات، تراکنش‌ها..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {isPending && (
          <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>

      {searched && !isPending && results.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          نتیجه‌ای برای «{query}» یافت نشد.
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{results.length} نتیجه</p>
          {results.map((r) => {
            const meta = TYPE_LABELS[r.type] || { label: r.type, color: 'bg-gray-100 text-gray-700', Icon: Receipt };
            const { Icon } = meta;
            return (
              <Link key={`${r.type}-${r.id}`} href={r.href}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardContent className="flex items-center gap-4 py-3 px-4">
                    <div className="flex-shrink-0">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{r.title}</span>
                        <Badge className={`${meta.color} border-0 text-[10px] px-1.5 py-0`}>{meta.label}</Badge>
                      </div>
                      {r.subtitle && (
                        <p className="text-sm text-muted-foreground truncate">{r.subtitle}</p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {r.amount !== undefined && (
                        <p className="text-sm font-medium">
                          {r.amount.toLocaleString('fa-IR')}
                          {r.currency ? ` ${r.currency}` : ' تومان'}
                        </p>
                      )}
                      {r.date && (
                        <p className="text-xs text-muted-foreground">{formatJalaliDate(r.date)}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
