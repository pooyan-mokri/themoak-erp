/**
 * Questions to start from, by subject. Each subject shows only to a user whose
 * role may run the tool that answers it (src/lib/ai-agent.ts); the server still
 * checks every tool call.
 */
export type AssistantAccess = {
  stock: boolean; // stock.view: inventory summary, product search
  finance: boolean; // finance.view: sales and financial summaries
  salesManage: boolean; // sales.manage: create a customer
};

export type SuggestionGroup = { id: string; label: string; items: string[] };

export function suggestionGroups(access: AssistantAccess): SuggestionGroup[] {
  const groups: Array<SuggestionGroup & { allowed: boolean }> = [
    {
      id: 'stock',
      label: 'انبار',
      allowed: access.stock,
      items: ['موجودی انبار چطوره؟', 'کدوم محصولات موجودیشون کمه؟', 'کالاهایی که اسمشون «PANJ» داره رو پیدا کن'],
    },
    {
      id: 'sales',
      label: 'فروش',
      allowed: access.finance,
      items: ['فروش این ماه چقدر بوده؟', 'فروش ۷ روز اخیر و تعداد سفارش‌ها رو بگو', 'میانگین مبلغ هر سفارش در ۳۰ روز اخیر چقدره؟'],
    },
    {
      id: 'finance',
      label: 'مالی',
      allowed: access.finance,
      items: ['وضعیت مالی چطوره؟', 'درآمد و هزینهٔ ۳۰ روز اخیر رو مقایسه کن', 'موجودی حساب‌ها چقدره؟'],
    },
    {
      id: 'actions',
      label: 'ثبت',
      allowed: access.salesManage,
      // Not an expense: record_expense needs an account id, which the assistant is never given.
      items: ['یک مشتری جدید به نام … با شمارهٔ … ثبت کن'],
    },
  ];
  return groups.filter((g) => g.allowed && g.items.length > 0).map(({ allowed: _allowed, ...g }) => g);
}
