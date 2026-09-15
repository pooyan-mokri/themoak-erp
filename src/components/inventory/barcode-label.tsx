import { BarcodeDisplay } from './barcode-display';

interface BarcodeLabelProps {
  productName: string;
  sku: string;
  barcode: string;
  format: 'UPC' | 'EAN13' | 'CODE128';
  width: number; // mm
  height: number; // mm
}

// One printed label. The text under the bars is the stored code as it is, so it matches what the scanner reads.
export function BarcodeLabel({ productName, sku, barcode, format, width, height }: BarcodeLabelProps) {
  return (
    <div
      className="border-4 border-black bg-white text-black print:border-2 flex flex-col items-center justify-center"
      style={{
        width: `${width}mm`,
        height: `${height}mm`,
        padding: '4mm',
      }}
    >
      {/* Product Name - Scaled based on container size */}
      <div className="text-center mb-1" style={{ fontSize: `${Math.min(width / 20, 5)}mm` }}>
        <h2 className="font-bold leading-tight line-clamp-2">{productName}</h2>
      </div>

      {/* SKU - Smaller text */}
      <div className="text-center mb-1" style={{ fontSize: `${Math.min(width / 30, 3)}mm` }}>
        <p className="text-gray-600">SKU: {sku}</p>
      </div>

      {/* Barcode - Flexible sizing */}
      <div className="flex-1 flex items-center justify-center w-full" style={{ minHeight: `${height * 0.4}mm` }}>
        <BarcodeDisplay barcode={barcode} format={format} />
      </div>

      {/* Barcode Number */}
      <div className="text-center mt-1" style={{ fontSize: `${Math.min(width / 25, 4)}mm` }}>
        <p className="font-mono font-bold" dir="ltr">{barcode}</p>
      </div>
    </div>
  );
}
