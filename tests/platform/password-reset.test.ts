import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { prisma, resetDatabase, form } from '../helpers/db';
import { requestPasswordReset, verifyResetToken, resetPassword } from '@/actions/password-reset';

const SENT_IF_REGISTERED = 'اگر این ایمیل در سیستم ثبت شده باشد، لینک بازیابی برای شما ارسال خواهد شد.';
const MAIL_NOT_SET_UP = 'ارسال ایمیل بازیابی در این سامانه راه‌اندازی نشده است؛ برای تغییر رمز عبور با مدیر سیستم تماس بگیرید.';
const MAIL_FAILED = 'ایمیل بازیابی ارسال نشد؛ کمی بعد دوباره تلاش کنید یا با مدیر سیستم تماس بگیرید.';
const INVALID_LINK = 'لینک بازیابی نامعتبر یا منقضی شده است.';
const OLD_PASSWORD = 'old-password-1';

// Never a real mail server: every transport is this fake, which records what it would send.
type Sent = { transport: Record<string, unknown>; mail: Record<string, any> };
let sent: Sent[] = [];
let smtpFails = false;
(nodemailer as any).createTransport = (transport: Record<string, unknown>) => ({
  sendMail: async (mail: Record<string, any>) => {
    if (smtpFails) throw new Error('535 5.7.8 authentication failed');
    sent.push({ transport, mail });
  },
});

// Everything written to the logs, to prove no reset link ends up there.
let logged = '';
for (const level of ['log', 'error', 'warn', 'info'] as const) {
  console[level] = (...args: unknown[]) => {
    logged += args.map(String).join(' ') + '\n';
  };
}

const SMTP = { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_USER: 'no-reply@example.test', SMTP_PASSWORD: 'smtp-pass', SMTP_FROM: 'TheMoak ERP <no-reply@example.test>' };
const setSmtp = (on: boolean) => {
  for (const [key, value] of Object.entries(SMTP)) {
    if (on) process.env[key] = value;
    else delete process.env[key];
  }
};

beforeEach(async () => {
  await resetDatabase();
  sent = [];
  smtpFails = false;
  logged = '';
  setSmtp(true);
  process.env.AUTH_URL = 'https://erp.example.test';
  (process.env as any).NODE_ENV = 'test';
});
afterEach(() => setSmtp(false));
after(() => prisma.$disconnect());

const staff = async () =>
  prisma.user.create({ data: { name: 'Staff <b>', email: 'staff@example.com', password: await bcrypt.hash(OLD_PASSWORD, 10), role: 'SALES' } });

const request = (email: string) => requestPasswordReset(undefined, form({ email }));
const reset = (token: string, password: string, confirmPassword = password) =>
  resetPassword(token, undefined, form({ password, confirmPassword }));
const passwordIs = async (userId: string, password: string) =>
  bcrypt.compare(password, (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).password);

