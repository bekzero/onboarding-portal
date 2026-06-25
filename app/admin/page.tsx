import { InternalDashboard } from "@/components/internal-dashboard";
import { requireAdminSession } from "@/lib/admin-auth";
import { onboardingCases, users } from "@/lib/mock-data";

export default async function AdminPage() {
  await requireAdminSession();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 md:px-10">
      <InternalDashboard
        baseCases={onboardingCases}
        salesEngineers={users.filter((user) => user.role === "sales_engineer")}
      />
    </div>
  );
}
