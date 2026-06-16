import Link from "next/link";
import { DemoPlanView } from "@/components/demo-plan-view";
import { PortalShell } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getPlanBundle, plans } from "@/lib/mock-data";

export default async function DemoPlanPage({
  params
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  const bundle = getPlanBundle(planId);

  if (!bundle) {
    return (
      <PortalShell title="Demo Portal" eyebrow="Demo mode">
        <main className="grid gap-6">
          <Card>
            <div className="space-y-4">
              <p className="text-sm uppercase tracking-[0.22em] text-blue-200">Demo plan not found</p>
              <h2 className="text-3xl font-semibold text-white">That demo onboarding plan isn&apos;t available.</h2>
              <p className="max-w-2xl text-sm leading-7 text-slate-300">
                Use one of the valid demo plan IDs below to preview the public mock onboarding experience.
              </p>
              <div className="flex flex-wrap gap-3">
                {plans.map((plan) => (
                  <Link key={plan.id} href={`/demo/${plan.id}`}>
                    <Button variant="outline">{plan.id}</Button>
                  </Link>
                ))}
              </div>
            </div>
          </Card>
        </main>
      </PortalShell>
    );
  }

  return <DemoPlanView bundle={bundle} />;
}
