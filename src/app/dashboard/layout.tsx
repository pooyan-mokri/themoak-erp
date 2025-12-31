import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { LogoProvider } from '@/components/providers/logo-provider';
import { DashboardBreadcrumb } from '@/components/layout/dashboard-breadcrumb';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LogoProvider>
      <div className="h-full relative">
        <div className="hidden h-full md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 md:right-0 z-[80] bg-gray-900">
          <Sidebar />
        </div>
        <main className="md:pr-72 h-full">
          <Header />
          <div className="p-4 md:p-8">
            <div className="hidden md:block">
              <DashboardBreadcrumb />
            </div>
            {children}
          </div>
        </main>
      </div>
    </LogoProvider>
  );
}
