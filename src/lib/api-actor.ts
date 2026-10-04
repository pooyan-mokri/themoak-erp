import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who an /api/erp call made with a personal key acts as (src/lib/api-keys.ts).
 * Inside runAsApiUser, auth() (src/auth.ts) answers with this user, so every
 * server action the call runs checks that user's role, exactly as if they had
 * done it in the app. Per call, never shared between two calls.
 */
export type ApiActor = { id: string; name: string; email: string; role: string };

const store = new AsyncLocalStorage<ApiActor>();

export function runAsApiUser<T>(actor: ApiActor, fn: () => Promise<T>): Promise<T> {
  return store.run(actor, fn);
}

export function currentApiActor(): ApiActor | undefined {
  return store.getStore();
}
