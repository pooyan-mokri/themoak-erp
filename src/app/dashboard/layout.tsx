import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { LogoProvider } from '@/components/providers/logo-provider';
import { DashboardBreadcrumb } from '@/components/layout/dashboard-breadcrumb';

export const dynamic = 'force-dynamic';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LogoProvider>
      <div className="h-full relative">
        {/* Sidebar - Hidden when printing */}
        <div className="hidden h-full md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 z-[80] bg-gray-900 print:hidden">
          <Sidebar />
        </div>
        <main className="md:pr-72 h-full print:pr-0">
          {/* Header - Hidden when printing */}
          <div className="print:hidden">
            <Header />
          </div>
          <div className="p-4 md:p-8 print:p-0">
            {/* Breadcrumb - Hidden when printing */}
            <div className="hidden md:block print:hidden">
              <DashboardBreadcrumb />
            </div>
            {children}
          </div>
        </main>
      </div>
    </LogoProvider>
  );
}
