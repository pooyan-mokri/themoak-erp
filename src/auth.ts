import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';

// Debug logging
console.log('[AUTH DEBUG] Initializing auth.ts');
console.log('[AUTH DEBUG] AUTH_SECRET exists:', !!process.env.AUTH_SECRET);
console.log('[AUTH DEBUG] AUTH_SECRET length:', process.env.AUTH_SECRET?.length || 0);
console.log('[AUTH DEBUG] NEXTAUTH_SECRET exists:', !!process.env.NEXTAUTH_SECRET);
console.log('[AUTH DEBUG] NEXTAUTH_SECRET length:', process.env.NEXTAUTH_SECRET?.length || 0);
console.log('[AUTH DEBUG] DATABASE_URL exists:', !!process.env.DATABASE_URL);

async function getUser(email: string) {
  try {
    console.log('[AUTH DEBUG] Fetching user:', email);
    const user = await prisma.user.findUnique({ where: { email } });
    console.log('[AUTH DEBUG] User found:', !!user);
    return user;
  } catch (error) {
    console.error('[AUTH DEBUG] Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}

const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
console.log('[AUTH DEBUG] Using secret:', !!authSecret, 'Length:', authSecret?.length);

if (!authSecret) {
  console.error('[AUTH DEBUG] ❌ NO AUTH SECRET FOUND! This will cause authentication to fail.');
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: authSecret,
  trustHost: true,
  providers: [
    Credentials({
      async authorize(credentials) {
        console.log('[AUTH DEBUG] Authorize called with credentials:', { email: credentials?.email });

        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        console.log('[AUTH DEBUG] Credentials validation:', parsedCredentials.success);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);

          if (!user) {
            console.log('[AUTH DEBUG] User not found:', email);
            return null;
          }

          const passwordsMatch = await bcrypt.compare(password, user.password);
          console.log('[AUTH DEBUG] Password match:', passwordsMatch);

          if (passwordsMatch) {
            console.log('[AUTH DEBUG] Login successful for:', email);
            return {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
            };
          }
        }

        console.log('[AUTH DEBUG] Invalid credentials');
        return null;
      },
    }),
  ],
  callbacks: {
    async session({ token, session }) {
      console.log('[AUTH DEBUG] Session callback called');
      console.log('[AUTH DEBUG] Token:', !!token, 'Session:', !!session);
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name;
        session.user.email = token.email as string;
        session.user.role = token.role as Role;
      }
      console.log('[AUTH DEBUG] Session created for user:', session.user?.email);
      return session;
    },
    async jwt({ token, user }) {
      console.log('[AUTH DEBUG] JWT callback called');
      console.log('[AUTH DEBUG] User:', !!user);
      if (user) {
        token.id = user.id;
        token.role = user.role;
        console.log('[AUTH DEBUG] JWT token created for:', user.email);
      }
      return token;
    },
  },
});
