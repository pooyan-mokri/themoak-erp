import { auth } from "@/auth";
import { Role } from "@/lib/types";
import { redirect } from "next/navigation";
import { BackupSettings } from "@/components/settings/backup-settings";
import { requireRouteAccess } from '@/lib/access';

export default async function BackupPage() {
  await requireRouteAccess('/dashboard/settings/backup');
  const session = await auth();
  
  // Check if user is admin
  if (!session?.user || session.user.role !== Role.ADMIN) {
    redirect("/dashboard/settings/profile");
  }

  return <BackupSettings />;
}

