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
  const fallbackBundle = getPlanBundle(planId);
  const persistedBundle = isDatabasePersistenceConfigured()
    ? await getPortalPlanBundle(planId).catch(() => null)
    : null;
  const bundle = persistedBundle ?? fallbackBundle;

  if (!bundle) {
    notFound();
  }

  return <PlanView bundle={bundle} />;
}
