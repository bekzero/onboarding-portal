CREATE TYPE "StaffSsoStatus" AS ENUM ('DRAFT', 'VALIDATED', 'ENABLED', 'DISABLED');
CREATE TYPE "StaffApplicationRole" AS ENUM ('ADMIN', 'SALES_ENGINEER', 'VIEWER');

CREATE TABLE "staff_sso_configurations" (
  "id" TEXT NOT NULL DEFAULT 'primary',
  "realmName" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "encryptedClientSecret" TEXT NOT NULL,
  "secretAuthTag" TEXT NOT NULL,
  "secretIv" TEXT NOT NULL,
  "issuerUrl" TEXT NOT NULL,
  "applicationOrigin" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "postLogoutRedirectUri" TEXT NOT NULL,
  "adminRoleClaim" TEXT,
  "salesEngineerRoleClaim" TEXT,
  "viewerRoleClaim" TEXT,
  "approvedGroupClaim" TEXT,
  "status" "StaffSsoStatus" NOT NULL DEFAULT 'DRAFT',
  "discoveryValidatedAt" TIMESTAMP(3),
  "discoveryEvidence" JSONB,
  "authenticationTestedAt" TIMESTAMP(3),
  "authenticationSubject" TEXT,
  "enabledAt" TIMESTAMP(3),
  "enabledBy" TEXT,
  "disabledAt" TIMESTAMP(3),
  "disabledBy" TEXT,
  "bootstrapRetiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_sso_configurations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_identities" (
  "id" TEXT NOT NULL,
  "configurationId" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "email" TEXT,
  "displayName" TEXT,
  "role" "StaffApplicationRole" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "verifiedAt" TIMESTAMP(3),
  "lastAuthenticatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_sso_audits" (
  "id" TEXT NOT NULL,
  "configurationId" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetSubject" TEXT,
  "reason" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_sso_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_identities_issuer_subject_key" ON "staff_identities"("issuer", "subject");
CREATE INDEX "staff_identities_configurationId_role_active_idx" ON "staff_identities"("configurationId", "role", "active");
CREATE INDEX "staff_sso_audits_configurationId_createdAt_idx" ON "staff_sso_audits"("configurationId", "createdAt");
CREATE INDEX "staff_sso_audits_action_createdAt_idx" ON "staff_sso_audits"("action", "createdAt");

ALTER TABLE "staff_identities" ADD CONSTRAINT "staff_identities_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "staff_sso_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_sso_audits" ADD CONSTRAINT "staff_sso_audits_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "staff_sso_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
