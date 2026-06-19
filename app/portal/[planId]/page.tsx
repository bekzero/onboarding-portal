import { redirect } from "next/navigation";
import { PlanView } from "@/components/plan-view";
import { requirePortalUser } from "@/lib/auth";
import { getPortalPlanBundle, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export default async function PortalPlanPage({
  params
}: {
  params: Promise<{ planId: string }>;
}) {
  await requirePortalUser();

  const { planId } = await params;

  if (!isDatabasePersistenceConfigured()) {
    redirect("/start?error=portal_unavailable");
  }

  const bundle = await getPortalPlanBundle(planId).catch(() => null);

  if (!bundle) {
    redirect("/start?error=plan_not_found");
  }

  return <PlanView bundle={bundle} />;
}
