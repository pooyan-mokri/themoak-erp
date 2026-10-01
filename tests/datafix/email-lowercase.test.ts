import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { normalizeEmail } from '@/lib/user-email';
import { reportRows, rowsHash, runTwice } from './sql';

// prisma/sql/datafix-2026-10-01-email-lowercase.sql: user emails stored as normalizeEmail stores them,
// except where two users would end up with one address.

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

test('emails are stored trimmed and lower-case unless that makes two users share one; the collision is left', async () => {
  const user = (name: string, email: string) => prisma.user.create({ data: { name, email, password: 'x' } });
  const ali = await user('Ali', 'Ali.Rezaei@TheMoak.com');
  const sara = await user('Sara', ' sara@themoak.com ');
  const lower = await user('Nima', 'nima@themoak.com');
  const reza1 = await user('Reza', 'Reza@TheMoak.com');
  const reza2 = await user('Reza 2', 'reza@themoak.com');
  const untouched = await rowsHash('User', [ali.id, sara.id]);

  await runTwice('datafix-2026-10-01-email-lowercase.sql', ['User']);

  const email = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).email;
  assert.equal(await email(ali.id), 'ali.rezaei@themoak.com');
  assert.equal(await email(sara.id), 'sara@themoak.com');
  assert.equal(await email(ali.id), normalizeEmail(ali.email));
  // The two Rezas, the collision, and an address already lower-case: as they were.
  assert.equal(await rowsHash('User', [ali.id, sara.id]), untouched);
  assert.deepEqual([await email(reza1.id), await email(reza2.id), await email(lower.id)], ['Reza@TheMoak.com', 'reza@themoak.com', 'nima@themoak.com']);
  // The read-only report now lists the collision only.
  assert.deepEqual((await reportRows('report-user-email-case.sql', 0)).map((r: any) => [r.address, Number(r.accounts)]), [['reza@themoak.com', 2]]);
  assert.deepEqual((await reportRows('report-user-email-case.sql', 1)).map((r: any) => r.id), [reza1.id]);
});
