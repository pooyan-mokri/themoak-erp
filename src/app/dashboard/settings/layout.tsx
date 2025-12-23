'use client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Role } from "@/lib/types";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();

  // Check if user is admin - handle both string and enum comparison
  const userRole = session?.user?.role;
  const isAdmin = userRole === 'ADMIN' || String(userRole) === 'ADMIN';

  // Determine active tab based on path
  let activeTab = isAdmin ? "company" : "profile";
  if (pathname.includes("/settings/profile")) activeTab = "profile";
  if (pathname.includes("/settings/users")) activeTab = "users";
  if (pathname.includes("/settings/backup")) activeTab = "backup";
  if (pathname === "/dashboard/settings" && isAdmin) activeTab = "company";

  const handleTabChange = (value: string) => {
    switch (value) {
      case "company":
        router.push("/dashboard/settings");
        break;
      case "profile":
        router.push("/dashboard/settings/profile");
        break;
      case "users":
        router.push("/dashboard/settings/users");
        break;
      case "backup":
        router.push("/dashboard/settings/backup");
        break;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">تنظیمات</h2>
        <p className="text-muted-foreground">
          مدیریت تنظیمات سیستم و حساب کاربری
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          {isAdmin && (
            <TabsTrigger value="company">تنظیمات شرکت</TabsTrigger>
          )}
          <TabsTrigger value="profile">پروفایل من</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="users">مدیریت کاربران</TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="backup">بک‌آپ</TabsTrigger>
          )}
        </TabsList>
        <div className="mt-6">
          {children}
        </div>
      </Tabs>
    </div>
  );
}
