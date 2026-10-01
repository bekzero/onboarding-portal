import { AdminSessionUnavailable } from "@/components/admin-session-unavailable";
import { InternalDashboard } from "@/components/internal-dashboard";
import { hasAdminSession } from "@/lib/admin-auth";
import { onboardingCases, users } from "@/lib/mock-data";

export default async function AdminPage() {
  if (!(await hasAdminSession())) {
    return <AdminSessionUnavailable />;
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 md:px-10">
      <InternalDashboard
        baseCases={onboardingCases}
        salesEngineers={users.filter((user) => user.role === "sales_engineer")}
      />
    </div>
  );
}
