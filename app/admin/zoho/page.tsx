import { AdminSessionUnavailable } from "@/components/admin-session-unavailable";
import { ZohoAutomationCenter } from "@/components/zoho-automation-center";
import { getCurrentStaffIdentity, hasAnyAdminAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function ZohoAutomationPage({
  searchParams
}: {
  searchParams: Promise<{ plan?: string; tab?: string }>;
}) {
  if (!(await hasAnyAdminAccess())) return <AdminSessionUnavailable />;
  const query = await searchParams;
  const staffIdentity = await getCurrentStaffIdentity();
  return <ZohoAutomationCenter initialPlanFilter={query.plan ?? ""} initialTab={query.tab ?? "overview"} staffIdentity={staffIdentity ? { email: staffIdentity.email, name: staffIdentity.name, role: staffIdentity.role } : null} />;
}
