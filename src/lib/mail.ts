// Server-only mail sending for src/actions/password-reset.ts.
// Deliberately not a 'use server' file: that would make every export a public endpoint.
import nodemailer from 'nodemailer';

/**
 * Outgoing mail goes through an SMTP server named in the environment (on
 * Vercel: Project → Settings → Environment Variables):
 *   SMTP_HOST      e.g. mail.themoak.com
 *   SMTP_PORT      465 (TLS from the start, the default) or 587 (STARTTLS)
 *   SMTP_USER      the mailbox login, e.g. no-reply@themoak.com
 *   SMTP_PASSWORD  that mailbox's password
 *   SMTP_FROM      the sender shown, e.g. "TheMoak ERP <no-reply@themoak.com>"
 * Without SMTP_HOST and SMTP_FROM no mail can be sent.
 */
export function mailSettings() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_FROM) return null;
  const port = Number(SMTP_PORT) || 465;
  return {
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD ?? '' } : undefined,
    from: SMTP_FROM,
  };
}

export async function sendMail(message: { to: string; subject: string; text: string; html: string }) {
  const settings = mailSettings();
  if (!settings) throw new Error('SMTP is not set up (SMTP_HOST, SMTP_FROM).');
  const { from, ...server } = settings;
  // A request is waiting on this: fail rather than hang.
  const transport = nodemailer.createTransport({ ...server, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 });
  await transport.sendMail({ from, ...message });
}
