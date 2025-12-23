
import { getRecentActivities } from '@/actions/activity';
import { getUsers } from '@/actions/user';
import { ActivityFeed } from '@/components/admin/activity-feed';
import { UserForm } from '@/components/admin/user-form';
import { UserList } from '@/components/admin/user-list';

export default async function AdminUsersPage() {
  const users = await getUsers();
  const activities = await getRecentActivities();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت کاربران</h1>
      
      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <UserList users={users} />
          <UserForm />
        </div>
        <div className="md:col-span-1">
          <ActivityFeed activities={activities} />
        </div>
      </div>
    </div>
  );
}
