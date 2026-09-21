import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  createConsignmentPartner,
  deleteConsignmentOrder,
  getConsignmentPartners,
  getPartnerStatement,
  getPendingSettlements,
  paySettlement,
  recordConsignmentSales,
  returnConsignmentStock,
  transferStockBatch,
  updateConsignmentPartner,
} from '@/actions/consignment';
import { getConsignmentReport } from '@/actions/consignment-reports';
import { getConsignmentCommissionsReport } from '@/actions/consignment-commissions';
import {
  createMarketingCampaign,
  createMarketingGift,
  getMarketingCampaigns,
  getMarketingGifts,
  getMarketingStats,
} from '@/actions/marketing';
import { createAsset, deleteAsset, getAssets, postDepreciation } from '@/actions/fixed-assets';
import { deleteProductImage, deleteReceipt, uploadProductImage, uploadReceipt } from '@/actions/upload';
import { COST_KEYS, DENIED, exposed } from './stock-helpers';

const COST = 300_000;
const SELL = 1_000_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** A partner (10% commission) holding 5 frames, with one unpaid sale of 1 frame; a real warehouse holding 5 more. */
async function consignment() {
  const customer = await prisma.customer.create({ data: { name: 'همکار', commissionRate: 10 } });
  const partner = await prisma.warehouse.create({ data: { name: 'انبار امانی - همکار', isVirtual: true, customerId: customer.id } });
  const main = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: SELL } });
  await prisma.inventory.createMany({
    data: [
      { productId: product.id, warehouseId: partner.id, quantity: 5 },
      { productId: product.id, warehouseId: main.id, quantity: 5 },
    ],
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      status: 'COMPLETED',
      paymentStatus: 'UNPAID',
      totalAmount: SELL * 0.9,
      paidAmount: 0,
      items: { create: [{ productId: product.id, warehouseId: partner.id, quantity: 1, price: SELL }] },
      commissions: { create: [{ customerId: customer.id, commissionRate: 10, orderAmount: SELL, commissionAmount: SELL * 0.1, isPaid: true }] },
    },
  });
  const account = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  return { customer, partner, main, product, order, account };
}

test('consignment: SALES and ACCOUNTANT get sale amounts and commissions but no stock value at cost; AUDITOR gets it', async () => {
  const s = await consignment();

  for (const role of ['SALES', 'ACCOUNTANT']) {
    setTestRole(role);
    const report = await getConsignmentReport();
    assert.deepEqual(exposed(report, COST_KEYS), [], role);
    assert.deepEqual([report.grandTotals.totalSales, report.grandTotals.totalCommissions, report.partners[0].inventoryQuantity], [SELL * 0.9, SELL * 0.1, 5], role);

    const statement = (await getPartnerStatement(s.partner.id))!;
    assert.deepEqual(exposed(statement, COST_KEYS), [], role);
    assert.deepEqual([statement.logistics.currentStockQty, statement.financials.grossSales, statement.financials.commissionTotal], [5, SELL, SELL * 0.1], role);

    const pending = await getPendingSettlements();
    assert.deepEqual(exposed(pending, COST_KEYS), [], role);
    assert.deepEqual([pending[0].grossAmount, pending[0].items[0].price, Number(pending[0].items[0].product.sellPrice)], [SELL, SELL, SELL], role);

    assert.equal((await getConsignmentCommissionsReport()).grandTotal, SELL * 0.9, role);
    assert.equal((await getConsignmentPartners()).length, 1, role);
  }

  setTestRole('AUDITOR');
  const report = await getConsignmentReport();
  assert.deepEqual([report.partners[0].inventoryValue, report.grandTotals.totalInventoryValue], [5 * COST, 5 * COST]);
  assert.equal((await getPartnerStatement(s.partner.id))!.logistics.currentStockValue, 5 * COST);
  assert.equal(Number((await getPendingSettlements())[0].items[0].product.costPrice), COST);

  for (const role of ['WAREHOUSE', 'PROJECT_MANAGER', null]) {
    setTestRole(role);
    await assert.rejects(getConsignmentReport(), AccessDenied, String(role));
    await assert.rejects(getPartnerStatement(s.partner.id), AccessDenied, String(role));
    await assert.rejects(getPendingSettlements(), AccessDenied, String(role));
    await assert.rejects(getConsignmentCommissionsReport(), AccessDenied, String(role));
    await assert.rejects(getConsignmentPartners(), AccessDenied, String(role));
  }
});

