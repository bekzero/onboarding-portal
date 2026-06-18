import { notFound } from "next/navigation";
import { PlanView } from "@/components/plan-view";
import { requirePortalUser } from "@/lib/auth";
import { getPlanBundle } from "@/lib/mock-data";
import { getPortalPlanBundle, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export default async function PortalPlanPage({
  params
}: {
  params: Promise<{ planId: string }>;
}) {
  await requirePortalUser();

  const { planId } = await params;
  const bundle = isDatabasePersistenceConfigured()
    ? await getPortalPlanBundle(planId).catch(() => null)
    : getPlanBundle(planId);

  if (!bundle) {
    notFound();
  }

  return <PlanView bundle={bundle} />;
}
