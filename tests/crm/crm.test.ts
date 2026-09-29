import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import {
  assignTicket,
  convertLeadToCustomer,
  createDeal,
  createLead,
  createTicket,
  getCRMDashboardStats,
  getDealById,
  getLeadById,
  getLeads,
  getTicketById,
  getTickets,
  resolveTicket,
  updateDealStage,
  updateLeadStatus,
  updateTicketStatus,
} from '@/actions/crm';
import { cancelOrder, createOrder } from '@/actions/sales';
import { returnOrderItem } from '@/actions/order-return';
import { DENIED, NON_SELLERS, SELLERS, openAccount, snapshot, stockIn } from '../sales/world';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const leadFields = (fields: Record<string, string> = {}) =>
  form({ name: 'مریم', company: '', phone: '09121111111', email: '', source: 'INSTAGRAM', expectedValue: '', notes: '', ...fields });

// --- leads ---

test('a lead is stored with what the form gave; a bad email or no name is refused and nothing is written', async () => {
  const created = await createLead(undefined, leadFields({ company: 'عینک مریم', email: 'maryam@example.com', expectedValue: '25000000', notes: 'از اینستاگرام' }));
  assert.deepEqual(created, { message: 'سرنخ با موفقیت ثبت شد.', success: true });
  const [lead] = await getLeads();
  assert.deepEqual(
    [lead.name, lead.company, lead.phone, lead.email, lead.source, lead.expectedValue, lead.notes, lead.status, lead.customerId],
    ['مریم', 'عینک مریم', '09121111111', 'maryam@example.com', 'INSTAGRAM', 25_000_000, 'از اینستاگرام', 'NEW', undefined],
  );
  assert.equal((await getLeadById(lead.id))!.expectedValue, 25_000_000);
  assert.equal(await getLeadById('no-such-lead'), undefined);

  const before = await snapshot();
  assert.equal((await createLead(undefined, leadFields({ email: 'not-an-email' }))).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await createLead(undefined, leadFields({ name: '' }))).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await createLead(undefined, leadFields({ expectedValue: 'abc' }))).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.deepEqual(await snapshot(), before);
});

test('a lead moves only between the statuses the list knows', async () => {
  await createLead(undefined, leadFields());
  const lead = await prisma.lead.findFirstOrThrow();
  for (const status of ['CONTACTED', 'QUALIFIED', 'LOST', 'NEW']) {
    assert.deepEqual(await updateLeadStatus(lead.id, status), { success: true, message: 'وضعیت سرنخ بروزرسانی شد.' });
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, status);
  }
  assert.deepEqual(await updateLeadStatus(lead.id, 'WHATEVER'), { success: false, message: 'وضعیت سرنخ نامعتبر است.' });
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'NEW');
  assert.equal((await updateLeadStatus('no-such-lead', 'LOST')).success, false);
});

test('converting a lead makes one customer and links the lead, however many times it is asked', async () => {
  await createLead(undefined, leadFields({ email: 'maryam@example.com', notes: 'VIP' }));
  const lead = await prisma.lead.findFirstOrThrow();

  const first = await convertLeadToCustomer(lead.id);
  assert.equal(first.success, true, first.message);
  const customer = await prisma.customer.findFirstOrThrow();
  assert.deepEqual([customer.name, customer.phone, customer.email, customer.notes], ['مریم', '09121111111', 'maryam@example.com', 'VIP']);
  const linked = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.deepEqual([linked.customerId, linked.status], [customer.id, 'QUALIFIED']);
  assert.equal((first as any).customerId, customer.id);

  // Again, and twice at once (a double click): still the one customer.
  const again = await Promise.all([convertLeadToCustomer(lead.id), convertLeadToCustomer(lead.id)]);
  for (const result of again) {
    assert.deepEqual(result, { success: true, message: 'این سرنخ قبلاً به مشتری تبدیل شده بود.', customerId: customer.id });
  }
  assert.equal(await prisma.customer.count(), 1);

  assert.deepEqual(await convertLeadToCustomer('no-such-lead'), { success: false, message: 'سرنخ یافت نشد.' });
});

test('two first conversions at the same moment still make one customer', async () => {
  await createLead(undefined, leadFields());
  const lead = await prisma.lead.findFirstOrThrow();
  const results = await Promise.all([convertLeadToCustomer(lead.id), convertLeadToCustomer(lead.id), convertLeadToCustomer(lead.id)]);
  assert.ok(results.every((r) => r.success));
  assert.equal(await prisma.customer.count(), 1);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).customerId, (await prisma.customer.findFirstOrThrow()).id);
});

