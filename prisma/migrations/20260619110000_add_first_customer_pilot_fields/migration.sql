ALTER TABLE "onboarding_plans"
ADD COLUMN "firstCustomerAlias" TEXT,
ADD COLUMN "firstCustomerEstimatedUserCount" INTEGER,
ADD COLUMN "firstCustomerTargetRolloutTiming" TEXT,
ADD COLUMN "firstCustomerAdminContactName" TEXT,
ADD COLUMN "firstCustomerAdminContactEmail" TEXT,
ADD COLUMN "firstCustomerNotes" TEXT;
