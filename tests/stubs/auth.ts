// Stand-in for @/auth so server actions can be called directly in tests.
let role: string | null = 'ADMIN';

export function setTestRole(next: string | null) {
  role = next;
}

export async function auth() {
  return role ? { user: { id: 'test-user', role } } : null;
}
