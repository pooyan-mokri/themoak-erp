'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { verifyResetToken, resetPassword } from '@/actions/password-reset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Link from 'next/link';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const [tokenStatus, setTokenStatus] = useState<{
    valid: boolean;
    email?: string;
    message?: string;
    loading: boolean;
  }>({ valid: false, loading: true });

  const resetPasswordWithToken = resetPassword.bind(null, params.token);
  const [state, dispatch] = useFormState(resetPasswordWithToken, initialState);

  useEffect(() => {
    // Verify token on mount
    verifyResetToken(params.token).then((result) => {
      setTokenStatus({
        valid: result.valid,
        email: result.email,
        message: result.message,
        loading: false,
      });
    });
  }, [params.token]);

  // Redirect to login after successful password reset
  useEffect(() => {
    if (state.success) {
      const timer = setTimeout(() => {
        router.push('/login');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [state.success, router]);

  if (tokenStatus.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">در حال بررسی لینک بازیابی...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tokenStatus.valid) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-red-600">لینک نامعتبر</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{tokenStatus.message}</AlertDescription>
            </Alert>
            <Link href="/forgot-password">
              <Button variant="outline" className="w-full">
                درخواست لینک جدید
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="ghost" className="w-full">
                بازگشت به صفحه ورود
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">تنظیم رمز عبور جدید</CardTitle>
          <CardDescription className="text-center">
            برای {tokenStatus.email}
          </CardDescription>
        </CardHeader>

        {state.success ? (
          <CardContent className="space-y-4">
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                {state.message}
              </AlertDescription>
            </Alert>
            <p className="text-sm text-center text-muted-foreground">
              در حال انتقال به صفحه ورود...
            </p>
          </CardContent>
        ) : (
          <form action={dispatch}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">رمز عبور جدید</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="حداقل ۶ کاراکتر"
                  required
                  autoFocus
                />
                {state.errors?.password && (
                  <p className="text-sm text-red-500">{state.errors.password}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">تکرار رمز عبور</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="مجدداً وارد کنید"
                  required
                />
                {state.errors?.confirmPassword && (
                  <p className="text-sm text-red-500">{state.errors.confirmPassword}</p>
                )}
              </div>

              {state.message && !state.success && (
                <Alert variant="destructive">
                  <AlertDescription>{state.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter>
              <SubmitButton />
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full" type="submit" disabled={pending}>
      {pending ? 'در حال تغییر...' : 'تغییر رمز عبور'}
    </Button>
  );
}
