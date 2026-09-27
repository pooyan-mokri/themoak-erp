import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { LogoProvider } from '@/components/providers/logo-provider';
import { SiteHookAlerts } from '@/components/layout/site-hook-alerts';
import { CommandPalette } from '@/components/layout/command-palette';
import { NavKeys } from '@/components/layout/nav-keys';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';

export const dynamic = 'force-dynamic';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LogoProvider>
      <div className="relative h-full">
        {/* Sidebar, 232px (design system §12) - hidden when printing */}
        <div className="fixed inset-y-0 z-30 hidden h-full border-l md:flex md:w-[232px] md:flex-col print:hidden">
          <Sidebar />
        </div>
        <main className="h-full md:pr-[232px] print:pr-0">
          {/* Header with the breadcrumb - hidden when printing */}
          <div className="sticky top-0 z-40 print:hidden">
            <Header />
          </div>
          <div className="erp-page p-4 pb-24 md:p-6 print:p-0">
            {/* Stock push alerts for admins - hidden when printing */}
            <SiteHookAlerts />
            {children}
          </div>
        </main>
        <MobileTabBar />
        <CommandPalette />
        <NavKeys />
      </div>
    </LogoProvider>
  );
}
