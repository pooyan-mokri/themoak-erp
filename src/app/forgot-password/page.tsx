'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { requestPasswordReset } from '@/actions/password-reset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';

interface State {
  message: string;
  errors?: {
    email?: string[];
  };
  success: boolean;
  token?: string;
}

const initialState: State = {
  message: '',
  errors: {},
  success: false,
  token: undefined,
};

export default function ForgotPasswordPage() {
  const [state, dispatch] = useFormState<State, FormData>(requestPasswordReset, initialState);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">بازیابی رمز عبور</CardTitle>
          <CardDescription className="text-center">
            ایمیل خود را وارد کنید تا لینک بازیابی برای شما ارسال شود
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
            
            {process.env.NODE_ENV === 'development' && state.token && (
              <Alert>
                <AlertDescription className="text-sm">
                  <strong>توکن توسعه:</strong> {state.token}
                  <br />
                  <Link 
                    href={`/reset-password/${state.token}`}
                    className="text-blue-600 hover:underline"
                  >
                    برو به صفحه بازیابی →
                  </Link>
                </AlertDescription>
              </Alert>
            )}

            <div className="pt-4">
              <Link href="/login">
                <Button variant="outline" className="w-full">
                  بازگشت به صفحه ورود
                </Button>
              </Link>
            </div>
          </CardContent>
        ) : (
          <form action={dispatch}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">ایمیل</Label>
                <Input 
                  id="email" 
                  name="email" 
                  type="email" 
                  placeholder="m@example.com" 
                  required 
                  autoFocus
                />
                {state.errors?.email && (
                  <p className="text-sm text-red-500">{state.errors.email}</p>
                )}
              </div>
              {state.message && !state.success && (
                <Alert variant="destructive">
                  <AlertDescription>{state.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <SubmitButton />
              <Link href="/login" className="text-sm text-center text-muted-foreground hover:text-primary">
                <div className="flex items-center justify-center gap-1">
                  <ArrowRight className="h-4 w-4" />
                  بازگشت به صفحه ورود
                </div>
              </Link>
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
      {pending ? 'در حال ارسال...' : 'ارسال لینک بازیابی'}
    </Button>
  );
}
