import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  createConsignmentPartner,
  getConsignmentPartnerById,
  getConsignmentPartners,
  getPartnerStatement,
  recordConsignmentSales,
  returnConsignmentStock,
  transferStock,
  transferStockBatch,
  updateConsignmentPartner,
} from '@/actions/consignment';
import { CHANNELS_FIELD } from '@/lib/consignment-channels';
import { DENIED, NON_SELLERS, NON_VIEWERS, SELLERS, VIEWERS, assertInvariants, quantityOf, sleep, snapshot, stockIn } from '../sales/world';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const COST = 300_000;
const PRICE = 1_000_000;

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const channels = (rows: Array<{ name: string; commissionRate: number | string; isDefault?: boolean; isActive?: boolean; id?: string }>) =>
  JSON.stringify(rows.map((row) => ({ isDefault: false, isActive: true, ...row })));

async function newPartner(name = 'همکار', rows = channels([{ name: 'آنلاین', commissionRate: 30, isDefault: true }, { name: 'حضوری', commissionRate: 35 }])) {
  const created = await createConsignmentPartner(undefined, form({ name, phone: '09120000000', address: 'تهران', [CHANNELS_FIELD]: rows }));
  assert.equal(created.message, 'همکار امانی با موفقیت ایجاد شد.', created.message);
  return prisma.warehouse.findFirstOrThrow({ where: { name: `انبار امانی - ${name}` }, include: { customer: true } });
}

/** Our shop with 10 frames and 4 cases, and a partner. */
async function world() {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: COST, sellPrice: PRICE } });
  const caseItem = await prisma.product.create({ data: { name: 'جلد', sku: 'CASE', costPrice: 10_000, sellPrice: 50_000 } });
  await stockIn(frame.id, store.id, 10);
  await stockIn(caseItem.id, store.id, 4);
  const partner = await newPartner();
  return { store, frame, caseItem, partner };
}
type World = Awaited<ReturnType<typeof world>>;

// --- partners and channels ---

test('a new partner is a customer with its own consignment warehouse and its channels; the default rate mirrors onto the customer', async () => {
  const partner = await newPartner();
  assert.deepEqual([partner.isVirtual, partner.customer?.name, partner.customer?.phone, Number(partner.customer?.commissionRate)], [true, 'همکار', '09120000000', 30]);
  const rows = await prisma.consignmentChannel.findMany({ where: { customerId: partner.customerId! }, orderBy: { sortOrder: 'asc' } });
  assert.deepEqual(rows.map((c: any) => [c.name, Number(c.commissionRate), c.isDefault, c.isActive, c.sortOrder]), [
    ['آنلاین', 30, true, true, 0],
    ['حضوری', 35, false, true, 1],
  ]);

  // A form with no channels (an older screen) still gets one default channel, on its rate.
  const created = await createConsignmentPartner(undefined, form({ name: 'قدیمی', commissionRate: '12.5' }));
  assert.equal(created.message, 'همکار امانی با موفقیت ایجاد شد.');
  const old = await prisma.warehouse.findFirstOrThrow({ where: { name: 'انبار امانی - قدیمی' } });
  const [only] = await prisma.consignmentChannel.findMany({ where: { customerId: old.customerId! } });
  assert.deepEqual([only.name, Number(only.commissionRate), only.isDefault], ['پیش‌فرض', 12.5, true]);

  const listed = await getConsignmentPartners();
  assert.deepEqual(listed.map((p: any) => p.customer.name).sort(), ['قدیمی', 'همکار']);
  assert.deepEqual((await getConsignmentPartnerById(partner.id))!.customer.channels.map((c: any) => c.commissionRate), [30, 35]);
  assert.equal(await getConsignmentPartnerById('no-such-warehouse'), undefined);
});

