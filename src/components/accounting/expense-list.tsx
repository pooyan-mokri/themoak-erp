'use client';

import { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react';
import { formatJalaliDate } from '@/lib/date-utils';

interface Expense {
  id: string;
  date: Date;
  description?: string;
  amount: any;
  currency: string;
  category?: string;
  account?: { name: string };
  employee?: { name: string };
}

export function ExpenseList({ expenses }: { expenses: Expense[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'description'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Get unique categories from expenses
  const categories = useMemo(() => {
    const cats = expenses.map(e => e.category).filter(Boolean) as string[];
    return Array.from(new Set(cats)).sort();
  }, [expenses]);

  // Filter and sort expenses
  const filteredAndSortedExpenses = useMemo(() => {
    let filtered = expenses.filter(expense => {
      // Search filter
      const matchesSearch = !searchQuery || 
        expense.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        expense.account?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        expense.employee?.name?.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Category filter
      const matchesCategory = categoryFilter === 'all' || expense.category === categoryFilter;
      
      return matchesSearch && matchesCategory;
    });

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'amount':
          comparison = Number(a.amount) - Number(b.amount);
          break;
        case 'description':
          comparison = (a.description || '').localeCompare(b.description || '');
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [expenses, searchQuery, categoryFilter, sortBy, sortOrder]);

  const handleSort = (field: 'date' | 'amount' | 'description') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const SortButton = ({ field, children }: { field: 'date' | 'amount' | 'description', children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto p-0 font-normal hover:bg-transparent"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortBy === field ? (
          sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        )}
      </div>
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>لیست هزینه‌ها</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters and Search */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="جستجو (شرح، حساب، کارمند)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="دسته‌بندی" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه دسته‌بندی‌ها</SelectItem>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(searchQuery || categoryFilter !== 'all') && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                setSearchQuery('');
                setCategoryFilter('all');
              }}
              className="flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Results count */}
        <div className="text-sm text-muted-foreground">
          {filteredAndSortedExpenses.length} هزینه از {expenses.length} هزینه
        </div>

        {/* Table */}
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">
                  <SortButton field="date">تاریخ</SortButton>
                </TableHead>
                <TableHead>
                  <SortButton field="description">شرح</SortButton>
                </TableHead>
                <TableHead className="w-[100px]">
                  <SortButton field="amount">مبلغ</SortButton>
                </TableHead>
                <TableHead className="w-[80px]">ارز</TableHead>
                <TableHead>حساب</TableHead>
                {categories.length > 0 && (
                  <TableHead className="w-[120px]">دسته‌بندی</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={categories.length > 0 ? 6 : 5} className="text-center text-muted-foreground py-8">
                    {searchQuery || categoryFilter !== 'all' 
                      ? 'هزینه‌ای با فیلترهای انتخابی یافت نشد.' 
                      : 'هیچ هزینه‌ای ثبت نشده است.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedExpenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="font-medium">{formatJalaliDate(expense.date)}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={expense.description || ''}>
                      {expense.description}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {Number(expense.amount).toLocaleString('fa-IR')}
                    </TableCell>
                    <TableCell>{expense.currency}</TableCell>
                    <TableCell>
                      {expense.account ? (
                        expense.account.name
                      ) : expense.employee ? (
                        <span className="text-sm text-muted-foreground">حساب شخصی: {expense.employee.name}</span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    {categories.length > 0 && (
                      <TableCell>
                        <span className="text-xs px-2 py-1 bg-muted rounded-full">
                          {expense.category || '-'}
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
