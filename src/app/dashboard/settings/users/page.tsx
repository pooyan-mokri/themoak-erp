import { getUsers } from "@/actions/user";
import { UserList } from "@/components/settings/user-list";
import { auth } from "@/auth";
import { Role } from "@/lib/types";
import { redirect } from "next/navigation";
import { requireRouteAccess } from '@/lib/access';

export default async function UsersPage() {
  await requireRouteAccess('/dashboard/settings/users');
  const session = await auth();
  
  // Check if user is admin - handle both string and enum comparison
  const userRole = session?.user?.role;
  const isAdmin = userRole === 'ADMIN' || String(userRole) === 'ADMIN';
  
  if (!isAdmin) {
    redirect("/dashboard/settings/profile");
  }

  const users = await getUsers();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold tracking-tight">مدیریت کاربران</h3>
        <p className="text-muted-foreground">
          ایجاد، ویرایش و حذف کاربران سیستم
        </p>
      </div>
      <UserList users={users} />
    </div>
  );
}
