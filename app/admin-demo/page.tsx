import { PortalShell } from "@/components/portal-shell";
import { InternalDashboard } from "@/components/internal-dashboard";
import { Card } from "@/components/ui/card";
import { onboardingCases, users } from "@/lib/mock-data";

export default function AdminDemoPage() {
  return (
    <PortalShell title="Sales Engineer Dashboard" eyebrow="Admin demo">
      <div className="grid gap-6">
        <Card className="border-blue-300/20 bg-blue-400/10 py-3 text-center text-sm text-blue-100">
          Admin demo mode - mock onboarding data
        </Card>
        <InternalDashboard
          baseCases={onboardingCases}
          salesEngineers={users.filter((user) => user.role === "sales_engineer")}
        />
      </div>
    </PortalShell>
  );
}
