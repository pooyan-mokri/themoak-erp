import { PrismaClient } from '@prisma/client';
import { createAsset, getAssets } from './src/actions/fixed-assets';

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
  console.log('--- Verifying Fixed Assets Module ---');

  // 1. Create Asset
  console.log('1. Creating Asset...');
  const formData = new FormData();
  const assetName = `MacBook Pro ${Date.now()}`;
  formData.append('name', assetName);
  // Set purchase date to 1 year ago to test depreciation
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  formData.append('purchaseDate', oneYearAgo.toISOString().split('T')[0]);
  formData.append('purchasePrice', '100000000'); // 100M Toman
  formData.append('salvageValue', '20000000'); // 20M Toman
  formData.append('usefulLife', '4'); // 4 Years

  await safeAction(createAsset, null, formData);

  // 2. Verify Asset Creation & Depreciation
  console.log('\n2. Verifying Asset & Depreciation...');
  const assets = await getAssets();
  const asset = assets.find((a: any) => a.name === assetName);

  if (!asset) {
    throw new Error('Asset creation failed');
  }

  console.log('Asset Found:', {
    name: asset.name,
    purchasePrice: Number(asset.purchasePrice),
    currentValue: Number(asset.currentValue),
    purchaseDate: asset.purchaseDate
  });

  // Calculation Check:
  // Cost: 100M, Salvage: 20M, Life: 4 Years
  // Depreciable Amount = 80M
  // Annual Depreciation = 20M
  // Age = 1 Year
  // Expected Value = 100M - 20M = 80M
  
  const expectedValue = 80000000;
  // Allow small margin of error due to date precision
  const difference = Math.abs(Number(asset.currentValue) - expectedValue);
  
  if (difference > 1000000) { // Allow 1M tolerance for day differences
    throw new Error(`Depreciation calculation mismatch. Expected ~${expectedValue}, got ${asset.currentValue}`);
  }

  console.log('Depreciation calculation verified.');
  console.log('--- Verification Complete ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
