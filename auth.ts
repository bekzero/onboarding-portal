import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { authorizeStaffIdentity, extractTrustedStaffRoles } from "@/lib/staff-authorization-core";

const providers = [];

if (
  process.env.AUTH_KEYCLOAK_ID &&
  process.env.AUTH_KEYCLOAK_SECRET &&
  process.env.AUTH_KEYCLOAK_ISSUER
) {
  providers.push(
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER
    })
  );
}

if (
  process.env.STAFF_AUTH_CLIENT_ID &&
  process.env.STAFF_AUTH_CLIENT_SECRET &&
  process.env.STAFF_AUTH_ISSUER
) {
  providers.push(
    Keycloak({
      id: "kzero-staff",
      name: "KZero Staff",
      clientId: process.env.STAFF_AUTH_CLIENT_ID,
      clientSecret: process.env.STAFF_AUTH_CLIENT_SECRET,
      issuer: process.env.STAFF_AUTH_ISSUER,
      checks: ["pkce", "state", "nonce"],
      authorization: { params: { scope: "openid email profile" } }
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers,
  session: { strategy: "jwt", maxAge: 60 * 60 * 8, updateAge: 60 * 15 },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "kzero-staff") return true;
      if (!profile || typeof profile !== "object" || typeof profile.sub !== "string") return false;
      const roles = extractTrustedStaffRoles(profile as Record<string, unknown>, process.env.STAFF_AUTH_CLIENT_ID);
      return authorizeStaffIdentity({
        issuer: process.env.STAFF_AUTH_ISSUER || "",
        subject: profile.sub,
        email: typeof profile.email === "string" ? profile.email : null,
        emailVerified: typeof profile.email_verified === "boolean" ? profile.email_verified : null,
        claims: { roles }
      }, {
        trustedIssuer: process.env.STAFF_AUTH_ISSUER || "",
        adminRole: process.env.STAFF_AUTH_ADMIN_ROLE || "",
        salesEngineerRole: process.env.STAFF_AUTH_SALES_ENGINEER_ROLE || "",
        viewerRole: process.env.STAFF_AUTH_VIEWER_ROLE || "",
        allowedSubjects: new Set((process.env.STAFF_AUTH_ALLOWED_SUBJECTS || "").split(",").map((item) => item.trim()).filter(Boolean))
      }).authorized;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "keycloak" && profile && typeof profile === "object") {
        token.realm_access = (profile as Record<string, unknown>).realm_access;
        token.resource_access = (profile as Record<string, unknown>).resource_access;
        token.groups = (profile as Record<string, unknown>).groups;
        token.organization_roles = (profile as Record<string, unknown>).organization_roles;
      }
      if (account?.provider === "kzero-staff" && profile && typeof profile === "object") {
        const claims = profile as Record<string, unknown>;
        token.staff_provider = "kzero-staff";
        token.staff_issuer = process.env.STAFF_AUTH_ISSUER?.trim().replace(/\/$/, "");
        token.staff_subject = typeof claims.sub === "string" ? claims.sub : token.sub;
        token.staff_email_verified = typeof claims.email_verified === "boolean" ? claims.email_verified : null;
        token.staff_roles = extractTrustedStaffRoles(claims, process.env.STAFF_AUTH_CLIENT_ID);
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        realm_access: token.realm_access,
        resource_access: token.resource_access,
        groups: token.groups,
        organization_roles: token.organization_roles,
        staff_provider: token.staff_provider,
        staff_issuer: typeof token.staff_issuer === "string" ? token.staff_issuer : undefined,
        staff_subject: typeof token.staff_subject === "string" ? token.staff_subject : undefined,
        staff_email_verified: typeof token.staff_email_verified === "boolean" ? token.staff_email_verified : null,
        staff_roles: Array.isArray(token.staff_roles)
          ? token.staff_roles.filter((role): role is string => typeof role === "string")
          : []
      };
      return session;
    }
  }
});
