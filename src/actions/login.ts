'use server';

import { headers } from 'next/headers';
import { signIn } from '@/auth';
import { AuthError } from 'next-auth';

/**
 * Where to land after signing in: the page the login screen was opened for
 * (its ?callbackUrl=), else the dashboard. Only a path inside /dashboard is
 * taken, never another host. Without this, signIn goes back to the login page
 * itself, whose redirect of a signed-in user drops the new session cookie.
 */
function landingPath(): string {
  try {
    const referer = headers().get('referer');
    const wanted = referer ? new URL(referer).searchParams.get('callbackUrl') : null;
    if (wanted) {
      const target = new URL(wanted, 'http://erp.invalid');
      if (target.pathname === '/dashboard' || target.pathname.startsWith('/dashboard/')) {
        return target.pathname + target.search;
      }
    }
  } catch {
    // A malformed referer or callbackUrl: fall back to the dashboard.
  }
  return '/dashboard';
}

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    console.log('[LOGIN ACTION] Attempting to sign in with email:', formData.get('email'));
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: landingPath(),
    });
    console.log('[LOGIN ACTION] Sign in successful');
  } catch (error) {
    console.error('[LOGIN ACTION] Error during sign in:', error);

    // In NextAuth v5, successful signIn throws a redirect error
    // Check if it's a redirect error and re-throw it
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      console.log('[LOGIN ACTION] Redirect detected (successful login)');
      throw error; // Re-throw redirect errors so Next.js can handle them
    }

    if (error instanceof AuthError) {
      console.error('[LOGIN ACTION] AuthError type:', error.type);
      console.error('[LOGIN ACTION] AuthError message:', error.message);
      console.error('[LOGIN ACTION] AuthError cause:', error.cause);
      switch (error.type) {
        case 'CredentialsSignin':
          return 'ایمیل یا رمز عبور اشتباه است.';
        default:
          console.error('[LOGIN ACTION] Unhandled AuthError type:', error.type);
          return 'ورود انجام نشد. دوباره تلاش کنید.';
      }
    }

    console.error('[LOGIN ACTION] Unknown error:', error);
    return 'خطای غیرمنتظره در ورود. دوباره تلاش کنید.';
  }
}