test('channels that break the rules are refused with the reason, and nothing is created', async () => {
  const before = await snapshot();
  const refuse = async (rows: string, reason: string) => {
    const result = await createConsignmentPartner(undefined, form({ name: 'همکار', [CHANNELS_FIELD]: rows }));
    assert.equal(result.message, reason, rows);
  };
  await refuse(channels([{ name: 'آنلاین', commissionRate: 101 }]), 'کانال فروش باید نام داشته باشد و درصد کمیسیون بین ۰ تا ۱۰۰ باشد.');
  await refuse(channels([{ name: 'آنلاین', commissionRate: -1 }]), 'کانال فروش باید نام داشته باشد و درصد کمیسیون بین ۰ تا ۱۰۰ باشد.');
  await refuse(channels([{ name: ' ', commissionRate: 10 }]), 'کانال فروش باید نام داشته باشد و درصد کمیسیون بین ۰ تا ۱۰۰ باشد.');
  await refuse(channels([{ name: 'آنلاین', commissionRate: 10 }, { name: 'آنلاین ', commissionRate: 20 }]), 'نام کانال‌های فروش نباید تکراری باشد.');
  await refuse(channels([{ name: 'آنلاین', commissionRate: 10, isActive: false }]), 'حداقل یک کانال فروش باید فعال باشد.');
  await refuse(channels([{ name: 'الف', commissionRate: 10, isDefault: true }, { name: 'ب', commissionRate: 20, isDefault: true }]), 'فقط یک کانال فروش می‌تواند پیش‌فرض باشد.');
  await refuse('[]', 'حداقل یک کانال فروش لازم است.');
  await refuse('not json', 'کانال‌های فروش خوانده نشد.');
  const noName = await createConsignmentPartner(undefined, form({ name: '' }));
  assert.equal(noName.message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.deepEqual(await snapshot(), before);
});

test('editing a partner renames its warehouse and rewrites its channels; a dropped channel without orders is deleted', async () => {
  const partner = await newPartner();
  const [online, shop] = await prisma.consignmentChannel.findMany({ where: { customerId: partner.customerId! }, orderBy: { sortOrder: 'asc' } });
  const edited = await updateConsignmentPartner(
    partner.id,
    undefined,
    form({ name: 'همکار نو', [CHANNELS_FIELD]: channels([{ id: shop.id, name: 'حضوری', commissionRate: 40, isDefault: true }, { name: 'نمایشگاه', commissionRate: 15 }]) }),
  );
  assert.deepEqual(edited, { message: 'همکار امانی با موفقیت بروزرسانی شد.', success: true });

  const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { id: partner.id }, include: { customer: true } });
  assert.deepEqual([warehouse.name, warehouse.customer?.name, Number(warehouse.customer?.commissionRate)], ['انبار امانی - همکار نو', 'همکار نو', 40]);
  const rows = await prisma.consignmentChannel.findMany({ where: { customerId: partner.customerId! }, orderBy: { sortOrder: 'asc' } });
  assert.deepEqual(rows.map((c: any) => [c.name, Number(c.commissionRate), c.isDefault]), [['حضوری', 40, true], ['نمایشگاه', 15, false]]);
  assert.equal(await prisma.consignmentChannel.count({ where: { id: online.id } }), 0);

  const missing = await updateConsignmentPartner('no-such-warehouse', undefined, form({ name: 'X', [CHANNELS_FIELD]: channels([{ name: 'الف', commissionRate: 1 }]) }));
  assert.equal(missing.message, 'همکار یافت نشد.');
});

test('partner writes need sales.manage and partner reads sales.view; a refused write changes nothing', async () => {
  const w = await world();
  const before = await snapshot();
  for (const role of NON_SELLERS) {
    setTestRole(role);
    assert.equal((await createConsignmentPartner(undefined, form({ name: 'X' }))).message, DENIED, String(role));
    assert.equal((await updateConsignmentPartner(w.partner.id, undefined, form({ name: 'X' }))).message, DENIED, String(role));
    assert.equal((await transferStockBatch({ sourceWarehouseId: w.store.id, targetWarehouseId: w.partner.id, items: [{ productId: w.frame.id, quantity: 1 }] })).message, DENIED, String(role));
    assert.equal((await transferStock(undefined, form({ sourceWarehouseId: w.store.id, targetWarehouseId: w.partner.id, productId: w.frame.id, quantity: '1' }))).message, DENIED, String(role));
    assert.equal((await returnConsignmentStock({ partnerWarehouseId: w.partner.id, targetWarehouseId: w.store.id, items: [{ productId: w.frame.id, quantity: 1 }] })).message, DENIED, String(role));
  }
  assert.deepEqual(await snapshot(), before);
  for (const role of NON_VIEWERS) {
    setTestRole(role);
    await assert.rejects(getConsignmentPartners(), AccessDenied, String(role));
    await assert.rejects(getPartnerStatement(w.partner.id), AccessDenied, String(role));
  }
  for (const role of SELLERS) {
    setTestRole(role);
    assert.equal((await transferStockBatch({ sourceWarehouseId: w.store.id, targetWarehouseId: w.partner.id, items: [{ productId: w.frame.id, quantity: 1 }] })).success, true, role);
  }
  for (const role of VIEWERS) {
    setTestRole(role);
    assert.equal((await getPartnerStatement(w.partner.id))!.logistics.currentStockQty, SELLERS.length, role);
  }
});

// --- sending stock to the partner and taking it back ---

