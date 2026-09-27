import { auth } from '@/auth';
import { PageHeader } from '@/components/layout/page-header';
import { SettingsNav } from '@/components/settings/settings-nav';

/**
 * Settings: the sections at the start, the open section's panels beside them.
 * Every user has their profile; the rest is for an admin, and each of those pages
 * (and its actions) checks the role again.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN';

  return (
    <div className="space-y-4">
      <PageHeader
        title="تنظیمات"
        description={
          isAdmin
            ? 'مشخصات شرکت، کاربران، بک‌آپ، اتصال سایت و حساب شما'
            : 'اطلاعات حساب و رمز عبور شما'
        }
      />
      <div className="grid gap-4 lg:grid-cols-[224px_minmax(0,1fr)]">
        <SettingsNav isAdmin={isAdmin} />
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </div>
  );
}
