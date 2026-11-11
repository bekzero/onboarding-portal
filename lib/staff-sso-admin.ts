import "server-only";

import { StaffApplicationRole, StaffSsoStatus } from "@prisma/client";
import { hasAdminSession } from "@/lib/admin-auth";
import { formatStaffAuditActor, getAuthorizedStaffIdentity, isTrustedSameOriginRequest } from "@/lib/staff-auth";
import { hasStaffSsoBootstrapAuthorization } from "@/lib/staff-sso-bootstrap";
import { prisma } from "@/lib/prisma";
import { STAFF_SSO_CONFIGURATION_ID } from "@/lib/staff-sso-config";

export async function getStaffSsoSettingsActor(request: Request) {
  if (!isTrustedSameOriginRequest(request)) return null;
  const individual = await getAuthorizedStaffIdentity("ADMIN");
  if (individual) return formatStaffAuditActor(individual);
  if (!(await hasAdminSession()) || !(await hasStaffSsoBootstrapAuthorization())) return null;
  const config = await prisma.staffSsoConfiguration.findUnique({ where: { id: STAFF_SSO_CONFIGURATION_ID } });
  if (config?.bootstrapRetiredAt && process.env.STAFF_SSO_EMERGENCY_RECOVERY_ENABLED !== "true") return null;
  return "bootstrap:deployment-owner";
}

export async function enableStaffSso(actor: string) {
  return prisma.$transaction(async (tx) => {
    const config = await tx.staffSsoConfiguration.findUniqueOrThrow({ where: { id: STAFF_SSO_CONFIGURATION_ID } });
    const admin = await tx.staffIdentity.findFirst({ where: { configurationId: config.id, role: StaffApplicationRole.ADMIN, active: true, verifiedAt: { not: null } } });
    if (!config.discoveryValidatedAt) throw new Error("Discovery validation must pass before enabling Staff SSO.");
    if (!config.authenticationTestedAt || !admin) throw new Error("An approved ADMIN must complete an actual staff sign-in test before enabling Staff SSO.");
    if (!process.env.ADMIN_ACCESS_CODE?.trim()) throw new Error("The transitional recovery access code must remain configured during rollout.");
    const now = new Date();
    const updated = await tx.staffSsoConfiguration.update({ where: { id: config.id }, data: { status: StaffSsoStatus.ENABLED, enabledAt: now, enabledBy: actor, disabledAt: null, disabledBy: null, bootstrapRetiredAt: config.bootstrapRetiredAt || now } });
    await tx.staffSsoAudit.create({ data: { configurationId: config.id, actor, action: "STAFF_SSO_ENABLED", reason: "Discovery, real authentication, approved administrator, and recovery prerequisites passed." } });
    return updated;
  });
}

export async function disableStaffSso(actor: string) {
  return prisma.$transaction(async (tx) => {
    const config = await tx.staffSsoConfiguration.update({ where: { id: STAFF_SSO_CONFIGURATION_ID }, data: { status: StaffSsoStatus.DISABLED, disabledAt: new Date(), disabledBy: actor } });
    await tx.staffSsoAudit.create({ data: { configurationId: config.id, actor, action: "STAFF_SSO_DISABLED", reason: "Staff SSO disabled; shared recovery access remains low-risk only." } });
    return config;
  });
}
