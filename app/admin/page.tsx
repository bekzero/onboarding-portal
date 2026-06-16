import { PortalShell } from "@/components/portal-shell";
import { InternalDashboard } from "@/components/internal-dashboard";
import { requireAdminSession } from "@/lib/admin-auth";
import { onboardingCases, users } from "@/lib/mock-data";

export default async function AdminPage() {
  await requireAdminSession();

  return (
    <PortalShell title="Sales Engineer Dashboard" eyebrow="Admin" showActions={false}>
      <InternalDashboard
        baseCases={onboardingCases}
        salesEngineers={users.filter((user) => user.role === "sales_engineer")}
      />
    </PortalShell>
  );
}
