import "server-only";
import type { AccessMode, OidcConfig, Prisma } from "@prisma/client";
import { decryptStoredOidcClientSecret, encryptOidcClientSecret } from "@/lib/oidc-secret-crypto";
import { prisma } from "@/lib/prisma";
import { buildKzeroIssuerForTenant, normalizeTenantName } from "@/lib/tenant-routing";

const DEFAULT_SALES_ENGINEER = "Ben Eakin";

function formatDateLabel() {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

export type PublicMspRecord = {
  accessMode: AccessMode;
  assignedSalesEngineer: string;
  createdAt: Date;
  id: string;
  name: string;
  primaryContactEmail: string;
  slug: string;
  tenantRealm?: string;
  updatedAt: Date;
};

export type PublicOidcConfig = {
  clientId: string;
  configuredAt: Date;
  id: string;
  issuerUrl: string;
  mspId: string;
  redirectUri: string;
  tenantRealm: string;
};

export type AdminDashboardCase = {
  accessMode: AccessMode;
  assignedSalesEngineer: string;
  currentStage: string;
  id: string;
  lastActivity: string;
  mspName: string;
  mspSlug: string;
  oidcClientId?: string;
  oidcConfigured: boolean;
  planId: string;
  primaryContactEmail: string;
  progress: number;
  status: string;
  submittedSaasAppCount: number;
  tenantRealm?: string;
};

type CreateMspInput = {
  accessMode: AccessMode;
  assignedSalesEngineer?: string;
  name: string;
  primaryContactEmail: string;
  slug?: string;
};

type UpdateMspInput = {
  accessMode?: AccessMode;
  assignedSalesEngineer?: string;
  currentStage?: string;
  lastActivity?: string;
  name?: string;
  primaryContactEmail?: string;
  progress?: number;
  slug?: string;
  status?: string;
  submittedSaasAppCount?: number;
  tenantRealm?: string;
};

type ConfigureOidcInput = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenantRealm: string;
};

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function ensureDatabaseConfigured() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is required for server-side MSP persistence.");
  }
}

function toPublicMspRecord(
  msp: Prisma.MspGetPayload<{
    include: { oidcConfig: true };
  }>
): PublicMspRecord {
  return {
    accessMode: msp.accessMode,
    assignedSalesEngineer: msp.assignedSalesEngineer,
    createdAt: msp.createdAt,
    id: msp.id,
    name: msp.name,
    primaryContactEmail: msp.primaryContactEmail,
    slug: msp.slug,
    tenantRealm: msp.oidcConfig?.tenantRealm,
    updatedAt: msp.updatedAt
  };
}

function toPublicOidcConfig(oidcConfig: OidcConfig): PublicOidcConfig {
  return {
    clientId: oidcConfig.clientId,
    configuredAt: oidcConfig.configuredAt,
    id: oidcConfig.id,
    issuerUrl: oidcConfig.issuerUrl,
    mspId: oidcConfig.mspId,
    redirectUri: oidcConfig.redirectUri,
    tenantRealm: oidcConfig.tenantRealm
  };
}

function toAdminDashboardCase(
  msp: Prisma.MspGetPayload<{
    include: {
      oidcConfig: true;
      onboardingPlans: {
        orderBy: { createdAt: "asc" };
        take: 1;
      };
    };
  }>
): AdminDashboardCase {
  const plan = msp.onboardingPlans[0];
  const planId = plan?.planId ?? `${msp.slug}-nfr`;

  return {
    accessMode: msp.accessMode,
    assignedSalesEngineer: DEFAULT_SALES_ENGINEER,
    currentStage: plan?.currentStage ?? "Kickoff",
    id: msp.id,
    lastActivity: plan?.lastActivity ?? formatDateLabel(),
    mspName: msp.name,
    mspSlug: msp.slug,
    oidcClientId: msp.oidcConfig?.clientId,
    oidcConfigured: Boolean(msp.oidcConfig),
    planId,
    primaryContactEmail: msp.primaryContactEmail,
    progress: plan?.progress ?? 0,
    status: plan?.status ?? "waiting_on_msp",
    submittedSaasAppCount: plan?.submittedSaasAppCount ?? 0,
    tenantRealm: msp.oidcConfig?.tenantRealm
  };
}

export async function createMsp(input: CreateMspInput) {
  ensureDatabaseConfigured();

  const slug = input.slug?.trim() || normalizeTenantName(input.name);
  if (!slug) {
    throw new Error("MSP slug is required.");
  }

  const msp = await prisma.msp.create({
    data: {
      accessMode: input.accessMode,
      assignedSalesEngineer: input.assignedSalesEngineer?.trim() || DEFAULT_SALES_ENGINEER,
      name: input.name.trim(),
      onboardingPlans: {
        create: {
          currentStage: "Kickoff",
          lastActivity: formatDateLabel(),
          planId: `${slug}-nfr`,
          progress: 0,
          status: "waiting_on_msp",
          submittedSaasAppCount: 0,
          tenantType: "nfr",
          title: `${input.name.trim()} onboarding`
        }
      },
      primaryContactEmail: input.primaryContactEmail.trim(),
      slug
    },
    include: {
      oidcConfig: true,
      onboardingPlans: {
        orderBy: {
          createdAt: "asc"
        },
        take: 1
      }
    }
  });

  return toAdminDashboardCase(msp);
}

