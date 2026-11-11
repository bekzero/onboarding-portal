import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { StaffSsoStatus } from "@prisma/client";
import { authorizeStaffIdentity, extractTrustedStaffRoles } from "@/lib/staff-authorization-core";
import { prisma } from "@/lib/prisma";
import { findApprovedStaffIdentity, getStaffSsoRuntimeConfiguration } from "@/lib/staff-sso-config";

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const staff = await getStaffSsoRuntimeConfiguration();
  const providers = [];
  if (process.env.AUTH_KEYCLOAK_ID && process.env.AUTH_KEYCLOAK_SECRET && process.env.AUTH_KEYCLOAK_ISSUER) {
    providers.push(Keycloak({ clientId: process.env.AUTH_KEYCLOAK_ID, clientSecret: process.env.AUTH_KEYCLOAK_SECRET, issuer: process.env.AUTH_KEYCLOAK_ISSUER }));
  }
  if (staff.testable) {
    providers.push(Keycloak({ id: "kzero-staff", name: "KZero Staff", clientId: staff.clientId, clientSecret: staff.clientSecret, issuer: staff.issuer, checks: ["pkce", "state", "nonce"], authorization: { params: { scope: "openid email profile" } } }));
  }

  async function databaseDecision(claims: Record<string, unknown>) {
    const subject = typeof claims.sub === "string" ? claims.sub : "";
    const identity = subject ? await findApprovedStaffIdentity(staff.issuer, subject) : null;
    if (!identity?.active) return null;
    const trustedClaims = extractTrustedStaffRoles(claims, staff.clientId);
    if (staff.approvedGroupClaim && !trustedClaims.includes(staff.approvedGroupClaim)) return null;
    const requiredRoleClaim = identity.role === "ADMIN" ? staff.adminRole : identity.role === "SALES_ENGINEER" ? staff.salesEngineerRole : staff.viewerRole;
    if (requiredRoleClaim && !trustedClaims.includes(requiredRoleClaim)) return null;
    return identity;
  }

  async function environmentDecision(claims: Record<string, unknown>) {
    const roles = extractTrustedStaffRoles(claims, staff.clientId);
    const decision = authorizeStaffIdentity({ issuer: staff.issuer, subject: typeof claims.sub === "string" ? claims.sub : "", email: typeof claims.email === "string" ? claims.email : null, emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : null, claims: { roles } }, {
      trustedIssuer: staff.issuer, adminRole: staff.adminRole, salesEngineerRole: staff.salesEngineerRole, viewerRole: staff.viewerRole,
      allowedSubjects: new Set((process.env.STAFF_AUTH_ALLOWED_SUBJECTS || "").split(",").map((item) => item.trim()).filter(Boolean))
    });
    return decision.authorized ? { role: decision.role } : null;
  }

  return {
    trustHost: true,
    secret: process.env.AUTH_SECRET,
    providers,
    session: { strategy: "jwt" as const, maxAge: 60 * 60 * 8, updateAge: 60 * 15 },
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider !== "kzero-staff") return true;
        if (!profile || typeof profile !== "object" || typeof profile.sub !== "string") return false;
        const claims = profile as Record<string, unknown>;
        if (staff.source === "environment") return Boolean(await environmentDecision(claims));
        const identity = await databaseDecision(claims);
        if (!identity) return false;
        const now = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.staffIdentity.update({ where: { id: identity.id }, data: { verifiedAt: identity.verifiedAt || now, lastAuthenticatedAt: now, email: typeof claims.email === "string" ? claims.email : identity.email, displayName: typeof claims.name === "string" ? claims.name : identity.displayName } });
          await tx.staffSsoConfiguration.update({ where: { id: "primary" }, data: { authenticationTestedAt: now, authenticationSubject: identity.subject } });
          await tx.staffSsoAudit.create({ data: { configurationId: "primary", actor: `oidc:${staff.issuer}|sub:${identity.subject}|role:${identity.role}`, action: "AUTHENTICATION_TEST_SUCCEEDED", targetSubject: identity.subject, reason: "OIDC authorization, token validation, and approved identity checks succeeded." } });
        });
        return true;
      },
      async jwt({ token, account, profile }) {
        if (account?.provider === "keycloak" && profile && typeof profile === "object") {
          token.realm_access = (profile as Record<string, unknown>).realm_access; token.resource_access = (profile as Record<string, unknown>).resource_access; token.groups = (profile as Record<string, unknown>).groups; token.organization_roles = (profile as Record<string, unknown>).organization_roles;
        }
        if (account?.provider === "kzero-staff" && profile && typeof profile === "object") {
          const claims = profile as Record<string, unknown>; const decision = staff.source === "database" ? await databaseDecision(claims) : await environmentDecision(claims);
          token.staff_provider = "kzero-staff"; token.staff_issuer = staff.issuer; token.staff_subject = typeof claims.sub === "string" ? claims.sub : token.sub;
          token.staff_email_verified = typeof claims.email_verified === "boolean" ? claims.email_verified : null;
          token.staff_roles = decision ? [decision.role] : []; token.staff_test_only = staff.source === "database" && staff.status !== StaffSsoStatus.ENABLED;
        }
        return token;
      },
      async session({ session, token }) {
        session.user = { ...session.user, realm_access: token.realm_access, resource_access: token.resource_access, groups: token.groups, organization_roles: token.organization_roles, staff_provider: token.staff_provider, staff_issuer: typeof token.staff_issuer === "string" ? token.staff_issuer : undefined, staff_subject: typeof token.staff_subject === "string" ? token.staff_subject : undefined, staff_email_verified: typeof token.staff_email_verified === "boolean" ? token.staff_email_verified : null, staff_roles: Array.isArray(token.staff_roles) ? token.staff_roles.filter((role): role is string => typeof role === "string") : [], staff_test_only: token.staff_test_only === true };
        return session;
      }
    }
  };
});
