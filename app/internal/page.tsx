import { PortalShell } from "@/components/portal-shell";
import { InternalDashboard } from "@/components/internal-dashboard";
import { requireInternalUser } from "@/lib/auth";
import { onboardingCases, users } from "@/lib/mock-data";

export default async function InternalPage() {
  await requireInternalUser();

  return (
    <PortalShell title="Sales Engineer Dashboard" eyebrow="Internal">
      <InternalDashboard
        baseCases={onboardingCases}
        salesEngineers={users.filter((user) => user.role === "sales_engineer")}
      />
    </PortalShell>
  );
}