test('a batch transfer moves every line to the partner, each with its TRANSFER movement', async () => {
  const w = await world();
  const result = await transferStockBatch({
    sourceWarehouseId: w.store.id,
    targetWarehouseId: w.partner.id,
    items: [{ productId: w.frame.id, quantity: 4 }, { productId: w.caseItem.id, quantity: 2 }, { productId: w.caseItem.id, quantity: 0 }],
  });
  assert.deepEqual(result, { success: true, message: 'انتقال ۲ کالا با موفقیت انجام شد.'.replace('۲', '2') });
  assert.deepEqual(
    [await quantityOf(w.frame.id, w.store.id), await quantityOf(w.frame.id, w.partner.id), await quantityOf(w.caseItem.id, w.store.id), await quantityOf(w.caseItem.id, w.partner.id)],
    [6, 4, 2, 2],
  );
  const moves = await prisma.inventoryMovement.findMany({ where: { type: 'TRANSFER' } });
  assert.deepEqual(moves.map((m: any) => [m.productId, m.fromWarehouseId, m.toWarehouseId, m.quantity]).sort(), [
    [w.caseItem.id, w.store.id, w.partner.id, 2],
    [w.frame.id, w.store.id, w.partner.id, 4],
  ].sort());
  await assertInvariants();
});

test('a transfer is refused whole: too much of one line, the same warehouse twice, a fraction, or nothing to send', async () => {
  const w = await world();
  const before = await snapshot();
  const batch = (items: Array<{ productId: string; quantity: number }>, target = w.partner.id) =>
    transferStockBatch({ sourceWarehouseId: w.store.id, targetWarehouseId: target, items });
  // The frames fit, the cases do not: the frames stay too.
  assert.deepEqual(await batch([{ productId: w.frame.id, quantity: 3 }, { productId: w.caseItem.id, quantity: 5 }]), {
    success: false,
    message: 'موجودی انبار مبدا برای «جلد» کافی نیست.',
  });
  // Two lines of one product that together exceed the stock.
  assert.equal((await batch([{ productId: w.frame.id, quantity: 6 }, { productId: w.frame.id, quantity: 6 }])).success, false);
  assert.deepEqual(await batch([{ productId: w.frame.id, quantity: 1 }], w.store.id), { success: false, message: 'انبار مبدا و مقصد نمی‌توانند یکسان باشند.' });
  assert.deepEqual(await batch([{ productId: w.frame.id, quantity: 0 }]), { success: false, message: 'حداقل یک کالا به لیست اضافه کنید.' });
  assert.deepEqual(await batch([{ productId: w.frame.id, quantity: 1.5 }]), { success: false, message: 'تعداد هر کالا باید عددی صحیح باشد.' });
  assert.deepEqual(await transferStockBatch({ sourceWarehouseId: '', targetWarehouseId: w.partner.id, items: [] }), { success: false, message: 'انبار مبدا و مقصد را انتخاب کنید.' });

  const single = (fields: Record<string, string>) =>
    transferStock(undefined, form({ sourceWarehouseId: w.store.id, targetWarehouseId: w.partner.id, productId: w.frame.id, quantity: '1', ...fields }));
  assert.equal((await single({ quantity: '11' })).message, 'موجودی انبار مبدا کافی نیست.');
  assert.equal((await single({ targetWarehouseId: w.store.id })).message, 'انبار مبدا و مقصد نمی‌توانند یکسان باشند.');
  assert.equal((await single({ quantity: '1.5' })).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await single({ quantity: '0' })).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.deepEqual(await snapshot(), before);

  assert.equal((await single({ quantity: '3' })).message, 'انتقال موجودی با موفقیت انجام شد.');
  assert.deepEqual([await quantityOf(w.frame.id, w.store.id), await quantityOf(w.frame.id, w.partner.id)], [7, 3]);
  await assertInvariants();
});

test('two transfers of the last frames at the same time: the second finds too few, and stock never goes below 0', async () => {
  const w = await world();
  beforeQuery.fn = async (params) => {
    if (params.model === 'InventoryMovement' && params.action === 'create') await sleep(150);
  };
  const send = () => transferStockBatch({ sourceWarehouseId: w.store.id, targetWarehouseId: w.partner.id, items: [{ productId: w.frame.id, quantity: 6 }] });
  const results = await Promise.all([send(), send()]);
  beforeQuery.fn = null;
  assert.deepEqual(results.map((r) => r.success).sort(), [false, true]);
  assert.deepEqual([await quantityOf(w.frame.id, w.store.id), await quantityOf(w.frame.id, w.partner.id)], [4, 6]);
  await assertInvariants();
});

