import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { users } from "@/lib/mock-data";
import { readPortalOidcSession } from "@/lib/oidc-session";

type SessionUser = {
  name?: string | null;
  email?: string | null;
  roles: string[];
};

function parseRoles(payload: Record<string, unknown>) {
  const roles = new Set<string>();

  const realmRoles = payload.realm_access;
  if (realmRoles && typeof realmRoles === "object" && "roles" in realmRoles) {
    const value = (realmRoles as { roles?: unknown }).roles;
    if (Array.isArray(value)) {
      value.filter((item): item is string => typeof item === "string").forEach((role) => roles.add(role));
    }
  }

  const resourceAccess = payload.resource_access;
  if (resourceAccess && typeof resourceAccess === "object") {
    Object.values(resourceAccess as Record<string, unknown>).forEach((entry) => {
      if (entry && typeof entry === "object" && "roles" in entry) {
        const value = (entry as { roles?: unknown }).roles;
        if (Array.isArray(value)) {
          value.filter((item): item is string => typeof item === "string").forEach((role) => roles.add(role));
        }
      }
    });
  }

  const groups = payload.groups;
  if (Array.isArray(groups)) {
    groups.filter((item): item is string => typeof item === "string").forEach((group) => roles.add(group));
  }

  ["roles", "organization_roles", "org_roles"].forEach((key) => {
    const value = payload[key];
    if (Array.isArray(value)) {
      value.filter((item): item is string => typeof item === "string").forEach((role) => roles.add(role));
    }
  });

  return Array.from(roles);
}

function mockSession(kind: "portal" | "internal"): SessionUser {
  const fallbackUser =
    kind === "internal"
      ? users.find((user) => user.role === "sales_engineer")
      : users.find((user) => user.role === "msp_admin");

  return {
    name: fallbackUser?.name,
    email: fallbackUser?.email,
    roles: kind === "internal" ? ["sales_engineer"] : ["msp_admin"]
  };
}

async function getSessionUser(kind: "portal" | "internal"): Promise<SessionUser | null> {
  if (kind === "portal") {
    const portalSession = await readPortalOidcSession();

    if (portalSession?.authenticated) {
      return {
        name: portalSession.email ?? portalSession.tenantName,
        email: portalSession.email ?? null,
        roles: ["msp_admin"]
      };
    }
  }

  const hasOidcConfig =
    !!process.env.AUTH_SECRET &&
    !!process.env.AUTH_KEYCLOAK_ID &&
    !!process.env.AUTH_KEYCLOAK_SECRET &&
    !!process.env.AUTH_KEYCLOAK_ISSUER;

  if (!hasOidcConfig) {
    return process.env.NODE_ENV === "production" ? null : mockSession(kind);
  }

  const session = await auth();
  if (!session?.user) {
    return null;
  }

  const rawUser = session.user as Record<string, unknown>;
  return {
    name: typeof session.user.name === "string" ? session.user.name : null,
    email: typeof session.user.email === "string" ? session.user.email : null,
    roles: parseRoles(rawUser)
  };
}

export async function requirePortalUser() {
  const sessionUser = await getSessionUser("portal");
  if (!sessionUser) {
    redirect("/start?error=session_required");
  }

  return sessionUser;
}

export async function requireInternalUser() {
  const sessionUser = await getSessionUser("internal");
  if (!sessionUser) {
    redirect("/");
  }

  const isInternal = sessionUser.roles.some((role) =>
    ["admin", "sales_engineer", "/admin", "/sales_engineer"].includes(role)
  );

  if (!isInternal) {
    redirect("/");
  }

  return sessionUser;
}
