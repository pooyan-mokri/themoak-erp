'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { changePassword } from '@/actions/user';
import { toast } from 'sonner';
import { FieldRow, PanelActions, SettingsPanel } from './settings-panel';
import { signOut } from 'next-auth/react';

export function PasswordForm() {
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    const newPass = formData.get('newPassword') as string;
    const confirmPass = formData.get('confirmPassword') as string;

    if (newPass !== confirmPass) {
      toast.error('رمز عبور جدید و تکرار آن مطابقت ندارند.');
      return;
    }

    setLoading(true);
    const result = await changePassword(null, formData);
    setLoading(false);

    if (result.success) {
      toast.success(result.message);
      // Every session from before the change has ended, this one too.
      await signOut({ callbackUrl: '/login' });
    } else {
      toast.error(result.message);
    }
  };

  return (
    <SettingsPanel title="تغییر رمز عبور" description="برای امنیت بیشتر، رمز عبور خود را دوره‌ای تغییر دهید.">
      <form id="password-form" action={handleSubmit}>
        <FieldRow label="رمز عبور فعلی" htmlFor="currentPassword">
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
          />
        </FieldRow>
        <FieldRow label="رمز عبور جدید" htmlFor="newPassword" hint="دست‌کم ۶ نویسه.">
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            required
            minLength={6}
          />
        </FieldRow>
        <FieldRow label="تکرار رمز عبور جدید" htmlFor="confirmPassword">
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            required
            minLength={6}
          />
        </FieldRow>
        <PanelActions>
          <Button type="submit" disabled={loading}>
            {loading ? 'در حال تغییر...' : 'تغییر رمز عبور'}
          </Button>
        </PanelActions>
      </form>
    </SettingsPanel>
  );
}
