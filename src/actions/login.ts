'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { loginRedirectPath } from '@/lib/login-redirect';

export type LoginState = { error?: string; redirectTo?: string } | undefined;

/**
 * Signs in and tells the login page where to go; the page then loads that
 * address in full. A redirect from here made Next.js render the dashboard
 * under the /login address, with the session in the browser still signed out
 * (and every server action on that page posted to /login, which the
 * middleware bounces), and it ignored the callbackUrl.
 */
export async function authenticate(prevState: LoginState, formData: FormData): Promise<LoginState> {
  const redirectTo = loginRedirectPath(formData.get('callbackUrl'));
  try {
    await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirectTo,
      redirect: false,
    });
  } catch (error) {
    console.error('[LOGIN ACTION] Error during sign in:', error);
    if (error instanceof AuthError && error.type === 'CredentialsSignin') {
      return { error: 'ایمیل یا رمز عبور اشتباه است.' };
    }
    return { error: 'ورود انجام نشد؛ لطفاً دوباره تلاش کنید.' };
  }
  return { redirectTo };
}
