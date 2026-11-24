CREATE TABLE "zoho_legacy_automation_plans" (
  "onboardingPlanId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "captureMigration" TEXT NOT NULL,
  CONSTRAINT "zoho_legacy_automation_plans_pkey" PRIMARY KEY ("onboardingPlanId")
);

CREATE UNIQUE INDEX "zoho_legacy_automation_plans_planId_key"
  ON "zoho_legacy_automation_plans"("planId");

ALTER TABLE "zoho_legacy_automation_plans"
  ADD CONSTRAINT "zoho_legacy_automation_plans_onboardingPlanId_fkey"
  FOREIGN KEY ("onboardingPlanId") REFERENCES "onboarding_plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "zoho_legacy_automation_plans" (
  "onboardingPlanId", "planId", "capturedAt", "captureMigration"
)
SELECT "id", "planId", CURRENT_TIMESTAMP, '20261124190000_add_immutable_zoho_legacy_cohort'
FROM "onboarding_plans";

CREATE FUNCTION "reject_zoho_legacy_cohort_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The Zoho legacy automation cohort is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zoho_legacy_cohort_reject_insert"
BEFORE INSERT ON "zoho_legacy_automation_plans"
FOR EACH ROW EXECUTE FUNCTION "reject_zoho_legacy_cohort_mutation"();

CREATE TRIGGER "zoho_legacy_cohort_reject_update"
BEFORE UPDATE ON "zoho_legacy_automation_plans"
FOR EACH ROW EXECUTE FUNCTION "reject_zoho_legacy_cohort_mutation"();

CREATE TRIGGER "zoho_legacy_cohort_reject_delete"
BEFORE DELETE ON "zoho_legacy_automation_plans"
FOR EACH ROW EXECUTE FUNCTION "reject_zoho_legacy_cohort_mutation"();
