import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { fakeFtp, FTP_SETTINGS } from './fake-ftp';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { ROLES } from '@/lib/permissions';
import { ACCESS_DENIED_MESSAGE } from '@/lib/access';
import {
  INVALID_RECEIPT_MESSAGE,
  isPdfReceipt,
  isReceiptRef,
  mayAttachReceipt,
  mayViewReceipt,
  readReceiptRef,
  receiptViewUrl,
} from '@/lib/receipt-ref';
import { STORAGE_MISSING_MESSAGE, deleteReceiptFile, readReceipt, storeReceipt } from '@/lib/receipt-storage';
import { deleteProductImage, deleteReceipt, uploadProductImage, uploadReceipt } from '@/actions/upload';
import { attachReceipt, removeReceipt } from '@/actions/receipts';
import { GET } from '@/app/api/receipts/route';
import { GET as serveProductImage } from '@/app/api/product-images/[name]/route';

console.error = () => {};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a photo')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a jpeg')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.7\nslip');
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PRODUCTS = join(process.cwd(), 'public', 'uploads', 'products');
const productFilesBefore = existsSync(PRODUCTS) ? new Set(readdirSync(PRODUCTS)) : new Set<string>();

beforeEach(async () => {
  setTestRole('ADMIN');
  fakeFtp.reset();
  delete process.env.VERCEL;
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'Test', email: 'test@example.com', password: 'x' } });
});
after(async () => {
  rmSync(join(process.cwd(), '.receipts'), { recursive: true, force: true });
  rmSync(join(process.cwd(), '.product-images'), { recursive: true, force: true });
  // Only the product images these tests wrote.
  if (existsSync(PRODUCTS)) for (const name of readdirSync(PRODUCTS)) if (!productFilesBefore.has(name)) rmSync(join(PRODUCTS, name));
  await prisma.$disconnect();
});

const withFtp = (extra: Record<string, unknown> = {}) =>
  prisma.systemSetting.create({ data: { key: 'ftp_credentials', value: JSON.stringify({ ...FTP_SETTINGS, ...extra }) } });
const fileForm = (bytes: Buffer, name = 'receipt', type = 'image/png') => {
  const data = new FormData();
  data.append('file', new File([new Uint8Array(bytes)], name, { type }));
  return data;
};
const view = async (ref: string) => (await GET(new NextRequest(`http://localhost/api/receipts?ref=${encodeURIComponent(ref)}`))).status;

