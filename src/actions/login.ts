'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    console.log('[LOGIN ACTION] Attempting to sign in with email:', formData.get('email'));
    await signIn('credentials', formData);
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
          return 'Invalid credentials.';
        default:
          console.error('[LOGIN ACTION] Unhandled AuthError type:', error.type);
          return 'Authentication error: ' + error.message;
      }
    }

    console.error('[LOGIN ACTION] Unknown error:', error);
    return 'An unexpected error occurred.';
  }
}
