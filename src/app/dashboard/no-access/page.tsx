import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NoAccessPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <ShieldAlert className="h-12 w-12 text-muted-foreground" />
      <h1 className="text-2xl font-bold tracking-tight">دسترسی ندارید</h1>
      <p className="text-muted-foreground">
        شما به این بخش دسترسی ندارید. اگر به آن نیاز دارید، با مدیر سیستم تماس بگیرید.
      </p>
      <Button asChild>
        <Link href="/dashboard">بازگشت به داشبورد</Link>
      </Button>
    </div>
  );
}
