import { currentApiActor } from '@/lib/api-actor';

// Stand-in for @/auth so server actions can be called directly in tests.
let role: string | null = 'ADMIN';

export function setTestRole(next: string | null) {
  role = next;
}

export async function auth() {
  // Inside an /api/erp call made with a personal key, as src/auth.ts: that key's user.
  const actor = currentApiActor();
  if (actor) return { user: { id: actor.id, name: actor.name, email: actor.email, role: actor.role } };
  return role ? { user: { id: 'test-user', role } } : null;
}

type SignIn = (provider: string, options: Record<string, unknown>) => Promise<unknown>;
let signInImpl: SignIn = async () => {
  throw new Error('signIn is not set up in this test: call setTestSignIn first.');
};

/** What signIn does in this test (src/actions/login.ts calls it). */
export function setTestSignIn(next: SignIn) {
  signInImpl = next;
}

export async function signIn(provider: string, options: Record<string, unknown>) {
  return signInImpl(provider, options);
}