export async function updateMsp(mspId: string, input: UpdateMspInput) {
  ensureDatabaseConfigured();

  const msp = await prisma.msp.update({
    where: { id: mspId },
    data: {
      accessMode: input.accessMode,
      assignedSalesEngineer: input.assignedSalesEngineer?.trim(),
      name: input.name?.trim(),
      oidcConfig:
        input.tenantRealm !== undefined
          ? {
              update: {
                issuerUrl: buildKzeroIssuerForTenant(input.tenantRealm.trim()) ?? undefined,
                tenantRealm: input.tenantRealm.trim()
              }
            }
          : undefined,
      onboardingPlans: {
        updateMany: {
          where: {},
          data: {
            currentStage: input.currentStage?.trim(),
            lastActivity: input.lastActivity?.trim(),
            progress: input.progress,
            status: input.status?.trim(),
            submittedSaasAppCount: input.submittedSaasAppCount
          }
        }
      },
      primaryContactEmail: input.primaryContactEmail?.trim(),
      slug: input.slug?.trim() || undefined
    },
    include: {
      oidcConfig: true,
      onboardingPlans: {
        orderBy: {
          createdAt: "asc"
        },
        take: 1
      }
    }
  });

  return toAdminDashboardCase(msp);
}

export async function configureOidcForMsp(mspId: string, input: ConfigureOidcInput) {
  ensureDatabaseConfigured();

  const tenantRealm = input.tenantRealm.trim();
  if (!tenantRealm) {
    throw new Error("KZero tenant realm is required.");
  }

  const issuerUrl = buildKzeroIssuerForTenant(tenantRealm);
  if (!issuerUrl) {
    throw new Error("Could not build issuer URL for the supplied KZero tenant realm.");
  }

  const existingOidcConfig = await prisma.oidcConfig.findUnique({
    where: { mspId }
  });
  const encryptedSecret =
    input.clientSecret.trim() || !existingOidcConfig
      ? encryptOidcClientSecret(input.clientSecret)
      : {
          encryptedClientSecret: existingOidcConfig.encryptedClientSecret,
          secretAuthTag: existingOidcConfig.secretAuthTag,
          secretIv: existingOidcConfig.secretIv
        };

  const oidcConfig = await prisma.oidcConfig.upsert({
    where: { mspId },
    create: {
      ...encryptedSecret,
      clientId: input.clientId.trim(),
      issuerUrl,
      mspId,
      redirectUri: input.redirectUri.trim(),
      tenantRealm
    },
    update: {
      ...encryptedSecret,
      clientId: input.clientId.trim(),
      configuredAt: new Date(),
      issuerUrl,
      redirectUri: input.redirectUri.trim(),
      tenantRealm
    }
  });

  await prisma.msp.update({
    where: { id: mspId },
    data: {
      accessMode: "oidc"
    }
  });

  return toPublicOidcConfig(oidcConfig);
}

export async function getMspByLookup(lookupValue: string) {
  ensureDatabaseConfigured();

  const normalizedLookupValue = normalizeTenantName(lookupValue);
  if (!normalizedLookupValue) {
    return null;
  }

  const msps = await prisma.msp.findMany({
    include: {
      oidcConfig: true,
      onboardingPlans: {
        orderBy: {
          createdAt: "asc"
        },
        take: 1
      }
    }
  });

  const match = msps.find((msp) => {
    const candidates = [msp.slug, msp.name, msp.oidcConfig?.tenantRealm];
    return candidates.some((candidate) => normalizeTenantName(candidate) === normalizedLookupValue);
  });

  return match ? toPublicMspRecord(match) : null;
}

export async function getAdminDashboardCases() {
  ensureDatabaseConfigured();

  const msps = await prisma.msp.findMany({
    include: {
      oidcConfig: true,
      onboardingPlans: {
        orderBy: {
          createdAt: "asc"
        },
        take: 1
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return msps.map(toAdminDashboardCase);
}

export async function getOidcConfigForMsp(mspId: string) {
  ensureDatabaseConfigured();

  const oidcConfig = await prisma.oidcConfig.findUnique({
    where: { mspId }
  });

  return oidcConfig ? toPublicOidcConfig(oidcConfig) : null;
}

export async function getOidcConfigForMspServer(mspId: string) {
  ensureDatabaseConfigured();

  return prisma.oidcConfig.findUnique({
    where: { mspId }
  });
}

export async function getMspWithOidcByLookupServer(lookupValue: string) {
  ensureDatabaseConfigured();

  const normalizedLookupValue = normalizeTenantName(lookupValue);
  if (!normalizedLookupValue) {
    return null;
  }

  const msps = await prisma.msp.findMany({
    include: {
      oidcConfig: true,
      onboardingPlans: {
        orderBy: {
          createdAt: "asc"
        },
        take: 1
      }
    }
  });

  return (
    msps.find((msp) => {
      const candidates = [msp.slug, msp.name, msp.oidcConfig?.tenantRealm];
      return candidates.some((candidate) => normalizeTenantName(candidate) === normalizedLookupValue);
    }) ?? null
  );
}

export async function getMspWithOidcByPlanIdServer(planId: string) {
  ensureDatabaseConfigured();

  const plan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    include: {
      msp: {
        include: {
          oidcConfig: true,
          onboardingPlans: {
            orderBy: {
              createdAt: "asc"
            },
            take: 1
          }
        }
      }
    }
  });

  return plan?.msp ?? null;
}

export async function decryptOidcClientSecret(mspId: string) {
  ensureDatabaseConfigured();

  const oidcConfig = await prisma.oidcConfig.findUnique({
    where: { mspId }
  });

  if (!oidcConfig) {
    return null;
  }

  return decryptStoredOidcClientSecret({
    encryptedClientSecret: oidcConfig.encryptedClientSecret,
    secretAuthTag: oidcConfig.secretAuthTag,
    secretIv: oidcConfig.secretIv
  });
}

export function isDatabasePersistenceConfigured() {
  return hasDatabaseUrl();
}
