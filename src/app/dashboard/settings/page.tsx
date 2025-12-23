import { auth } from "@/auth";
import { Role } from "@/lib/types";
import { redirect } from "next/navigation";
import { CompanySettingsForm } from "@/components/settings/company-settings-form";

export default async function SettingsPage() {
  const session = await auth();
  
  // Check if user is admin
  if (!session?.user || session.user.role !== Role.ADMIN) {
    redirect("/dashboard/settings/profile");
  }

  return <CompanySettingsForm />;
}
