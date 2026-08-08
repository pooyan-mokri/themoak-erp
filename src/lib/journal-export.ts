/**
 * Journal (دفتر روزنامه) export helpers — Excel and print/PDF.
 *
 * PDF is produced through the browser's own print dialog ("Save as PDF")
 * rather than a JS PDF library: jsPDF/pdfkit do not perform Arabic/Persian
 * glyph shaping, so Persian text comes out disconnected and reversed. The
 * browser renders the same text correctly, including RTL layout.
 */

import * as XLSX from 'xlsx';
import { formatJalaliDate } from '@/lib/date-utils';

export type JournalRow = {
  date: Date | string;
  description?: string | null;
  type: string;
  amount: number | string;
  currency: string;
  amountInToman: number | string;
  accountName: string;
  category?: string | null;
};

export const TYPE_LABELS: Record<string, string> = {
  INCOME: 'درآمد',
  EXPENSE: 'هزینه',
  TRANSFER: 'انتقال',
  ADJUSTMENT: 'تعدیل',
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/** Income / expense totals in Toman, for the report footer. */
export function journalTotals(rows: JournalRow[]) {
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    const toman = Number(r.amountInToman) || 0;
    if (r.type === 'INCOME') income += toman;
    else if (r.type === 'EXPENSE') expense += toman;
  }
  return { income, expense, net: income - expense };
}

function periodLabel(from?: Date, to?: Date): string {
  if (from && to) return `از ${formatJalaliDate(from)} تا ${formatJalaliDate(to)}`;
  if (from) return `از ${formatJalaliDate(from)}`;
  if (to) return `تا ${formatJalaliDate(to)}`;
  return 'همه تاریخ‌ها';
}

export function exportJournalToExcel(rows: JournalRow[], from?: Date, to?: Date) {
  const totals = journalTotals(rows);

  const data = rows.map((r) => ({
    'تاریخ': formatJalaliDate(r.date),
    'شرح': r.description || '-',
    'نوع': typeLabel(r.type),
    'مبلغ': Number(r.amount) || 0,
    'ارز': r.currency,
    'مبلغ (تومان)': Number(r.amountInToman) || 0,
    'حساب': r.accountName,
    'دسته‌بندی': r.category || '-',
  }));

  // Blank spacer + totals so the figures are readable in Excel
  data.push({} as any);
  data.push({ 'شرح': 'جمع درآمد', 'مبلغ (تومان)': totals.income } as any);
  data.push({ 'شرح': 'جمع هزینه', 'مبلغ (تومان)': totals.expense } as any);
  data.push({ 'شرح': 'خالص', 'مبلغ (تومان)': totals.net } as any);

  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 14 }, { wch: 40 }, { wch: 10 }, { wch: 16 },
    { wch: 8 }, { wch: 18 }, { wch: 20 }, { wch: 16 },
  ];
  // Excel renders the sheet right-to-left
  (ws as any)['!views'] = [{ RTL: true }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'دفتر روزنامه');

  const stamp = formatJalaliDate(new Date()).replace(/\//g, '-');
  XLSX.writeFile(wb, `دفتر-روزنامه-${stamp}.xlsx`);
}

/**
 * Open a print-ready RTL view and trigger the browser print dialog, where the
 * user can choose "Save as PDF". Returns false if a popup blocker stopped it.
 */
export function printJournal(rows: JournalRow[], from?: Date, to?: Date): boolean {
  const totals = journalTotals(rows);
  const esc = (v: unknown) =>
    String(v ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

  const body = rows
    .map(
      (r, i) => `<tr>
      <td class="c">${(i + 1).toLocaleString('fa-IR')}</td>
      <td class="c">${esc(formatJalaliDate(r.date))}</td>
      <td>${esc(r.description || '-')}</td>
      <td class="c">${esc(typeLabel(r.type))}</td>
      <td class="n">${(Number(r.amount) || 0).toLocaleString('fa-IR')} ${esc(r.currency)}</td>
      <td class="n">${(Number(r.amountInToman) || 0).toLocaleString('fa-IR')}</td>
      <td>${esc(r.accountName)}</td>
      <td>${esc(r.category || '-')}</td>
    </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>دفتر روزنامه</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Vazirmatn, Tahoma, "Iranian Sans", sans-serif; direction: rtl; color: #111; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { font-size: 12px; color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #bbb; padding: 5px 6px; text-align: right; vertical-align: top; }
  th { background: #f1f1f1; font-weight: 700; }
  td.c, th.c { text-align: center; white-space: nowrap; }
  td.n { text-align: left; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #fafafa; }
  .totals { margin-top: 14px; width: 320px; margin-right: auto; font-size: 12px; }
  .totals td { border: 1px solid #bbb; padding: 6px 8px; }
  .totals td.n { text-align: left; font-weight: 700; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  @media print { .noprint { display: none; } }
</style></head>
<body>
  <h1>دفتر روزنامه</h1>
  <div class="sub">${esc(periodLabel(from, to))} — ${rows.length.toLocaleString('fa-IR')} سند — تاریخ چاپ: ${esc(formatJalaliDate(new Date()))}</div>
  <table>
    <thead><tr>
      <th class="c">ردیف</th><th class="c">تاریخ</th><th>شرح</th><th class="c">نوع</th>
      <th class="n">مبلغ</th><th class="n">مبلغ (تومان)</th><th>حساب</th><th>دسته‌بندی</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="8" class="c">سندی یافت نشد.</td></tr>'}</tbody>
  </table>
  <table class="totals"><tbody>
    <tr><td>جمع درآمد</td><td class="n">${totals.income.toLocaleString('fa-IR')} تومان</td></tr>
    <tr><td>جمع هزینه</td><td class="n">${totals.expense.toLocaleString('fa-IR')} تومان</td></tr>
    <tr><td>خالص</td><td class="n">${totals.net.toLocaleString('fa-IR')} تومان</td></tr>
  </tbody></table>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the browser a moment to lay the document out before printing
  setTimeout(() => win.print(), 350);
  return true;
}
