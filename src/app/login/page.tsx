import { Check } from 'lucide-react';
import pkg from '../../../package.json';
import { LoginForm } from './login-form';

/** What the ERP holds, in the panel beside the form: the sections this app really has. */
const SECTIONS = [
  'سفارش‌های فروشگاه و سایت در یک فهرست',
  'موجودی هر انبار، همگام با سایت',
  'حسابداری، حقوق و دستمزد و گزارش‌ها',
  'دستیار هوش مصنوعی برای پرسش از داده‌ها',
];

export default function LoginPage() {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <main className="flex min-h-screen flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[15px] tracking-[.04em] text-brand">THEMOAK</span>
          <span className="rounded bg-secondary px-1.5 font-mono text-[11px] text-muted-foreground">ERP</span>
        </div>

        <div className="my-auto w-full max-w-[400px] py-12">
          <h1 className="text-[22px] font-semibold leading-snug">ورود به سامانه</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">برای ورود ایمیل و رمز عبور خود را وارد کنید.</p>
          <LoginForm />
        </div>

        <footer className="text-[11.5px] text-muted-foreground">
          TheMoak ERP · نسخهٔ <span className="font-mono" dir="ltr">{pkg.version}</span>
        </footer>
      </main>

      <aside className="hidden border-s bg-card lg:flex lg:items-center lg:justify-center lg:px-16">
        <div className="w-full max-w-[420px] space-y-5">
          <span className="inline-flex rounded-full bg-brand-soft px-2.5 py-0.5 text-[11.5px] text-brand">ابزار کار TheMoak</span>
          <h2 className="text-[22px] font-semibold leading-snug">فروش، انبار و حساب‌ها در یک ابزار</h2>
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            هر کس با نقش خودش وارد می‌شود و همان بخش‌هایی را می‌بیند که به کارش مربوط است.
          </p>
          <ul className="space-y-2.5">
            {SECTIONS.map((section) => (
              <li key={section} className="flex items-center gap-2.5 text-[13.5px]">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                  <Check className="h-3 w-3" strokeWidth={2.25} />
                </span>
                {section}
              </li>
            ))}
          </ul>
          <div className="grid h-40 place-items-center rounded-lg border bg-background">
            <span className="font-mono text-[28px] tracking-[.08em] text-brand">THEMOAK</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
