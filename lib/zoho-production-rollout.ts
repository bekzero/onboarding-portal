import type { ZohoJourneyType } from "@prisma/client";

const PRODUCTION_JOURNEYS = new Set<ZohoJourneyType>(["J1", "J3_R1", "J5", "J8"]);

function value(name: string) {
  return process.env[name]?.trim() || "";
}

export function getZohoProductionRolloutConfiguration() {
  const allowedPlanIds = new Set(
    value("ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS")
      .split(",")
      .map((planId) => planId.trim())
      .filter(Boolean)
  );
  const enabledJourneys = new Set(
    value("ZMA_AUTOMATED_JOURNEYS")
      .split(",")
      .map((journey) => journey.trim().toUpperCase())
      .filter((journey): journey is ZohoJourneyType => PRODUCTION_JOURNEYS.has(journey as ZohoJourneyType))
  );
  return { allowedPlanIds, enabledJourneys } as const;
}

export function isZohoProductionRolloutPlanAllowed(planId: string) {
  return getZohoProductionRolloutConfiguration().allowedPlanIds.has(planId.trim());
}

export function isZohoProductionJourneyEnabled(journey: ZohoJourneyType) {
  return getZohoProductionRolloutConfiguration().enabledJourneys.has(journey);
}

export function isZohoProductionRuntime() {
  return process.env.VERCEL_ENV?.trim().toLowerCase() === "production";
}