async function money(type: 'INCOME' | 'EXPENSE', orderId?: string, receiptUrl?: string) {
  const account = await prisma.account.upsert({ where: { id: 'bank' }, update: {}, create: { id: 'bank', name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  if (orderId) {
    const customer = await prisma.customer.create({ data: { name: 'C' } });
    await prisma.order.create({ data: { id: orderId, customerId: customer.id, totalAmount: 100, paidAmount: 100 } });
  }
  return prisma.transaction.create({
    data: { type, amount: 100, amountInToman: 100, currency: 'TOMAN', accountId: account.id, orderId, receiptUrl, description: 'ردیف' },
  });
}

// ---------------------------------------------------------------- the reference

test('only the stored-receipt shape passes as a reference: no traversal, no other scheme or type', () => {
  const good = [
    `ftp:/uploads/receipts/${UUID}.png`,
    `ftp:/uploads/receipts/${UUID}.jpg`,
    `ftp:/uploads/receipts/${UUID}.JPEG`,
    `ftp:/uploads/receipts/${UUID}.webp`,
    `ftp:/uploads/receipts/${UUID}.pdf`,
    `ftp:/${UUID}.png`,
    `ftp:/a/b_c/d-e/f.g/${UUID}.png`,
    `ftp:/uploads/receipts/${UUID.toUpperCase()}.png`,
  ];
  for (const ref of good) assert.equal(isReceiptRef(ref), true, ref);

  const bad: unknown[] = [
    `ftp:/uploads/../receipts/${UUID}.png`,
    `ftp:/uploads/./receipts/${UUID}.png`,
    `ftp:/uploads/..%2f/${UUID}.png`,
    `ftp:/uploads/%2e%2e/${UUID}.png`,
    `ftp://evil.example/${UUID}.png`,
    `ftp:/uploads//${UUID}.png`,
    `ftp:uploads/${UUID}.png`,
    `ftp:/uploads\\receipts/${UUID}.png`,
    `ftp:/uploads/receipts/${UUID}.png\n`,
    `ftp:/uploads/receipts/${UUID}.png `,
    ` ftp:/uploads/receipts/${UUID}.png`,
    `ftp:/uploads/receipts/${UUID}.svg`,
    `ftp:/uploads/receipts/${UUID}.html`,
    `ftp:/uploads/receipts/${UUID}.png.html`,
    `ftp:/uploads/receipts/${UUID}.pdf.exe`,
    `ftp:/uploads/receipts/receipt.png`,
    `ftp:/uploads/receipts/${UUID.slice(1)}.png`,
    `ftp:/.env/${UUID}.png`,
    `ftp:/رسید/${UUID}.png`,
    `https://evil.example/${UUID}.png`,
    `/uploads/receipts/${UUID}.png`,
    '',
    null,
    undefined,
    42,
    { toString: () => `ftp:/uploads/receipts/${UUID}.png` },
  ];
  for (const ref of bad) assert.equal(isReceiptRef(ref), false, JSON.stringify(String(ref)));

  assert.equal(readReceiptRef(''), undefined);
  assert.equal(readReceiptRef(null), undefined);
  assert.equal(readReceiptRef('junk'), null);
  assert.equal(readReceiptRef(good[0]), good[0]);
  assert.equal(receiptViewUrl(good[0]), `/api/receipts?ref=${encodeURIComponent(good[0])}`);
  assert.equal(receiptViewUrl('javascript:alert(1)'), null);
  assert.equal(isPdfReceipt(good[4]), true);
  assert.equal(isPdfReceipt(good[0]), false);
});

test('who may attach and who may open a receipt, for every role and kind of row', () => {
  const rows = {
    orderIncome: { type: 'INCOME', orderId: 'o1' },
    income: { type: 'INCOME', orderId: null },
    orderExpense: { type: 'EXPENSE', orderId: 'o1' },
    expense: { type: 'EXPENSE' },
  };
  const attach: Record<string, string[]> = {
    ADMIN: ['orderIncome', 'income', 'orderExpense', 'expense'],
    ACCOUNTANT: ['orderIncome', 'income', 'orderExpense', 'expense'],
    SALES: ['orderIncome'],
  };
  const open: Record<string, string[]> = {
    ADMIN: ['orderIncome', 'income', 'orderExpense', 'expense', 'unsaved'],
    ACCOUNTANT: ['orderIncome', 'income', 'orderExpense', 'expense', 'unsaved'],
    AUDITOR: ['orderIncome', 'income', 'orderExpense', 'expense'],
    SALES: ['orderIncome', 'unsaved'],
  };
  for (const role of [null, ...ROLES]) {
    const key = String(role);
    const attachable = Object.entries(rows).filter(([, row]) => mayAttachReceipt(role, row)).map(([name]) => name);
    assert.deepEqual(attachable, attach[key] ?? [], `attach / ${key}`);
    const openable = [
      ...Object.entries(rows).filter(([, row]) => mayViewReceipt(role, row)).map(([name]) => name),
      ...(mayViewReceipt(role, null) ? ['unsaved'] : []),
    ];
    assert.deepEqual(openable, open[key] ?? [], `open / ${key}`);
  }
});

// ---------------------------------------------------------------- the viewer

test('the viewer answers 404 to every traversal attempt, without touching the FTP server', async () => {
  await withFtp();
  fakeFtp.files.set('/etc/passwd', Buffer.from('root:x'));
  const attempts = [
    '../../.env',
    'ftp:/../../etc/passwd',
    `ftp:/uploads/receipts/../../../etc/${UUID}.png`,
    `ftp:/uploads/receipts/%2e%2e/${UUID}.png`,
    'ftp:/etc/passwd',
    `ftp://ftp.example.test/${UUID}.png`,
    '/etc/passwd',
    '',
  ];
  for (const ref of attempts) assert.equal(await view(ref), 404, ref);
  assert.equal((await GET(new NextRequest('http://localhost/api/receipts'))).status, 404);
  assert.equal(fakeFtp.logins.length, 0);
});

test('with FTP set, a receipt is stored there, opened from there and removed from there', async () => {
  await withFtp();
  setTestRole('ACCOUNTANT');
  const uploaded: any = await uploadReceipt(fileForm(PDF, 'slip.png', 'image/png'));
  assert.equal(uploaded.success, true, uploaded.error);
  assert.match(uploaded.url, /^ftp:\/uploads\/receipts\/[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual(fakeFtp.files.get(uploaded.url.slice(4)), PDF);
  assert.equal(existsSync(join(process.cwd(), '.receipts', uploaded.url.slice(4))), false, 'nothing kept locally');

  const row = await money('EXPENSE');
  assert.equal((await attachReceipt(row.id, uploaded.url)).success, true);
  const response = await GET(new NextRequest(`http://localhost/api/receipts?ref=${encodeURIComponent(uploaded.url)}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);

  setTestRole('ADMIN');
  assert.equal((await removeReceipt(row.id)).success, true);
  assert.equal(fakeFtp.files.has(uploaded.url.slice(4)), false);
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).receiptUrl, null);
});

test('a file of an older kind downloads instead of opening, and an unreachable FTP server is a Persian 502', async () => {
  await withFtp();
  const ref = `ftp:/uploads/receipts/${UUID}.png`;
  fakeFtp.files.set(ref.slice(4), Buffer.from('<html><script>alert(1)</script></html>'));
  await money('EXPENSE', undefined, ref);
  setTestRole('AUDITOR');
  const response = await GET(new NextRequest(`http://localhost/api/receipts?ref=${encodeURIComponent(ref)}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('content-disposition'), 'attachment');

  fakeFtp.failWith = new Error('connect ETIMEDOUT');
  const dead = await GET(new NextRequest(`http://localhost/api/receipts?ref=${encodeURIComponent(ref)}`));
  assert.equal(dead.status, 502);
  assert.match(await dead.text(), /سرور FTP رسیدها/);
});

test('an FTP server that cannot delete still leaves the row clean, and the removal is logged', async () => {
  await withFtp();
  const ref = `ftp:/uploads/receipts/${UUID}.png`;
  const row = await money('INCOME', undefined, ref);
  fakeFtp.failWith = new Error('550 Permission denied');
  assert.deepEqual(await removeReceipt(row.id), { success: true, message: 'رسید حذف شد.' });
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).receiptUrl, null);
  assert.equal(await prisma.activityLog.count({ where: { action: 'REMOVE_RECEIPT', userId: 'test-user' } }), 1);
});

test('on Vercel without FTP settings a receipt is refused in Persian and nothing is written locally', async () => {
  process.env.VERCEL = '1';
  try {
    setTestRole('SALES');
    assert.deepEqual(await uploadReceipt(fileForm(PNG)), { success: false, error: STORAGE_MISSING_MESSAGE });
    await assert.rejects(storeReceipt(PNG, 'image/png'), { message: STORAGE_MISSING_MESSAGE });
  } finally {
    delete process.env.VERCEL;
  }
});

test('the local fallback reads and deletes only receipt references', async () => {
  const ref = await storeReceipt(JPEG, 'image/jpeg');
  assert.match(ref, /^ftp:\/uploads\/receipts\/[0-9a-f-]{36}\.jpg$/);
  assert.deepEqual(await readReceipt(ref), JPEG);
  for (const junk of ['ftp:/../../package.json', '../package.json', 'ftp:/uploads/receipts/x.png']) {
    await assert.rejects(readReceipt(junk), /not a receipt reference/, junk);
    await assert.rejects(deleteReceiptFile(junk), /not a receipt reference/, junk);
  }
  assert.ok(existsSync(join(process.cwd(), 'package.json')));
  await deleteReceiptFile(ref);
  assert.equal(await readReceipt(ref), null);
  assert.equal(await readReceipt(`ftp:/uploads/receipts/${UUID}.png`), null);
});

test('upload and discard need finance.manage or sales.manage; the others change nothing', async () => {
  const kept = await storeReceipt(WEBP, 'image/webp');
  for (const role of [null, 'AUDITOR', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER']) {
    setTestRole(role);
    assert.equal(((await uploadReceipt(fileForm(PNG))) as any).message, ACCESS_DENIED_MESSAGE, String(role));
    assert.equal(((await deleteReceipt(kept)) as any).message, ACCESS_DENIED_MESSAGE, String(role));
  }
  assert.deepEqual(await readReceipt(kept), WEBP);
  for (const role of ['ADMIN', 'ACCOUNTANT', 'SALES']) {
    setTestRole(role);
    assert.equal(((await uploadReceipt(fileForm(PNG))) as any).success, true, role);
  }
  setTestRole('SALES');
  assert.deepEqual(await deleteReceipt('ftp:/../../etc/passwd'), { success: false, error: INVALID_RECEIPT_MESSAGE });
  assert.deepEqual(await uploadReceipt(new FormData()), { success: false, error: 'فایلی انتخاب نشده است.' });
  assert.deepEqual(await uploadReceipt(fileForm(Buffer.alloc(0))), { success: false, error: 'فایلی انتخاب نشده است.' });
});

test('two people attaching a receipt to the same row at once: one wins, the other is told', async () => {
  const row = await money('EXPENSE');
  const [first, second] = [await storeReceipt(PNG, 'image/png'), await storeReceipt(PDF, 'application/pdf')];
  setTestRole('ACCOUNTANT');
  // The second attach reads the row before the first one writes.
  let paused = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  beforeQuery.fn = async (params) => {
    if (!paused && params.model === 'Transaction' && params.action === 'updateMany') {
      paused = true;
      await gate;
    }
  };
  try {
    const one = attachReceipt(row.id, first);
    while (!paused) await new Promise((resolve) => setTimeout(resolve, 5));
    beforeQuery.fn = null;
    const two = await attachReceipt(row.id, second);
    release();
    const results = [await one, two];
    assert.equal(results.filter((r) => r.success).length, 1, JSON.stringify(results));
    assert.ok(results.some((r) => /هم‌زمان|فقط مدیر/.test(r.message ?? '')));
  } finally {
    beforeQuery.fn = null;
    release();
  }
  const stored = (await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).receiptUrl;
  assert.ok(stored === first || stored === second);
});

// ---------------------------------------------------------------- product images

const imageUrlOk = (url: string, ext: string) => assert.match(url, new RegExp(`^/api/product-images/[0-9a-f-]{36}\\.${ext}$`));
const imageName = (url: string) => url.slice('/api/product-images/'.length);
const serve = async (name: string) => {
  const response = await serveProductImage(new NextRequest(`http://localhost/api/product-images/${name}`), { params: Promise.resolve({ name }) });
  return { status: response.status, type: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()), response };
};

test('a product image is typed by its bytes and named by the server, so no name can leave the folder', async () => {
  setTestRole('WAREHOUSE');
  const cases: Array<[Buffer, string, string, string]> = [
    [PNG, 'photo.html', 'image/png', 'png'],
    [JPEG, 'x.png/../../../../evil.js', 'image/jpeg', 'jpg'],
    [WEBP, '..\\..\\evil', 'image/webp', 'webp'],
    [PNG, 'no-extension', 'image/png', 'png'],
  ];
  for (const [bytes, name, type, ext] of cases) {
    const result: any = await uploadProductImage(fileForm(bytes, name, type));
    assert.equal(result.success, true, `${name}: ${result.error}`);
    imageUrlOk(result.url, ext);
    // Without FTP settings (development): kept next to the code, never in public/.
    assert.deepEqual(readFileSync(join(process.cwd(), '.product-images', imageName(result.url))), bytes);
  }
  assert.equal(existsSync(join(process.cwd(), 'evil.js')), false);
  assert.equal(existsSync(join(process.cwd(), 'public', 'evil.js')), false);
  assert.deepEqual(existsSync(PRODUCTS) ? new Set(readdirSync(PRODUCTS)) : new Set(), productFilesBefore, 'nothing new in public/');

  const refused: Array<[Buffer, string]> = [
    [Buffer.from('<script>alert(1)</script>'), 'x.png'],
    [PDF, 'x.png'],
    [Buffer.from('GIF89a'), 'x.gif'],
  ];
  for (const [bytes, name] of refused) {
    assert.deepEqual(await uploadProductImage(fileForm(bytes, name, 'image/png')), { success: false, error: 'فقط عکس JPG، PNG یا WEBP قابل آپلود است.' });
  }
  assert.deepEqual(await uploadProductImage(new FormData()), { success: false, error: 'فایلی انتخاب نشده است.' });
  const huge = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
  assert.deepEqual(await uploadProductImage(fileForm(huge)), { success: false, error: 'حجم عکس نباید بیشتر از ۱۰ مگابایت باشد.' });
});

test('with FTP set, a product image is stored on the FTP server and served from there with its content type', async () => {
  await withFtp();
  setTestRole('ADMIN');
  const result: any = await uploadProductImage(fileForm(WEBP, 'photo.webp', 'image/webp'));
  assert.equal(result.success, true, result.error);
  imageUrlOk(result.url, 'webp');
  const name = imageName(result.url);
  assert.deepEqual(fakeFtp.files.get(`/product-images/${name}`), WEBP);
  assert.equal(existsSync(join(process.cwd(), '.product-images', name)), false);

  for (const role of ROLES) {
    setTestRole(role);
    const served = await serve(name);
    assert.equal(served.status, 200, role);
    assert.equal(served.type, 'image/webp');
    assert.deepEqual(served.body, WEBP);
  }
  assert.equal(served_header(await serve(name), 'x-content-type-options'), 'nosniff');
  setTestRole(null);
  assert.equal((await serve(name)).status, 401);

  setTestRole('WAREHOUSE');
  for (const junk of ['../.env', `${UUID}.html`, `${UUID}.png/..`, 'x.png', `${UUID.toUpperCase()}.png`]) {
    assert.equal((await serve(junk)).status, 404, junk);
  }
  assert.equal((await serve(`${UUID}.png`)).status, 404, 'not stored');
  // Bytes that are not what the name says are not served as an image.
  fakeFtp.files.set(`/product-images/${UUID}.png`, Buffer.from('<html>'));
  assert.equal((await serve(`${UUID}.png`)).status, 404);

  fakeFtp.failWith = new Error('connect ETIMEDOUT');
  const dead = await serve(name);
  assert.equal(dead.status, 502);
  assert.match(dead.body.toString('utf8'), /سرور FTP/);
  fakeFtp.failWith = null;

  assert.deepEqual(await deleteProductImage(result.url), { success: true });
  assert.equal(fakeFtp.files.has(`/product-images/${name}`), false);
  assert.equal((await serve(name)).status, 404);
});

function served_header(served: { response: Response }, header: string) {
  return served.response.headers.get(header);
}

test('on Vercel without FTP settings a product image is refused in Persian, and nothing is written', async () => {
  process.env.VERCEL = '1';
  try {
    setTestRole('WAREHOUSE');
    assert.deepEqual(await uploadProductImage(fileForm(PNG)), {
      success: false,
      error: 'سرور FTP در تنظیمات وارد نشده است؛ عکس کالا ذخیره نمی‌شود. به مدیر سیستم خبر دهید.',
    });
  } finally {
    delete process.env.VERCEL;
  }
  await withFtp();
  fakeFtp.failWith = new Error('530 Login incorrect.');
  assert.deepEqual(await uploadProductImage(fileForm(PNG)), { success: false, error: 'آپلود عکس به سرور FTP انجام نشد: 530 Login incorrect.' });
});

test('a product image is deleted only by stock managers; an image uploaded before, in public/, still shows and deletes', async () => {
  setTestRole('ADMIN');
  const { url } = (await uploadProductImage(fileForm(PNG, 'a.png'))) as any;
  for (const role of [null, 'SALES', 'ACCOUNTANT', 'AUDITOR', 'USER']) {
    setTestRole(role);
    assert.equal(((await uploadProductImage(fileForm(PNG))) as any).message, ACCESS_DENIED_MESSAGE, String(role));
    assert.equal(((await deleteProductImage(url)) as any).message, ACCESS_DENIED_MESSAGE, String(role));
  }
  assert.equal((await serve(imageName(url))).status, 200);

  setTestRole('WAREHOUSE');
  for (const junk of ['/uploads/products/../../package.json', '/uploads/products/..', '../../package.json', 'https://themoak.com/wp-content/x.png', '/uploads/products/', '/api/product-images/../x.png']) {
    assert.deepEqual(await deleteProductImage(junk), { success: false, error: 'نشانی عکس نامعتبر است.' }, junk);
  }
  assert.ok(existsSync(join(process.cwd(), 'package.json')));
  assert.deepEqual(await deleteProductImage(url), { success: true });
  assert.equal((await serve(imageName(url))).status, 404);

  // An older photo in public/uploads/products: shown with a plain <img> as before, and deletable.
  const legacy = `/uploads/products/${UUID}.jpeg`;
  mkdirSync(PRODUCTS, { recursive: true });
  writeFileSync(join(process.cwd(), 'public', legacy), JPEG);
  assert.deepEqual(await deleteProductImage(legacy), { success: true });
  assert.equal(existsSync(join(process.cwd(), 'public', legacy)), false);
  assert.deepEqual(await deleteProductImage(legacy), { success: false, error: 'حذف عکس انجام نشد.' });

  // Every product photo is a plain <img> (src/components/inventory/product-photo.tsx), which carries the session.
  for (const file of ['src/components/inventory/product-header.tsx', 'src/components/inventory/product-image-upload.tsx']) {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    assert.match(source, /<ProductPhoto\b/, file);
    assert.doesNotMatch(source, /next\/image/, file);
  }
});