// --- deals ---

test('a deal keeps the probability it was given, 0 included; value below 0 or no customer is refused', async () => {
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  const deal = (fields: Record<string, string>) =>
    createDeal(undefined, form({ title: 'خرید سازمانی', customerId: customer.id, value: '50000000', probability: '', expectedClose: '2026-10-15', notes: '', ...fields }));
  assert.deepEqual(await deal({ probability: '0' }), { message: 'فرصت فروش با موفقیت ثبت شد.', success: true });
  assert.equal((await deal({})).success, true);
  const rows = await prisma.deal.findMany({ orderBy: { createdAt: 'asc' } });
  assert.deepEqual(rows.map((d: any) => [d.probability, Number(d.value), d.stage]), [[0, 50_000_000, 'PROSPECT'], [25, 50_000_000, 'PROSPECT']]);
  assert.equal(rows[0].expectedClose?.toISOString().slice(0, 10), '2026-10-15');
  assert.equal((await getDealById(rows[0].id))!.value, 50_000_000);

  const before = await snapshot();
  assert.equal((await deal({ value: '-1' })).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await deal({ probability: '101' })).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await deal({ customerId: '' })).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await deal({ customerId: 'no-such-customer' })).message, 'خطا در ثبت فرصت فروش.');
  assert.deepEqual(await snapshot(), before);
});

test('a deal moved to LOST is at 0%, to WON at 100% with a close date; reopening clears it; an unknown stage is refused', async () => {
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  await createDeal(undefined, form({ title: 'ع', customerId: customer.id, value: '1000', probability: '25', expectedClose: '', notes: '' }));
  const deal = await prisma.deal.findFirstOrThrow();
  const state = async () => {
    const row = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    return [row.stage, row.probability, row.actualClose !== null];
  };
  const stages: Array<[string, number, boolean]> = [
    ['PROPOSAL', 50, false],
    ['NEGOTIATION', 75, false],
    ['LOST', 0, true],
    ['PROSPECT', 25, false],
    ['WON', 100, true],
  ];
  for (const [stage, probability, closed] of stages) {
    assert.deepEqual(await updateDealStage(deal.id, stage), { success: true, message: 'مرحله فرصت بروزرسانی شد.' });
    assert.deepEqual(await state(), [stage, probability, closed], stage);
  }
  assert.deepEqual(await updateDealStage(deal.id, 'ARCHIVED'), { success: false, message: 'مرحلهٔ فرصت نامعتبر است.' });
  assert.deepEqual(await state(), ['WON', 100, true]);
});

// --- support tickets ---

test('a ticket is opened, assigned, moved and resolved; an unknown status is refused', async () => {
  const customer = await prisma.customer.create({ data: { name: 'سارا', phone: '0912' } });
  assert.deepEqual(
    await createTicket(undefined, form({ customerId: customer.id, subject: 'شکستگی دسته', description: 'دسته عینک شکسته است' })),
    { message: 'تیکت با موفقیت ثبت شد.', success: true },
  );
  const [ticket] = await getTickets();
  assert.deepEqual([ticket.subject, ticket.priority, ticket.status, ticket.customer?.name], ['شکستگی دسته', 'MEDIUM', 'OPEN', 'سارا']);
  assert.equal((await assignTicket(ticket.id, 'رضا')).success, true);
  assert.equal((await updateTicketStatus(ticket.id, 'IN_PROGRESS')).success, true);
  assert.deepEqual(await updateTicketStatus(ticket.id, 'DONE'), { success: false, message: 'وضعیت تیکت نامعتبر است.' });
  assert.equal((await resolveTicket(ticket.id, 'دسته تعویض شد')).success, true);
  const resolved = (await getTicketById(ticket.id))!;
  assert.deepEqual([resolved.status, resolved.resolution, resolved.assignedTo], ['RESOLVED', 'دسته تعویض شد', 'رضا']);
  assert.equal(await getTicketById('no-such-ticket'), undefined);

  const before = await snapshot();
  assert.equal((await createTicket(undefined, form({ customerId: customer.id, subject: '', description: 'x' }))).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await createTicket(undefined, form({ customerId: 'no-such-customer', subject: 's', description: 'x' }))).message, 'خطا در ثبت تیکت.');
  assert.equal((await resolveTicket('no-such-ticket', 'x')).success, false);
  assert.deepEqual(await snapshot(), before);
});

