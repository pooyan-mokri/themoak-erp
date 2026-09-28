// Server-only: src/auth.ts and the user and password-reset actions share it.
import { prisma } from '@/lib/prisma';

/** How an email address is stored: trimmed and lower-case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The user with this email address, whatever its letter case. Addresses saved
 * before they were stored lower-case may differ from each other only by case
 * (prisma/sql/report-user-email-case.sql lists them): then only the exact
 * spelling is taken, and anything else finds nobody.
 */
export async function findUserByEmail(email: string) {
  const typed = email.trim();
  const matches = await prisma.user.findMany({ where: { email: { equals: typed, mode: 'insensitive' } } });
  if (matches.length <= 1) return matches[0] ?? null;
  return matches.find((user: { email: string }) => user.email === typed) ?? null;
}

/** Another user already holding this address, in any letter case. */
export function emailTakenByOther(email: string, exceptUserId?: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' }, ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}) },
    select: { id: true },
  });
}
