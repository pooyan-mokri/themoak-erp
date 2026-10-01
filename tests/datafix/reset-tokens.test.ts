import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { runTwice } from './sql';

// prisma/sql/datafix-2026-10-01-reset-tokens.sql: every outstanding password-reset link expires.

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

test('every unused, unexpired reset link expires; used and expired ones stay as they were', async () => {
  const user = await prisma.user.create({ data: { name: 'Sara', email: 'sara@themoak.com', password: 'x' } });
  const inADay = new Date(Date.now() + 86_400_000);
  const lastWeek = new Date(Date.now() - 7 * 86_400_000);
  const open = await prisma.passwordResetToken.create({ data: { userId: user.id, token: 'open', expiresAt: inADay } });
  const open2 = await prisma.passwordResetToken.create({ data: { userId: user.id, token: 'open-2', expiresAt: inADay } });
  const used = await prisma.passwordResetToken.create({ data: { userId: user.id, token: 'used', expiresAt: inADay, used: true } });
  const expired = await prisma.passwordResetToken.create({ data: { userId: user.id, token: 'expired', expiresAt: lastWeek } });

  const start = new Date();
  await runTwice('datafix-2026-10-01-reset-tokens.sql', ['PasswordResetToken']);

  const rows = Object.fromEntries((await prisma.passwordResetToken.findMany()).map((t: any) => [t.token, t]));
  for (const token of ['open', 'open-2']) {
    assert.ok(rows[token].expiresAt <= new Date() && rows[token].expiresAt >= new Date(start.getTime() - 1000), token);
    assert.equal(rows[token].used, false, 'still shown as never used');
  }
  assert.deepEqual(rows.used, used);
  assert.deepEqual(rows.expired, expired);
  // None can be used any more (the reset page claims only a token with expiresAt > now).
  assert.equal(await prisma.passwordResetToken.count({ where: { used: false, expiresAt: { gt: new Date() } } }), 0);
  assert.ok(open && open2);
});
