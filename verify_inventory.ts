
import { PrismaClient } from '@prisma/client';
import { createProduct } from './src/actions/product';
import { adjustStock, transferStock } from './src/actions/inventory';

const prisma = new PrismaClient();

async function safeAction(action: Function, ...args: any[]) {
  try {
    return await action(...args);
  } catch (error: any) {
    if (error.message.includes('static generation store missing') || error.message === 'NEXT_REDIRECT' || error.digest?.startsWith('NEXT_REDIRECT')) {
      console.log('Ignoring Next.js revalidatePath/redirect error (expected in script)');
      return { success: true, message: 'Action completed (revalidate/redirect skipped)' };
    }
    throw error;
  }
}

async function main() {
  console.log('--- Verifying Inventory Management ---');

  // 1. Setup: Get/Create Warehouses
  console.log('1. Setting up Warehouses...');
  let mainWarehouse = await prisma.warehouse.findFirst({ where: { isVirtual: false, name: 'Main Warehouse' } });
  if (!mainWarehouse) {
    mainWarehouse = await prisma.warehouse.create({ data: { name: 'Main Warehouse', isVirtual: false } });
  }
  console.log('Main Warehouse:', mainWarehouse.id);

  let secondaryWarehouse = await prisma.warehouse.findFirst({ where: { isVirtual: false, name: 'Secondary Warehouse' } });
  if (!secondaryWarehouse) {
    secondaryWarehouse = await prisma.warehouse.create({ data: { name: 'Secondary Warehouse', isVirtual: false } });
  }
  console.log('Secondary Warehouse:', secondaryWarehouse.id);

  // 2. Create Product
  console.log('\n2. Creating Test Product...');
  const productFormData = new FormData();
  const sku = `INV-TEST-${Date.now()}`;
  productFormData.append('name', 'Inventory Test Product');
  productFormData.append('sku', sku);
  productFormData.append('costPrice', '50000');
  productFormData.append('sellPrice', '80000');
  
  await safeAction(createProduct, null, productFormData);
  
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error('Product creation failed');
  console.log('Product created:', product.id);

  // 3. Manual Adjustment (Add Stock)
  console.log('\n3. Adjusting Stock (Adding 100 to Main)...');
  const adjustResult = await safeAction(adjustStock, product.id, mainWarehouse.id, 100);
  console.log('Adjustment Result:', adjustResult);

  let mainStock = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: mainWarehouse.id } }
  });
  console.log('Main Warehouse Stock:', mainStock?.quantity);
  if (mainStock?.quantity !== 100) throw new Error('Stock adjustment failed');

  // 4. Transfer Stock
  console.log('\n4. Transferring Stock (30 from Main to Secondary)...');
  const transferResult = await safeAction(transferStock, product.id, mainWarehouse.id, secondaryWarehouse.id, 30);
  console.log('Transfer Result:', transferResult);

  mainStock = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: mainWarehouse.id } }
  });
  let secStock = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: secondaryWarehouse.id } }
  });

  console.log('Main Warehouse Stock:', mainStock?.quantity);
  console.log('Secondary Warehouse Stock:', secStock?.quantity);

  if (mainStock?.quantity !== 70 || secStock?.quantity !== 30) {
    throw new Error('Stock transfer failed');
  }

  // 5. Manual Adjustment (Remove Stock)
  console.log('\n5. Adjusting Stock (Removing 5 from Secondary)...');
  const removeResult = await safeAction(adjustStock, product.id, secondaryWarehouse.id, -5);
  console.log('Adjustment Result:', removeResult);

  secStock = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: secondaryWarehouse.id } }
  });
  console.log('Secondary Warehouse Stock:', secStock?.quantity);

  if (secStock?.quantity !== 25) {
    throw new Error('Stock removal failed');
  }

  console.log('\n--- Verification Complete ---');
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
