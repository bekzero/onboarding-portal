import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      realm_access?: unknown;
      resource_access?: unknown;
      groups?: unknown;
      organization_roles?: unknown;
    };
  }
}
