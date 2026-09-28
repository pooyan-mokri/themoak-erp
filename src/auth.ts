import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import type { JWT } from 'next-auth/jwt';
import { findUserByEmail } from '@/lib/user-email';

// No email, password result or session is ever logged here: these run on every
// sign-in and every session read, and the logs are not a place for them.

async function getUser(email: string) {
  try {
    // Any letter case: people type Sara@… as often as sara@….
    return await findUserByEmail(email);
  } catch (error) {
    console.error('[auth] could not read the user:', error);
    throw new Error('Failed to fetch user.');
  }
}

/**
 * The role is copied into the JWT at login. Re-read it whenever the session is
 * read, so a role change applies on the next request, and a deleted user's
 * session, or one from before a password change, ends without waiting for a
 * logout. Returning null makes Auth.js treat
 * the request as signed out (and clear the cookie where it can set one).
 * Middleware runs auth.config.ts on Edge, without Prisma, and never calls this.
 */
export async function withCurrentRole(token: JWT): Promise<JWT | null> {
  if (!token.id) return null;
  const user = await prisma.user.findUnique({ where: { id: token.id }, select: { role: true, passwordChangedAt: true } });
  if (!user) return null;
  // A session from before the password last changed (by its owner, a reset
  // link or an admin) ends. Auth.js re-issues the cookie on every read, so iat
  // is its last use. Whole seconds, as iat: a sign-in in the second of the
  // change still counts.
  if (user.passwordChangedAt) {
    const changed = Math.floor(user.passwordChangedAt.getTime() / 1000);
    if (typeof token.iat !== 'number' || token.iat < changed) return null;
  }
  return { ...token, role: user.role };
}

const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

if (!authSecret) {
  console.error('[auth] No AUTH_SECRET (or NEXTAUTH_SECRET) is set: sign-in cannot work.');
}

let authExport;
try {
  authExport = NextAuth({
  ...authConfig,
  secret: authSecret,
  trustHost: true,
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().trim().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);

          if (!user) {
            return null;
          }

          const passwordsMatch = await bcrypt.compare(password, user.password);

          if (passwordsMatch) {
            return {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
            };
          }
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async session({ token, session }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name;
        session.user.email = token.email as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string; // authorize() always returns the id
        token.role = user.role;
        return token;
      }
      return withCurrentRole(token);
    },
  },
});
} catch (error) {
  console.error('[auth] NextAuth could not start:', error);
  throw error;
}

export const { handlers, auth, signIn, signOut } = authExport;
