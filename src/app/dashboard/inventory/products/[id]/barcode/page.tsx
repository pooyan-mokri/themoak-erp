import { getProductDetail } from '@/actions/product-detail';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/inventory/print-barcode-button';
import { BarcodeDisplay } from '@/components/inventory/barcode-display';

export default async function ProductBarcodePrintPage({
  params,
}: {
  params: { id: string };
}) {
  const product = await getProductDetail(params.id);

  if (!product || !product.barcode) {
    notFound();
  }

  // TypeScript doesn't recognize that notFound() never returns, so we assert here
  const productData = product;

  // Calculate UPC-A check digit
  function calculateUPCACheckDigit(barcode: string): number {
    let sumOdd = 0;
    let sumEven = 0;
    const digits = barcode.substring(0, 11).split('').map(Number);
    for (let i = 0; i < digits.length; i++) {
      if ((i + 1) % 2 !== 0) {
        sumOdd += digits[i];
      } else {
        sumEven += digits[i];
      }
    }
    const total = (sumOdd * 3) + sumEven;
    const remainder = total % 10;
    return remainder === 0 ? 0 : 10 - remainder;
  }

  // Calculate EAN-13 check digit
  function calculateEAN13CheckDigit(barcode: string): number {
    let sum = 0;
    const digits = barcode.substring(0, 12).split('').map(Number);
    for (let i = 0; i < digits.length; i++) {
      sum += digits[i] * (i % 2 === 0 ? 1 : 3);
    }
    const remainder = sum % 10;
    return remainder === 0 ? 0 : 10 - remainder;
  }

  // Generate UPC/EAN compatible barcode with valid check digit
  const barcodeValue = productData.barcode!.replace(/[^0-9]/g, ''); // Remove non-numeric characters
  let formattedBarcode = barcodeValue;
  let barcodeFormat = 'CODE128'; // Default to CODE128 which is more flexible
  
  if (barcodeValue.length === 12) {
    // Check if it's a valid UPC-A (has correct check digit)
    const dataPart = barcodeValue.substring(0, 11);
    const checkDigit = calculateUPCACheckDigit(dataPart);
    if (parseInt(barcodeValue[11]) === checkDigit) {
      barcodeFormat = 'UPC';
      formattedBarcode = barcodeValue;
    } else {
      // Fix check digit
      formattedBarcode = dataPart + checkDigit.toString();
      barcodeFormat = 'UPC';
    }
  } else if (barcodeValue.length === 13) {
    // Check if it's a valid EAN-13 (has correct check digit)
    const dataPart = barcodeValue.substring(0, 12);
    const checkDigit = calculateEAN13CheckDigit(dataPart);
    if (parseInt(barcodeValue[12]) === checkDigit) {
      barcodeFormat = 'EAN13';
      formattedBarcode = barcodeValue;
    } else {
      // Fix check digit
      formattedBarcode = dataPart + checkDigit.toString();
      barcodeFormat = 'EAN13';
    }
  } else if (barcodeValue.length < 12) {
    // Pad to 11 digits, calculate check digit for UPC-A
    const padded = barcodeValue.padStart(11, '0');
    const checkDigit = calculateUPCACheckDigit(padded);
    formattedBarcode = padded + checkDigit.toString();
    barcodeFormat = 'UPC';
  } else if (barcodeValue.length < 13) {
    // Pad to 12 digits, calculate check digit for EAN-13
    const padded = barcodeValue.padStart(12, '0');
    const checkDigit = calculateEAN13CheckDigit(padded);
    formattedBarcode = padded + checkDigit.toString();
    barcodeFormat = 'EAN13';
  } else {
    // If too long, truncate to 12 digits and use EAN-13
    const truncated = barcodeValue.substring(0, 12);
    const checkDigit = calculateEAN13CheckDigit(truncated);
    formattedBarcode = truncated + checkDigit.toString();
    barcodeFormat = 'EAN13';
  }

  return (
    <div className="bg-white min-h-screen p-8 text-black print:p-0">
        <div className="max-w-4xl mx-auto print:w-full print:max-w-none">
        {/* Print Button - Hidden when printing */}
        <div className="mb-8 flex justify-end print:hidden">
          <PrintButton />
        </div>

        {/* Barcode Container */}
        <div className="flex flex-col items-center justify-center min-h-[400px] print:min-h-0">
          <div className="border-4 border-black p-8 bg-white">
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold mb-2">{productData.name}</h2>
              <p className="text-sm text-gray-600">SKU: {productData.sku}</p>
            </div>
            <BarcodeDisplay barcode={formattedBarcode} format={barcodeFormat as 'UPC' | 'EAN13' | 'CODE128'} />
            <div className="text-center">
              <p className="font-mono text-lg font-bold">{formattedBarcode}</p>
            </div>
          </div>
        </div>
        </div>
      </div>
  );
}

