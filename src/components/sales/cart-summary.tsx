'use client';

import { Button } from '@/components/ui/button';
import { Minus, Plus, Trash2 } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  sellPrice: any;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface CartSummaryProps {
  cart: CartItem[];
  onRemove: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  total: number;
}

export function CartSummary({ cart, onRemove, onUpdateQuantity, total }: CartSummaryProps) {
  if (cart.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        سبد خرید خالی است
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4">
      {cart.map((item) => (
        <div key={item.product.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm md:text-base truncate">{item.product.name}</div>
            <div className="text-xs md:text-sm text-muted-foreground">
              {Number(item.product.sellPrice).toLocaleString()} تومان
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 md:h-8 md:w-8 touch-manipulation"
              onClick={() => onUpdateQuantity(item.product.id, -1)}
            >
              <Minus className="h-4 w-4 md:h-3 md:w-3" />
            </Button>
            <span className="w-8 md:w-6 text-center text-base md:text-sm font-bold text-primary dark:text-black bg-primary/10 rounded px-2 md:px-1">{item.quantity}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 md:h-8 md:w-8 touch-manipulation"
              onClick={() => onUpdateQuantity(item.product.id, 1)}
            >
              <Plus className="h-4 w-4 md:h-3 md:w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 md:h-8 md:w-8 text-red-500 hover:text-red-600 touch-manipulation"
              onClick={() => onRemove(item.product.id)}
            >
              <Trash2 className="h-5 w-5 md:h-4 md:w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
