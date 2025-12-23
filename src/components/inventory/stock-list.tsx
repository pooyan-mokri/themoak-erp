'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useState } from 'react';

interface InventoryItem {
  productId: string;
  quantity: number;
  product: {
    name: string;
    sku: string;
    costPrice: any;
    sellPrice: any;
  };
}

interface StockListProps {
  inventory: InventoryItem[];
}

export function StockList({ inventory }: StockListProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredInventory = inventory.filter((item) =>
    item.product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.product.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="جستجو در موجودی (نام کالا یا SKU)..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pr-9"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">نام کالا</TableHead>
              <TableHead className="text-right">کد (SKU)</TableHead>
              <TableHead className="text-right">موجودی</TableHead>
              <TableHead className="text-right">ارزش واحد (خرید)</TableHead>
              <TableHead className="text-right">ارزش کل</TableHead>
              <TableHead className="text-right">وضعیت</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInventory.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  کالایی یافت نشد.
                </TableCell>
              </TableRow>
            ) : (
              filteredInventory.map((item) => (
                <TableRow key={item.productId}>
                  <TableCell className="font-medium">{item.product.name}</TableCell>
                  <TableCell className="text-muted-foreground">{item.product.sku}</TableCell>
                  <TableCell>
                    <span className={`font-bold ${item.quantity <= 10 ? 'text-red-600' : ''}`}>
                      {item.quantity}
                    </span>
                  </TableCell>
                  <TableCell>
                    {new Intl.NumberFormat('fa-IR').format(Number(item.product.costPrice))}
                  </TableCell>
                  <TableCell>
                    {new Intl.NumberFormat('fa-IR').format(Number(item.product.costPrice) * item.quantity)}
                  </TableCell>
                  <TableCell>
                    {item.quantity <= 0 ? (
                      <Badge variant="destructive">ناموجود</Badge>
                    ) : item.quantity <= 10 ? (
                      <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-600 text-white">کم‌موجودی</Badge>
                    ) : (
                      <Badge variant="default" className="bg-green-500 hover:bg-green-600">موجود</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