test('consignment writes, including the settlement payment, take sales.manage and write nothing otherwise', async () => {
  const s = await consignment();
  const state = async () => ({
    customers: await prisma.customer.findMany({ orderBy: { id: 'asc' } }),
    stock: (await prisma.inventory.findMany({ orderBy: { warehouseId: 'asc' } })).map((row: any) => row.quantity),
    orders: await prisma.order.findMany({ orderBy: { id: 'asc' } }),
    transactions: await prisma.transaction.count(),
    movements: await prisma.inventoryMovement.count(),
  });
  const before = await state();
  const line = [{ productId: s.product.id, quantity: 1 }];

  for (const role of ['AUDITOR', 'WAREHOUSE']) {
    setTestRole(role);
    for (const result of [
      await createConsignmentPartner(undefined, form({ name: 'جدید' })),
      await updateConsignmentPartner(s.partner.id, undefined, form({ name: 'تغییر' })),
      await transferStockBatch({ sourceWarehouseId: s.main.id, targetWarehouseId: s.partner.id, items: line }),
      await returnConsignmentStock({ partnerWarehouseId: s.partner.id, targetWarehouseId: s.main.id, items: line }),
      await recordConsignmentSales({ partnerWarehouseId: s.partner.id, saleDate: '2026-09-01', items: [{ ...line[0], unitPrice: SELL }] }),
      await paySettlement(undefined, form({ orderId: s.order.id, accountId: s.account.id })),
      await deleteConsignmentOrder(s.order.id),
    ]) {
      assert.equal(result.message, DENIED, role);
    }
    assert.deepEqual(await state(), before, role);
  }

  setTestRole('SALES');
  assert.equal((await transferStockBatch({ sourceWarehouseId: s.main.id, targetWarehouseId: s.partner.id, items: line })).success, true);
  assert.equal((await paySettlement(undefined, form({ orderId: s.order.id, accountId: s.account.id }))).success, true);
  assert.equal(Number((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).paidAmount), SELL * 0.9);
});

/** A campaign with a budget of 1,000,000 and a gift of 2 frames costing 600,000; 5 frames in stock. */
async function marketing() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: SELL } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 5 } });
  // A gift is booked on an EXPENSE account only (it costs no cash).
  const account = await prisma.account.create({ data: { name: 'تبلیغات', type: 'EXPENSE', currency: 'TOMAN', balance: 1000 } });
  const campaign = await prisma.marketingCampaign.create({
    data: { name: 'یلدا', type: 'EVENT', startDate: new Date(), budget: 1_000_000, spentAmount: 2 * COST, status: 'ACTIVE' },
  });
  await prisma.marketingGift.create({
    data: { productId: product.id, quantity: 2, accountId: account.id, campaignId: campaign.id, costPrice: COST, totalCost: 2 * COST, recipientName: 'اینفلوئنسر' },
  });
  return { warehouse, product, account, campaign };
}

test('marketing: SALES sees gifts, campaigns and budgets without gift cost, spend or account balance; AUDITOR sees the cost', async () => {
  await marketing();
  const HIDDEN = ['costPrice', 'totalCost', 'spentAmount', 'totalSpent', 'remainingBudget', 'cost', 'balance'];

  for (const role of ['SALES', 'ACCOUNTANT']) {
    setTestRole(role);
    const gifts = await getMarketingGifts();
    assert.deepEqual(exposed(gifts, HIDDEN), [], role);
    assert.deepEqual([gifts[0].quantity, gifts[0].product?.name, gifts[0].account.name, gifts[0].campaign?.budget], [2, 'PANJ', 'تبلیغات', 1_000_000], role);
    const campaigns = await getMarketingCampaigns();
    assert.deepEqual(exposed(campaigns, HIDDEN), [], role);
    const stats = await getMarketingStats();
    assert.deepEqual(exposed(stats, HIDDEN), [], role);
    assert.deepEqual([stats.totalGifts, stats.totalQuantity, stats.totalBudget, stats.giftsByProduct[0].quantity], [1, 2, 1_000_000, 2], role);
  }

  setTestRole('AUDITOR');
  const gifts = await getMarketingGifts();
  assert.deepEqual([gifts[0].costPrice, gifts[0].totalCost, (gifts[0].campaign as any).spentAmount !== undefined], [COST, 2 * COST, true]);
  assert.equal((await getMarketingCampaigns())[0].spentAmount, 2 * COST);
  assert.deepEqual([(await getMarketingStats()).totalCost, (await getMarketingStats()).remainingBudget], [2 * COST, 1_000_000 - 2 * COST]);

  setTestRole('WAREHOUSE');
  await assert.rejects(getMarketingGifts(), AccessDenied);
  await assert.rejects(getMarketingStats(), AccessDenied);
});