test('the open tickets count leaves out resolved and closed tickets', async () => {
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  for (const status of ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'OPEN']) {
    await prisma.supportTicket.create({ data: { customerId: customer.id, subject: status, description: 'x', status } });
  }
  assert.equal((await getCRMDashboardStats()).openTicketsCount, 3);
  const ticket = await prisma.supportTicket.findFirstOrThrow({ where: { status: 'IN_PROGRESS' } });
  assert.equal((await resolveTicket(ticket.id, 'حل شد')).success, true);
  assert.equal((await getCRMDashboardStats()).openTicketsCount, 2);
});

test('every CRM write needs sales.manage; a refused one changes nothing', async () => {
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  await createLead(undefined, leadFields());
  await createDeal(undefined, form({ title: 'ع', customerId: customer.id, value: '1000', probability: '25', expectedClose: '', notes: '' }));
  await createTicket(undefined, form({ customerId: customer.id, subject: 's', description: 'd' }));
  const [lead, deal, ticket] = [await prisma.lead.findFirstOrThrow(), await prisma.deal.findFirstOrThrow(), await prisma.supportTicket.findFirstOrThrow()];
  const before = await snapshot();
  for (const role of NON_SELLERS) {
    setTestRole(role);
    const results: any[] = [
      await createLead(undefined, leadFields()),
      await updateLeadStatus(lead.id, 'LOST'),
      await convertLeadToCustomer(lead.id),
      await createDeal(undefined, form({ title: 'x', customerId: customer.id, value: '1' })),
      await updateDealStage(deal.id, 'WON'),
      await createTicket(undefined, form({ customerId: customer.id, subject: 's', description: 'd' })),
      await updateTicketStatus(ticket.id, 'CLOSED'),
      await assignTicket(ticket.id, 'x'),
      await resolveTicket(ticket.id, 'x'),
    ];
    for (const result of results) assert.equal(result.message, DENIED, String(role));
  }
  assert.deepEqual(await snapshot(), before);
  for (const role of SELLERS) {
    setTestRole(role);
    assert.equal((await updateTicketStatus(ticket.id, 'CLOSED')).success, true, role);
  }
});

// --- what each customer is worth ---

test('the top customers are ranked by what they bought: after discount and returns, cancelled orders left out', async () => {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: 10_000_000 } });
  await stockIn(frame.id, store.id, 50);
  const bank = await openAccount('بانک');
  const sell = async (customerId: string, quantity: number, discount = 0, paid = 0) => {
    const result = await createOrder({
      customerId,
      items: [{ productId: frame.id, quantity, price: 10_000_000 }],
      paymentMethod: 'CASH',
      accountId: paid ? bank.id : '',
      totalAmount: 10_000_000 * quantity,
      discount,
      paidAmount: paid,
      warehouseId: store.id,
    });
    assert.equal(result.success, true, result.message);
    return prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' }, include: { items: true } });
  };
  // Six customers, so the ranking cannot be the first five created.
  const names = ['الف', 'ب', 'پ', 'ت', 'ث', 'ج'];
  const customers = [];
  for (const name of names) customers.push(await prisma.customer.create({ data: { name } }));
  const [alef, be, pe, te, se, jim] = customers;
  await sell(alef.id, 1); // 10M
  await sell(be.id, 3, 5_000_000); // 25M after discount
  const cancelled = await sell(pe.id, 5); // 50M, then cancelled
  assert.equal((await cancelOrder(cancelled.id)).success, true);
  await sell(pe.id, 1, 500_000); // 9.5M left
  const returned = await sell(te.id, 4, 0, 40_000_000); // 40M, then 2 returned: 20M
  const back = await returnOrderItem({}, form({ orderId: returned.id, orderItemId: returned.items[0].id, quantity: '2', accountId: bank.id, warehouseId: store.id }));
  assert.equal(back.success, true, back.message);
  await sell(se.id, 2, 1_000_000); // 19M
  await sell(jim.id, 3); // 30M, created last

  const stats = await getCRMDashboardStats();
  assert.deepEqual(
    stats.topCustomers.map((c: any) => [c.name, c.totalRevenue]),
    [['ج', 30_000_000], ['ب', 25_000_000], ['ت', 20_000_000], ['ث', 19_000_000], ['الف', 10_000_000]],
  );
  assert.equal(stats.totalCustomers, 6);
});
