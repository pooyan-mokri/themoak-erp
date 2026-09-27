'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { authenticate } from '@/actions/login';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** The sign-in answer in Persian; anything unexpected is shown as the server gave it. */
function describeError(message: string) {
  if (message === 'Invalid credentials.') return 'ایمیل یا رمز عبور درست نیست.';
  return message;
}

/** Email and password, sent to the same sign-in action as before. */
export function LoginForm() {
  const [errorMessage, dispatch] = useFormState(authenticate, undefined);

  return (
    <form action={dispatch} className="mt-6 space-y-4">
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
          {describeError(errorMessage)}
        </p>
      )}
      <LoginButton />
    </form>
  );
}

function LoginButton() {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full" type="submit" disabled={pending}>
      {pending ? 'در حال ورود...' : 'ورود'}
    </Button>
  );
}
