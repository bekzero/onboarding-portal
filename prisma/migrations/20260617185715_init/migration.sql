-- CreateEnum
CREATE TYPE "AccessMode" AS ENUM ('temporary', 'oidc');

-- CreateTable
CREATE TABLE "msps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "primaryContactEmail" TEXT NOT NULL,
    "assignedSalesEngineer" TEXT NOT NULL DEFAULT 'Ben Eakin',
    "accessMode" "AccessMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "msps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_configs" (
    "id" TEXT NOT NULL,
    "mspId" TEXT NOT NULL,
    "tenantRealm" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "encryptedClientSecret" TEXT NOT NULL,
    "secretIv" TEXT NOT NULL,
    "secretAuthTag" TEXT NOT NULL,
    "issuerUrl" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_plans" (
    "id" TEXT NOT NULL,
    "mspId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT,
    "tenantType" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_tasks" (
    "id" TEXT NOT NULL,
    "onboardingPlanId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "owner" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "dueLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_app_submissions" (
    "id" TEXT NOT NULL,
    "onboardingPlanId" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "loginUrl" TEXT,
    "priority" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saas_app_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "onboardingPlanId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "uploadedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "msps_slug_key" ON "msps"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "oidc_configs_mspId_key" ON "oidc_configs"("mspId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_plans_planId_key" ON "onboarding_plans"("planId");

-- AddForeignKey
ALTER TABLE "oidc_configs" ADD CONSTRAINT "oidc_configs_mspId_fkey" FOREIGN KEY ("mspId") REFERENCES "msps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_plans" ADD CONSTRAINT "onboarding_plans_mspId_fkey" FOREIGN KEY ("mspId") REFERENCES "msps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_onboardingPlanId_fkey" FOREIGN KEY ("onboardingPlanId") REFERENCES "onboarding_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_app_submissions" ADD CONSTRAINT "saas_app_submissions_onboardingPlanId_fkey" FOREIGN KEY ("onboardingPlanId") REFERENCES "onboarding_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_onboardingPlanId_fkey" FOREIGN KEY ("onboardingPlanId") REFERENCES "onboarding_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
