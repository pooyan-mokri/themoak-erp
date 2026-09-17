// One Auth.js configuration for the whole app: src/auth.ts. This module used to
// start a second NextAuth instance (with an unused PrismaAdapter), so sessions
// read through it missed the role refresh in src/auth.ts.
export { handlers, auth, signIn, signOut } from '@/auth';
