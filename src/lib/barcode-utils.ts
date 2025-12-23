import { prisma } from '@/lib/prisma';

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

// Generate unique barcode for product (UPC/EAN compatible - 12 or 13 digits)
export function generateProductBarcode(sku: string): string {
  // Extract numeric part from SKU
  const numericPart = sku.replace(/[^0-9]/g, '');
  
  // Generate a unique numeric barcode (12 digits for UPC-A)
  // Use SKU numeric part + random digits to make it unique
  let baseNumber = numericPart || Math.floor(Math.random() * 1000000).toString();
  
  // Pad to 11 digits for UPC-A format (before check digit)
  const padded = baseNumber.padStart(11, '0');
  
  // Calculate check digit for UPC-A (12th digit)
  const checkDigit = calculateUPCACheckDigit(padded);
  
  return padded + checkDigit.toString();
}

// Ensure unique barcode
export async function ensureUniqueBarcode(baseBarcode: string): Promise<string> {
  let barcode = baseBarcode;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const existing = await prisma.product.findUnique({
      where: { barcode },
    });

    if (!existing) {
      return barcode;
    }

    // If exists, add random suffix
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    barcode = `${baseBarcode}-${random}`;
    attempts++;
  }

  // Fallback: use timestamp
  return `${baseBarcode}-${Date.now().toString().slice(-6)}`;
}

