import "server-only";
import type { AccessMode, OidcConfig, Prisma } from "@prisma/client";
import { decryptStoredOidcClientSecret, encryptOidcClientSecret } from "@/lib/oidc-secret-crypto";
import { prisma } from "@/lib/prisma";
import { buildKzeroIssuerForTenant, normalizeTenantName } from "@/lib/tenant-routing";

const DEFAULT_SALES_ENGINEER = "Ben Eakin";

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
  name?: string;
  primaryContactEmail?: string;
  slug?: string;
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
      primaryContactEmail: input.primaryContactEmail.trim(),
      slug
    },
    include: {
      oidcConfig: true
    }
  });

  return toPublicMspRecord(msp);
}

export async function updateMsp(mspId: string, input: UpdateMspInput) {
  ensureDatabaseConfigured();

  const msp = await prisma.msp.update({
    where: { id: mspId },
    data: {
      accessMode: input.accessMode,
      assignedSalesEngineer: input.assignedSalesEngineer?.trim(),
      name: input.name?.trim(),
      primaryContactEmail: input.primaryContactEmail?.trim(),
      slug: input.slug?.trim() || undefined
    },
    include: {
      oidcConfig: true
    }
  });

  return toPublicMspRecord(msp);
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

  const encryptedSecret = encryptOidcClientSecret(input.clientSecret);

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
      oidcConfig: true
    }
  });

  const match = msps.find((msp) => {
    const candidates = [msp.slug, msp.name, msp.oidcConfig?.tenantRealm];
    return candidates.some((candidate) => normalizeTenantName(candidate) === normalizedLookupValue);
  });

  return match ? toPublicMspRecord(match) : null;
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
