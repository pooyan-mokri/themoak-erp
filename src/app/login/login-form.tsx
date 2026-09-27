'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { authenticate } from '@/actions/login';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Email and password, sent to the sign-in action. On success the action names
 * the landing page and the form loads it in full, so the session provider
 * starts signed in (a client navigation would keep it signed out).
 */
export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, dispatch] = useFormState(authenticate, undefined);
  const errorMessage = state?.error;

  useEffect(() => {
    if (state?.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);

  return (
    <form action={dispatch} className="mt-6 space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-[12.5px] font-normal text-muted-foreground">
          ایمیل
        </Label>
        <Input id="email" name="email" type="email" dir="ltr" autoComplete="email" placeholder="m@example.com" required />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="text-[12.5px] font-normal text-muted-foreground">
            رمز عبور
          </Label>
          <Link href="/forgot-password" className="text-[12.5px] text-brand hover:underline">
            فراموشی رمز عبور؟
          </Link>
        </div>
        <Input id="password" name="password" type="password" dir="ltr" autoComplete="current-password" required />
      </div>
      {errorMessage && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          {errorMessage}
        </p>
      )}
      <LoginButton signedIn={!!state?.redirectTo} />
    </form>
  );
}

/** Stays busy while the landing page loads after a successful sign-in. */
function LoginButton({ signedIn }: { signedIn: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full" type="submit" disabled={pending || signedIn}>
      {pending || signedIn ? 'در حال ورود...' : 'ورود'}
    </Button>
  );
}
