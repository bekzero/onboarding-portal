import Link from "next/link";
import { PlanView } from "@/components/plan-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePortalUserOrAdmin } from "@/lib/auth";
import { getPortalPlanBundle, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export default async function PortalPlanPage({
  params
}: {
  params: Promise<{ planId: string }>;
}) {
  await requirePortalUserOrAdmin();

  const { planId } = await params;

  if (!isDatabasePersistenceConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-10">
        <Card className="w-full border-white/10 bg-[#101a2d] p-6">
          <h1 className="text-2xl font-semibold text-white">This onboarding case could not be opened.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            The onboarding portal is temporarily unavailable because server-side persistence is not configured.
          </p>
          <div className="mt-5">
            <Link href="/admin">
              <Button variant="outline">Back to Admin</Button>
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  const bundle = await getPortalPlanBundle(planId).catch(() => null);

  if (!bundle) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-10">
        <Card className="w-full border-white/10 bg-[#101a2d] p-6">
          <h1 className="text-2xl font-semibold text-white">This onboarding case could not be opened.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            The requested onboarding case could not be found or is no longer available.
          </p>
          <div className="mt-5">
            <Link href="/admin">
              <Button variant="outline">Back to Admin</Button>
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  return <PlanView bundle={bundle} />;
}
