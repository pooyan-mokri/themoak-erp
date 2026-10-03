/**
 * DATA FIX 2026-10-01: close purchase order #4 (FINEWELL) short, with a supplier credit for what did not come.
 * Not part of the build. Run by hand, AFTER prisma/sql/datafix-2026-10-01-ALL.sql (which records what Pooyan
 * paid on #4 outside the ERP), against the database to fix:
 *
 *   DATABASE_URL="<database url>" npx tsx scripts/datafix-2026-10-01-close-po4-short.ts
 *
 * What it changes: Pooyan's decision is to close #4 short. 2 of the 10 units of VOID/GREN never came. It runs the
 * app's own close (closeShortInTransaction, src/lib/close-short.ts, the code «بستن با کسری» on the order page
 * runs): the order's additional costs are re-spread over the units received, onto each line's received cost and
 * its product's cost price; the order becomes RECEIVED; what was paid for the 2 missing units becomes FINEWELL's
 * credit («طلب از تأمین‌کننده», SupplierCredit 'po-short:<order id>'). The only difference from the page: no
 * user is recorded on the credit.
 *
 * It refuses, and changes nothing, unless #4 is what Pooyan described: FINEWELL's, PARTIALLY_RECEIVED, short only
 * on VOID/GREN (10 ordered, 8 received), and paid in full (so the run of the SQL fixes came first).
 * Idempotent: an order already closed short is reported and left.
 */
import { prisma } from '@/lib/prisma';
import { closeShortInTransaction } from '@/lib/close-short';

const NUMBER = 4;

/** Close #4 short; what was done, in one line. Throws, changing nothing, when #4 is not as expected. */
export async function closePo4Short(client: any = prisma): Promise<string> {
  return client.$transaction(async (tx: any) => {
    const order = await tx.purchaseOrder.findFirst({
      where: { number: NUMBER },
      include: { supplier: true, items: { include: { product: true } }, payments: true, supplierCredits: true },
    });
    if (!order) throw new Error(`purchase order #${NUMBER} not found`);
    const credit = order.supplierCredits.find((c: any) => c.clientRequestId === `po-short:${order.id}`);
    if (order.status === 'RECEIVED' && credit) {
      return `#${NUMBER} is already closed short; FINEWELL's credit for it is ${Number(credit.amount)} toman. Nothing changed.`;
    }
    const short = order.items.filter((item: any) => item.receivedQuantity < item.quantity);
    const paid = order.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
    const problems = [
      order.supplier.name !== 'FINEWELL' && `its supplier is not FINEWELL`,
      order.status !== 'PARTIALLY_RECEIVED' && `its status is ${order.status}, not PARTIALLY_RECEIVED`,
      !(short.length === 1 && short[0].product.sku === 'VOID/GREN' && short[0].quantity === 10 && short[0].receivedQuantity === 8) &&
        `it is not short exactly 2 of 10 VOID/GREN`,
      paid < Number(order.totalAmountInToman) - 1 && `it is paid ${paid} of ${Number(order.totalAmountInToman)}: run datafix-2026-10-01-ALL.sql first`,
    ].filter(Boolean);
    if (problems.length) throw new Error(`purchase order #${NUMBER} left as it is: ${problems.join('; ')}.`);
    const result = await closeShortInTransaction(tx, order.id, { userId: null });
    return `#${NUMBER} closed short: ${result.missing} units missing, ${Math.round(result.respread)} toman of additional costs re-spread, FINEWELL credited ${Math.round(result.credit)} toman.`;
    // Run against a remote database (Liara over its public address) this takes several seconds
    // of round trips, beyond Prisma's default 5 s interactive-transaction limit.
  }, { maxWait: 30_000, timeout: 120_000 });
}

if (require.main === module) {
  closePo4Short()
    .then((done) => console.log(done))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
