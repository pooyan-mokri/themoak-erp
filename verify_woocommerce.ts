
import { syncProducts, syncOrders } from './src/actions/woocommerce';
import { prisma } from './src/lib/prisma';
import wooCommerce from './src/lib/woocommerce';

// Mock the WooCommerce API
// We'll override the 'get' method temporarily for this script
const originalGet = wooCommerce.get;

// Mock Data
const mockProducts = [
  {
    id: 101,
    name: 'Woo Product 1',
    sku: 'WOO-101',
    price: '50000',
    stock_quantity: 10
  },
  {
    id: 102,
    name: 'Woo Product 2',
    sku: 'WOO-102',
    price: '75000',
    stock_quantity: 5
  }
];

const mockOrders = [
  {
    id: 201,
    number: '1001',
    status: 'completed',
    total: '125000',
    date_created: new Date().toISOString()
  }
];

// @ts-ignore
wooCommerce.get = async (endpoint: string) => {
  if (endpoint === 'products') {
    return { data: mockProducts };
  }
  if (endpoint === 'orders') {
    return { data: mockOrders };
  }
  return { data: [] };
};

async function verifyWooCommerce() {
  console.log('--- Verifying WooCommerce Integration ---');

  // 1. Ensure we have an account for transactions
  let account = await prisma.account.findFirst();
  if (!account) {
    account = await prisma.account.create({
      data: {
        name: 'Woo Test Account',
        type: 'Bank',
        currency: 'TOMAN',
        balance: 0
      }
    });
    console.log('Created test account');
  }

  // 2. Test Product Sync
  console.log('\n1. Syncing Products...');
  const productResult = await syncProducts();
  console.log('Product Sync Result:', productResult);

  const syncedProduct = await prisma.product.findUnique({
    where: { wooId: 101 }
  });
  
  if (syncedProduct) {
    console.log('Synced Product Found:', {
      name: syncedProduct.name,
      sku: syncedProduct.sku,
      price: syncedProduct.sellPrice
    });
  } else {
    console.error('FAILED: Product 101 not found');
  }

  // 3. Test Order Sync
  console.log('\n2. Syncing Orders...');
  const orderResult = await syncOrders();
  console.log('Order Sync Result:', orderResult);

  const syncedTransaction = await prisma.transaction.findUnique({
    where: { wooId: 201 }
  });

  if (syncedTransaction) {
    console.log('Synced Transaction Found:', {
      amount: syncedTransaction.amount,
      description: syncedTransaction.description,
      status: syncedTransaction.wooStatus
    });
  } else {
    console.error('FAILED: Transaction 201 not found');
  }

  console.log('\n--- Verification Complete ---');
}

verifyWooCommerce()
  .catch(e => console.error(e))
  .finally(async () => {
    // Restore original method (not strictly necessary as script exits, but good practice)
    wooCommerce.get = originalGet;
    await prisma.$disconnect();
  });
