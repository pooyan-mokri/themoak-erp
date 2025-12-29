'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Search, Plus } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  sku: string;
  sellPrice: any;
  image?: string;
}

interface ProductGridProps {
  products: Product[];
  onAddToCart: (product: Product) => void;
  cart?: { product: Product; quantity: number }[];
}

export function ProductGrid({ products, onAddToCart, cart = [] }: ProductGridProps) {
  const [search, setSearch] = useState('');

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const getProductQuantity = (productId: string) => {
    const cartItem = cart.find(item => item.product.id === productId);
    return cartItem?.quantity || 0;
  };

  return (
    <div className="space-y-4 md:space-y-4">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 md:h-4 md:w-4 text-muted-foreground" />
        <Input
          placeholder="جستجوی محصول (نام یا SKU)..."
          className="pr-10 h-12 md:h-10 text-base md:text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-4">
        {filteredProducts.map((product) => {
          const quantity = getProductQuantity(product.id);
          return (
            <Card
              key={product.id}
              className="cursor-pointer hover:border-primary transition-colors group relative"
              onClick={() => onAddToCart(product)}
            >
              {quantity > 0 && (
                <div className="absolute top-2 left-2 z-10 bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-lg border-2 border-white">
                  {quantity}
                </div>
              )}
              <CardContent className="p-3 md:p-4 flex flex-col items-center text-center space-y-2">
                <div className="w-full aspect-square bg-gray-100 rounded-md flex items-center justify-center text-gray-400">
                  {/* Placeholder for image */}
                  {product.image ? (
                      <img src={product.image} alt={product.name} className="w-full h-full object-cover rounded-md" />
                  ) : (
                      <span className="text-xs">بدون تصویر</span>
                  )}
                </div>
                <div className="font-medium text-xs md:text-sm line-clamp-2 min-h-[2.5rem] md:min-h-[2.75rem]">{product.name}</div>
                <div className="text-[10px] md:text-xs text-muted-foreground">{product.sku}</div>
                <div className="font-bold text-primary text-sm md:text-base">
                  {Number(product.sellPrice).toLocaleString()} تومان
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
