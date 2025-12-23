
'use client';

import { Button } from '@/components/ui/button';
import { Download, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { importProducts } from '@/actions/product';
import { toast } from 'sonner';
import { useRef, useState } from 'react';

interface ProductActionsProps {
  products: any[];
}

export function ProductActions({ products }: ProductActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleExport = () => {
    const data = products.map(p => ({
      name: p.name,
      sku: p.sku,
      costPrice: Number(p.costPrice),
      sellPrice: Number(p.sellPrice),
      image: p.image,
      wooId: p.wooId
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "products.xlsx");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        const result = await importProducts(data);
        if (result.success) {
          toast.success(`${result.successCount} محصول با موفقیت وارد/بروزرسانی شد.`);
          if (result.errorCount > 0) {
            toast.warning(`${result.errorCount} محصول با خطا مواجه شد.`);
          }
        } else {
          toast.error("خطا در وارد کردن محصولات");
        }
      } catch (error) {
        console.error("Import error:", error);
        toast.error("خطا در خواندن فایل اکسل");
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={handleExport}>
        <Download className="mr-2 h-4 w-4" />
        خروجی اکسل
      </Button>
      <Button variant="outline" onClick={handleImportClick} disabled={importing}>
        <Upload className="mr-2 h-4 w-4" />
        {importing ? 'در حال وارد کردن...' : 'ورود از اکسل'}
      </Button>
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept=".xlsx, .xls"
      />
    </div>
  );
}
