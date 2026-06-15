import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "keycloak" && profile && typeof profile === "object") {
        token.realm_access = (profile as Record<string, unknown>).realm_access;
        token.resource_access = (profile as Record<string, unknown>).resource_access;
        token.groups = (profile as Record<string, unknown>).groups;
        token.organization_roles = (profile as Record<string, unknown>).organization_roles;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        realm_access: token.realm_access,
        resource_access: token.resource_access,
        groups: token.groups,
        organization_roles: token.organization_roles
      };
      return session;
    }
  }
});
