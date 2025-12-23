
'use client';

import { createUser } from '@/actions/user';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Role } from '@prisma/client';
import { useFormState, useFormStatus } from 'react-dom';

const initialState = {
  message: '',
  errors: {},
};

export function UserForm() {
  const [state, dispatch] = useFormState(createUser, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>افزودن کاربر جدید</CardTitle>
        <CardDescription>
          اطلاعات کاربر جدید را وارد کنید.
        </CardDescription>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام کامل</Label>
            <Input id="name" name="name" placeholder="مثال: علی رضایی" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">ایمیل</Label>
            <Input id="email" name="email" type="email" placeholder="ali@example.com" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">رمز عبور</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">نقش کاربری</Label>
            <Select name="role" required defaultValue="USER">
              <SelectTrigger>
                <SelectValue placeholder="انتخاب نقش" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USER">کاربر عادی</SelectItem>
                <SelectItem value="ADMIN">مدیر سیستم</SelectItem>
                <SelectItem value="ACCOUNTANT">حسابدار</SelectItem>
                <SelectItem value="SALES">فروشنده</SelectItem>
                <SelectItem value="WAREHOUSE">انباردار</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {state.message && (
            <div className={`text-sm p-2 rounded ${state.message.includes('موفقیت') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {state.message}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <SubmitButton />
        </CardFooter>
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'در حال ایجاد...' : 'ایجاد کاربر'}
    </Button>
  );
}