test('gift and campaign writes take sales.manage, and a gift goes on an expense account only', async () => {
  const s = await marketing();
  const gift = () =>
    createMarketingGift(
      undefined,
      form({ items: JSON.stringify([{ productId: s.product.id, quantity: 1, warehouseId: s.warehouse.id }]), recipientName: 'مشتری', accountId: s.account.id, date: '2026-09-01' }),
    );
  const counts = async () => [
    await prisma.marketingGift.count(),
    await prisma.marketingCampaign.count(),
    (await prisma.inventory.findFirstOrThrow()).quantity,
    await prisma.transaction.count(),
  ];

  for (const role of ['AUDITOR', 'WAREHOUSE']) {
    setTestRole(role);
    assert.equal((await gift()).message, DENIED, role);
    assert.equal((await createMarketingCampaign(undefined, form({ name: 'نوروز', type: 'EVENT', startDate: '2026-03-20' }))).message, DENIED, role);
    assert.deepEqual(await counts(), [1, 1, 5, 0], role);
  }

  setTestRole('SALES');
  assert.equal((await createMarketingCampaign(undefined, form({ name: 'نوروز', type: 'EVENT', startDate: '2026-03-20' }))).success, true);
  assert.equal((await gift()).success, true);

  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 1_000_000_000 } });
  const onBank = await createMarketingGift(
    undefined,
    form({ items: JSON.stringify([{ productId: s.product.id, quantity: 1, warehouseId: s.warehouse.id }]), recipientName: 'مشتری', accountId: bank.id, date: '2026-09-01' }),
  );
  assert.equal(onBank.message, 'هدیه فقط روی حساب هزینه ثبت می‌شود؛ «بانک» حساب هزینه نیست.');
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance), 1_000_000_000);
});

test('fixed assets: reading takes finance.view; creating, depreciating and deleting take finance.manage', async () => {
  const asset = await prisma.fixedAsset.create({
    data: { name: 'لپ‌تاپ', purchaseDate: new Date('2024-01-01'), purchasePrice: 50_000_000, salvageValue: 0, usefulLife: 5 },
  });
  const assetForm = () => form({ name: 'میز', assetType: 'FIXED', purchaseDate: '2025-01-01', purchasePrice: '1000', salvageValue: '0', usefulLife: '2' });

  for (const role of ['WAREHOUSE', 'SALES', null]) {
    setTestRole(role);
    await assert.rejects(getAssets(), AccessDenied, String(role));
  }

  setTestRole('AUDITOR');
  assert.equal((await getAssets())[0].purchasePrice, 50_000_000);
  for (const role of ['AUDITOR', 'WAREHOUSE', 'SALES']) {
    setTestRole(role);
    assert.equal((await createAsset(undefined, assetForm())).message, DENIED, role);
    assert.equal((await postDepreciation(asset.id)).message, DENIED, role);
    assert.equal((await deleteAsset(asset.id)).message, DENIED, role);
  }
  assert.deepEqual([await prisma.fixedAsset.count(), await prisma.transaction.count()], [1, 0]);

  setTestRole('ACCOUNTANT');
  assert.equal((await createAsset(undefined, assetForm())).success, true);
  assert.equal((await postDepreciation(asset.id)).success, true);
  assert.equal((await deleteAsset(asset.id)).success, true);
  assert.deepEqual([await prisma.fixedAsset.count(), await prisma.transaction.count()], [1, 1]);
});

test('uploads take the permission of their use and write nothing otherwise; the FTP helpers are not endpoints', async () => {
  const listing = (dir: string) => {
    try {
      return readdirSync(join(process.cwd(), 'public', 'uploads', dir)).sort();
    } catch {
      return [];
    }
  };
  const before = [listing('receipts'), listing('products')];
  const file = (type: string) => {
    const data = new FormData();
    data.append('file', new File(['not really an image'], 'x.png', { type }));
    return data;
  };

  for (const role of ['WAREHOUSE', 'SALES', 'AUDITOR', 'USER', null]) {
    setTestRole(role);
    assert.equal((await uploadReceipt(file('image/png'))).error, DENIED, String(role));
    assert.equal((await deleteReceipt('/uploads/receipts/none.png')).error, DENIED, String(role));
  }
  for (const role of ['SALES', 'ACCOUNTANT', 'AUDITOR', 'USER', null]) {
    setTestRole(role);
    assert.equal((await uploadProductImage(file('image/png'))).error, DENIED, String(role));
    assert.equal((await deleteProductImage('/uploads/products/none.png')).error, DENIED, String(role));
  }
  assert.deepEqual([listing('receipts'), listing('products')], before);

  // The permitted roles get past the check (to the file validation, which writes nothing).
  setTestRole('ACCOUNTANT');
  assert.match((await uploadReceipt(file('text/plain'))).error ?? '', /Invalid file type/);
  setTestRole('WAREHOUSE');
  assert.match((await uploadProductImage(file('text/plain'))).error ?? '', /Invalid file type/);

  const ftp = readFileSync(join(process.cwd(), 'src/lib/ftp.ts'), 'utf8');
  assert.doesNotMatch(ftp, /^\s*['"]use server['"]/m);
});
