import { prisma } from '@/lib/prisma';
import { randomInStoreEan13 } from '@/lib/barcode-format';

const MAX_TRIES = 20;

/**
 * A barcode for a product: a random in-store EAN-13 that no product has yet. It is not built from the SKU, whose
 * digits every colour of a model shares.
 */
export async function generateUniqueBarcode(client = prisma, random: () => number = Math.random): Promise<string> {
  for (let i = 0; i < MAX_TRIES; i++) {
    const barcode = randomInStoreEan13(random);
    const taken = await client.product.findUnique({ where: { barcode }, select: { id: true } });
    if (!taken) return barcode;
  }
  throw new Error(`No unused barcode found in ${MAX_TRIES} tries`);
}
