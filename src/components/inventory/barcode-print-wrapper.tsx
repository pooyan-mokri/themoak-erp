'use client';

import { useState } from 'react';
import { BarcodeLabel } from './barcode-label';
import { BarcodeSizeSelector } from './barcode-size-selector';
import { PrintButton } from './print-barcode-button';

interface BarcodePrintWrapperProps {
  productName: string;
  sku: string;
  barcode: string;
  format: 'UPC' | 'EAN13' | 'CODE128';
}

export function BarcodePrintWrapper({
  productName,
  sku,
  barcode,
  format,
}: BarcodePrintWrapperProps) {
  const [width, setWidth] = useState(70); // Default: 70mm
  const [height, setHeight] = useState(40); // Default: 40mm

  const handleSizeChange = (newWidth: number, newHeight: number) => {
    setWidth(newWidth);
    setHeight(newHeight);
  };

  return (
    <div className="bg-white min-h-screen p-8 text-black print:p-0 print:min-h-0">
      <div className="max-w-4xl mx-auto print:w-auto print:max-w-none">
        {/* Controls - Hidden when printing */}
        <div className="mb-8 space-y-4 print:hidden">
          <div className="flex justify-between items-start gap-4">
            {/* Size Selector */}
            <div className="flex-1 max-w-md">
              <BarcodeSizeSelector
                currentWidth={width}
                currentHeight={height}
                onSizeChange={handleSizeChange}
              />
            </div>

            {/* Print Button */}
            <div>
              <PrintButton />
            </div>
          </div>
        </div>

        {/* Barcode Container - Centered for print */}
        <div className="flex flex-col items-center justify-center min-h-[400px] print:min-h-0 print:justify-start">
          <BarcodeLabel
            productName={productName}
            sku={sku}
            barcode={barcode}
            format={format}
            width={width}
            height={height}
          />
        </div>

        {/* Print Instructions - Hidden when printing */}
        <div className="mt-8 p-4 bg-blue-50 rounded-lg text-sm text-gray-700 print:hidden">
          <p className="font-semibold mb-2">راهنمای چاپ:</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>سایز مورد نظر خود را از گزینه‌های بالا انتخاب کنید</li>
            <li>برای چاپ روی دکمه "چاپ بارکد" کلیک کنید</li>
            <li>در پنجره چاپ، حتماً Margins را روی "None" قرار دهید</li>
            <li>برای نتیجه بهتر، از کاغذ برچسب مناسب استفاده کنید</li>
          </ul>
        </div>
      </div>

      {/* Print-specific styles */}
      <style jsx>{`
        @media print {
          @page {
            size: ${width}mm ${height}mm;
            margin: 0;
          }

          body {
            margin: 0;
            padding: 0;
          }
        }
      `}</style>
    </div>
  );
}
