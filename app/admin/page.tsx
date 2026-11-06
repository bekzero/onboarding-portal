import { AdminSessionUnavailable } from "@/components/admin-session-unavailable";
import { InternalDashboard } from "@/components/internal-dashboard";
import { getCurrentStaffIdentity, hasAnyAdminAccess } from "@/lib/admin-auth";
import { onboardingCases, users } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await hasAnyAdminAccess())) {
    return <AdminSessionUnavailable />;
  }
  const staffIdentity = await getCurrentStaffIdentity();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 md:px-6 md:py-6">
      <InternalDashboard
        baseCases={onboardingCases}
        salesEngineers={users.filter((user) => user.role === "sales_engineer")}
        staffIdentity={staffIdentity ? { email: staffIdentity.email, name: staffIdentity.name, role: staffIdentity.role } : null}
      />
    </div>
  );
}
