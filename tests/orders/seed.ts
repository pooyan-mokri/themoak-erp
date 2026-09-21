import { prisma } from '../helpers/db';

export const OPENING = 50_000_000;
export const USD_OPENING = 1_000;
export const USD_RATE = 100_000; // Toman per USD
export const PRICE = 10_000_000;
export const STOCK = 10;

/** A shop: one warehouse holding STOCK of one product, a customer, two Toman banks and a USD account. */
export async function seedShop() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({
    data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 4_000_000, sellPrice: PRICE },
  });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: STOCK } });
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  const saman = await prisma.account.create({ data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: OPENING } });
  const novin = await prisma.account.create({
    data: { name: 'اقتصاد نوین', type: 'BANK', currency: 'TOMAN', balance: OPENING, cardNumber: '6274121199998888' },
  });
  const usd = await prisma.account.create({ data: { name: 'حساب ذخیره دلاری', type: 'BANK', currency: 'USD', balance: USD_OPENING } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: USD_RATE, date: new Date('2026-09-20') } });
  return { warehouse, product, customer, saman, novin, usd };
}

export type Shop = Awaited<ReturnType<typeof seedShop>>;

/** Every account's balance, by name. */
export async function balances() {
  const accounts = await prisma.account.findMany({ orderBy: { name: 'asc' } });
  return Object.fromEntries(accounts.map((a: any) => [a.name, Number(a.balance)]));
}

export async function stockOf(shop: Shop) {
  const row = await prisma.inventory.findUniqueOrThrow({
    where: { productId_warehouseId: { productId: shop.product.id, warehouseId: shop.warehouse.id } },
  });
  return row.quantity;
}

/** The only order, or the one with this id. */
export async function theOrder(id?: string) {
  return id ? prisma.order.findUniqueOrThrow({ where: { id } }) : prisma.order.findFirstOrThrow();
}