test('unsold goods come back from the partner with a RETURN movement; more than it holds, or a real warehouse as source, is refused', async () => {
  const w = await world();
  await transferStockBatch({ sourceWarehouseId: w.store.id, targetWarehouseId: w.partner.id, items: [{ productId: w.frame.id, quantity: 5 }] });
  const back = await returnConsignmentStock({ partnerWarehouseId: w.partner.id, targetWarehouseId: w.store.id, items: [{ productId: w.frame.id, quantity: 2 }] });
  assert.deepEqual(back, { message: 'برگشت کالای امانی با موفقیت ثبت شد.', success: true });
  assert.deepEqual([await quantityOf(w.frame.id, w.partner.id), await quantityOf(w.frame.id, w.store.id)], [3, 7]);
  const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: 'RETURN' } });
  assert.deepEqual([movement.fromWarehouseId, movement.toWarehouseId, movement.quantity], [w.partner.id, w.store.id, 2]);
  // No money moves on a return of unsold goods.
  assert.equal(await prisma.transaction.count(), 0);

  const before = await snapshot();
  const giveBack = (items: Array<{ productId: string; quantity: number }>, source = w.partner.id, target = w.store.id) =>
    returnConsignmentStock({ partnerWarehouseId: source, targetWarehouseId: target, items });
  assert.equal((await giveBack([{ productId: w.frame.id, quantity: 4 }])).message, 'موجودی کافی نیست برای PANJ (موجودی: 3، درخواست: 4)');
  assert.equal((await giveBack([{ productId: w.frame.id, quantity: 1 }], w.store.id, w.partner.id)).message, 'انبار مبدا یک انبار امانی معتبر نیست.');
  assert.equal((await giveBack([{ productId: w.frame.id, quantity: 1 }], w.partner.id, w.partner.id)).message, 'انبار مبدا و مقصد نمی‌توانند یکسان باشند.');
  assert.equal((await giveBack([{ productId: w.frame.id, quantity: 1.5 }])).message, 'لطفا فیلدها را به درستی پر کنید.');
  assert.equal((await giveBack([])).message, 'لطفا فیلدها را به درستی پر کنید.');
  assert.deepEqual(await snapshot(), before);
  await assertInvariants();
});

// --- the partner statement ---

test('the statement accounts for every unit sent: in stock, sold or returned, however many movements there are', async () => {
  const w = await world();
  await prisma.inventory.update({ where: { productId_warehouseId: { productId: w.caseItem.id, warehouseId: w.store.id } }, data: { quantity: 400 } });
  await prisma.inventoryMovement.create({ data: { productId: w.caseItem.id, toWarehouseId: w.store.id, quantity: 396, type: 'PURCHASE' } });
  // Sent: 5 frames and 300 cases. Returned: 1 frame first, then 250 cases one by one (more movements than a page).
  await transferStockBatch({ sourceWarehouseId: w.store.id, targetWarehouseId: w.partner.id, items: [{ productId: w.frame.id, quantity: 5 }, { productId: w.caseItem.id, quantity: 300 }] });
  await returnConsignmentStock({ partnerWarehouseId: w.partner.id, targetWarehouseId: w.store.id, items: [{ productId: w.frame.id, quantity: 1 }] });
  for (let i = 0; i < 250; i++) {
    await prisma.inventory.update({ where: { productId_warehouseId: { productId: w.caseItem.id, warehouseId: w.partner.id } }, data: { quantity: { decrement: 1 } } });
    await prisma.inventory.update({ where: { productId_warehouseId: { productId: w.caseItem.id, warehouseId: w.store.id } }, data: { quantity: { increment: 1 } } });
    await prisma.inventoryMovement.create({ data: { productId: w.caseItem.id, fromWarehouseId: w.partner.id, toWarehouseId: w.store.id, quantity: 1, type: 'RETURN' } });
  }
  const sold = await recordConsignmentSales({ partnerWarehouseId: w.partner.id, saleDate: '2026-09-20', items: [{ productId: w.frame.id, quantity: 2, unitPrice: PRICE }] });
  assert.equal(sold.success, true, sold.message);

  const statement = (await getPartnerStatement(w.partner.id))!;
  assert.deepEqual(statement.logistics, { sentQty: 305, returnedQty: 251, soldQty: 2, currentStockQty: 52, currentStockValue: 2 * COST + 50 * 10_000 });
  assert.deepEqual(statement.currentStock.map((row: any) => [row.sku, row.quantity]).sort(), [['CASE', 50], ['PANJ', 2]]);
  await assertInvariants();

  // Without cost.view there is no stock value.
  setTestRole('SALES');
  assert.equal((await getPartnerStatement(w.partner.id))!.logistics.currentStockValue, null);
  assert.equal(await getPartnerStatement('no-such-warehouse'), undefined);
});