test('a registered address gets one email with a link to this ERP, valid for 24 hours; nothing is logged', async () => {
  const user = await staff();
  const before = Date.now();
  const result = await request('staff@example.com');
  assert.deepEqual(result, { success: true, message: SENT_IF_REGISTERED });

  const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
  assert.match(row.token, /^[0-9a-f]{64}$/);
  assert.equal(row.used, false);
  const hours = (row.expiresAt.getTime() - before) / 3_600_000;
  assert.ok(hours > 23.99 && hours < 24.01, `expires in ${hours} h`);

  assert.equal(sent.length, 1);
  const { transport, mail } = sent[0];
  assert.deepEqual(transport, {
    host: 'smtp.example.test',
    port: 465,
    secure: true,
    auth: { user: 'no-reply@example.test', pass: 'smtp-pass' },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  assert.equal(mail.from, 'TheMoak ERP <no-reply@example.test>');
  assert.equal(mail.to, 'staff@example.com');
  assert.match(mail.subject, /بازیابی رمز عبور/);
  const link = `https://erp.example.test/reset-password/${row.token}`;
  assert.ok(mail.text.includes(link));
  assert.ok(mail.html.includes(`href="${link}"`));
  assert.ok(mail.html.includes('Staff &lt;b&gt;'), 'the name is escaped in the html');
  assert.equal(logged.includes(row.token), false, 'the token never reaches the logs');
});

test('an unknown address gets the same answer, and nothing is sent or stored', async () => {
  await staff();
  assert.deepEqual(await request('nobody@example.com'), { success: true, message: SENT_IF_REGISTERED });
  assert.equal(sent.length, 0);
  assert.equal(await prisma.passwordResetToken.count(), 0);
});

test('a malformed address is refused before anything happens', async () => {
  await staff();
  for (const email of ['', 'staff', 'staff@', '<script>@x']) {
    const result = await request(email);
    assert.equal(result.success, false, email);
    assert.equal(result.message, 'لطفا ایمیل معتبر وارد کنید.');
  }
  assert.equal(sent.length, 0);
  assert.equal(await prisma.passwordResetToken.count(), 0);
});

test('without SMTP settings every address is told to ask the admin, and no link is made', async () => {
  await staff();
  setSmtp(false);
  for (const email of ['staff@example.com', 'nobody@example.com']) {
    assert.deepEqual(await request(email), { success: false, message: MAIL_NOT_SET_UP }, email);
  }
  process.env.SMTP_HOST = 'smtp.example.test'; // a host without a sender is not enough
  assert.deepEqual(await request('staff@example.com'), { success: false, message: MAIL_NOT_SET_UP });
  assert.equal(sent.length, 0);
  assert.equal(await prisma.passwordResetToken.count(), 0);
});

test('in development without SMTP the link is shown on the page instead of sent', async () => {
  const user = await staff();
  setSmtp(false);
  (process.env as any).NODE_ENV = 'development';
  const result: any = await request('staff@example.com');
  const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
  assert.deepEqual(result, { success: true, message: SENT_IF_REGISTERED, token: row.token });
  assert.equal(sent.length, 0);
});

test('port 587 uses STARTTLS, and a server without a login sends without one', async () => {
  await staff();
  process.env.SMTP_PORT = '587';
  delete process.env.SMTP_USER;
  await request('staff@example.com');
  assert.equal(sent[0].transport.port, 587);
  assert.equal(sent[0].transport.secure, false);
  assert.equal(sent[0].transport.auth, undefined);
});

test('an email that could not be sent says so, and its link is dead', async () => {
  const user = await staff();
  smtpFails = true;
  assert.deepEqual(await request('staff@example.com'), { success: false, message: MAIL_FAILED });
  const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
  assert.equal(row.used, true);
  assert.equal((await verifyResetToken(row.token)).valid, false);
  assert.equal((await reset(row.token, 'new-password-1')).success, false);
  assert.ok(await passwordIs(user.id, OLD_PASSWORD));
  assert.equal(logged.includes(row.token), false);
});

test('a new request kills the links sent before it', async () => {
  const user = await staff();
  await request('staff@example.com');
  await request('staff@example.com');
  const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(rows.map((r: { used: boolean }) => r.used), [true, false]);
  assert.equal(sent.length, 2);
  assert.equal((await reset(rows[0].token, 'new-password-1')).message, INVALID_LINK);
  assert.equal((await reset(rows[1].token, 'new-password-1')).success, true);
});

test('the link opens for its user until it is used or 24 hours pass', async () => {
  const user = await staff();
  await request('staff@example.com');
  const { token } = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });

  assert.deepEqual(await verifyResetToken(token), { valid: true, email: 'staff@example.com' });
  assert.deepEqual(await verifyResetToken('0'.repeat(64)), { valid: false, message: 'لینک بازیابی نامعتبر است.' });
  assert.equal((await verifyResetToken('')).valid, false);

  await prisma.passwordResetToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.deepEqual(await verifyResetToken(token), { valid: false, message: 'لینک بازیابی منقضی شده است.' });
  assert.equal((await reset(token, 'new-password-1')).message, INVALID_LINK);
  assert.ok(await passwordIs(user.id, OLD_PASSWORD), 'an expired link changes nothing');
  assert.equal(await prisma.passwordResetToken.count({ where: { used: true } }), 0);
});

test('a reset changes the password once: the old one stops working and the link dies', async () => {
  const user = await staff();
  await request('staff@example.com');
  const { token } = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });

  assert.equal((await reset(token, 'new-password-1', 'something-else')).success, false);
  assert.equal((await reset(token, '12345')).success, false);
  assert.ok(await passwordIs(user.id, OLD_PASSWORD), 'a refused form changes nothing');
  assert.equal((await verifyResetToken(token)).valid, true, 'and leaves the link usable');

  const done = await reset(token, 'new-password-1');
  assert.deepEqual(done, { success: true, message: 'رمز عبور با موفقیت تغییر یافت. اکنون می‌توانید وارد شوید.' });
  assert.ok(await passwordIs(user.id, 'new-password-1'));
  assert.equal(await passwordIs(user.id, OLD_PASSWORD), false);
  assert.deepEqual(await verifyResetToken(token), { valid: false, message: 'این لینک قبلاً استفاده شده است.' });

  assert.equal((await reset(token, 'another-password')).message, INVALID_LINK);
  assert.ok(await passwordIs(user.id, 'new-password-1'), 'a used link changes nothing');
  const log = await prisma.activityLog.findMany({ where: { userId: user.id } });
  assert.deepEqual(log.map((l: { action: string }) => l.action), ['RESET_PASSWORD']);
});

test('the same link submitted twice at once changes the password once', async () => {
  const user = await staff();
  await request('staff@example.com');
  const { token } = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });

  const results = await Promise.all([reset(token, 'first-password'), reset(token, 'second-password')]);
  assert.equal(results.filter((r) => r.success).length, 1);
  const winner = results[0].success ? 'first-password' : 'second-password';
  const loser = results[0].success ? 'second-password' : 'first-password';
  assert.ok(await passwordIs(user.id, winner));
  assert.equal(await passwordIs(user.id, loser), false);
  assert.equal(await prisma.activityLog.count({ where: { action: 'RESET_PASSWORD' } }), 1);
});

test('a reset request finds the account whatever the letter case of the address', async () => {
  const user = await staff();
  assert.deepEqual(await request('  STAFF@Example.com '), { success: true, message: SENT_IF_REGISTERED });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].mail.to, 'staff@example.com');
  assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 1);
});
