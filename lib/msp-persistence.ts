import "server-only";
import type { AccessMode, OidcConfig, Prisma } from "@prisma/client";
import { createTaskCompletedAdminNotification } from "@/lib/admin-notifications";
import { decryptStoredOidcClientSecret, encryptOidcClientSecret } from "@/lib/oidc-secret-crypto";
import { getPlanBundle, type FirstCustomerPilot, type PlanBundle, type SaaSApp as MockSaaSApp, type Task as MockTask, type TaskStatus } from "@/lib/mock-data";
import { prisma } from "@/lib/prisma";
import { buildKzeroIssuerForTenant, normalizeTenantName } from "@/lib/tenant-routing";

const DEFAULT_SALES_ENGINEER = "Ben Eakin";
const onboardingPlanSelection = {
  customerName: true,
  firstCustomerAdminContactEmail: true,
  firstCustomerAdminContactName: true,
  firstCustomerAlias: true,
  firstCustomerEstimatedUserCount: true,
  firstCustomerNotes: true,
  firstCustomerTargetRolloutTiming: true,
  currentStage: true,
  lastActivityAt: true,
  onboardingTasks: {
    orderBy: {
      order: "asc" as const
    },
    select: {
      description: true,
      dueLabel: true,
      order: true,
      owner: true,
      status: true,
      title: true
    }
  },
  saasAppSubmissions: {
    orderBy: {
      createdAt: "asc" as const
    },
    select: {
      appName: true,
      id: true,
      loginUrl: true,
      notes: true,
      priority: true,
      status: true
    }
  },
  planId: true,
  progress: true,
  status: true,
  submittedAppCount: true,
  tenantType: true,
  updatedAt: true
} satisfies Prisma.OnboardingPlanSelect;

const mspWithDashboardSelection = {
  accessMode: true,
  assignedSalesEngineer: true,
  createdAt: true,
  enrollmentDate: true,
  id: true,
  isGmmPartner: true,
  name: true,
  primaryContactEmail: true,
  slug: true,
  updatedAt: true,
  oidcConfig: {
    select: {
      clientId: true,
      tenantRealm: true
    }
  },
  onboardingPlans: {
    orderBy: {
      createdAt: "asc" as const
    },
    select: onboardingPlanSelection,
    take: 1
  }
} satisfies Prisma.MspSelect;

function formatDateLabel() {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function formatDateLabelFromValue(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
}

function parseLastActivityInput(value?: string) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return undefined;
  }

  const parsedValue = new Date(trimmedValue);

  if (Number.isNaN(parsedValue.getTime())) {
    return undefined;
  }

  return parsedValue;
}

function parseCalendarDateInput(value?: string) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return undefined;
  }

  const isoMatch = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) {
    const parsedValue = new Date(trimmedValue);
    return Number.isNaN(parsedValue.getTime()) ? undefined : parsedValue;
  }

  const [, year, month, day] = isoMatch;
  return new Date(`${year}-${month}-${day}T12:00:00Z`);
}

function getTemplateBundle(planId: string) {
  return getPlanBundle(planId);
}

function getOrderedTemplateTasks(bundle: PlanBundle) {
  return bundle.plan.taskIds
    .map((taskId) => bundle.tasks.find((task) => task.id === taskId))
    .filter((task): task is MockTask => Boolean(task));
}

function deriveInsertedTaskStatus(
  title: string,
  existingTasks: Array<{
    status: string;
    title: string;
  }>,
  templateStatus: TaskStatus
) {
  if (title !== "Import Your Passwords") {
    return templateStatus;
  }

  const nextExistingTask = existingTasks.find((task) => task.status !== "complete");

  if (!nextExistingTask) {
    return "complete" as const;
  }

  if (nextExistingTask.title === "Book Setup Call with Your KZero Sales Engineer") {
    return "not_started" as const;
  }

  if (nextExistingTask.title === "Add Backup Administrators") {
    return "waiting_on_msp" as const;
  }

  return "complete" as const;
}

function getTaskStatusForOwner(owner: string): TaskStatus {
  return owner === "kzero_se" ? "waiting_on_kzero" : "waiting_on_msp";
}

function mapPersistedTaskStatus(status?: string): TaskStatus {
  if (status === "complete" || status === "in_progress" || status === "waiting_on_kzero" || status === "waiting_on_msp") {
    return status;
  }

  return "not_started";
}

function buildPortalTaskRecords(
  bundle: PlanBundle,
  persistedTasks: Array<{
    description: string | null;
    dueLabel: string | null;
    order: number;
    owner: string | null;
    status: string;
    title: string;
  }>
) {
  const orderedTemplateTasks = getOrderedTemplateTasks(bundle);

  return orderedTemplateTasks.map((task, index) => {
    const persistedTask = persistedTasks.find((item) => item.title === task.title) ??
      persistedTasks.find((item) => item.order === index);

    return {
      description: persistedTask?.description ?? task.description,
      dueLabel: persistedTask?.dueLabel ?? task.dueLabel,
      order: index,
      owner: persistedTask?.owner ?? task.owner,
      status: mapPersistedTaskStatus(persistedTask?.status ?? task.status),
      title: persistedTask?.title ?? task.title
    } satisfies PortalTaskRecord;
  });
}

function getPhaseTitleForTask(bundle: PlanBundle, task: MockTask | undefined) {
  if (!task) {
    return "Completed";
  }

  return bundle.phases.find((phase) => phase.id === task.phaseId)?.title ?? "Kickoff";
}

function getPlanStatusForTask(task: PortalTaskRecord | undefined) {
  if (!task) {
    return "complete";
  }

  if (task.status === "waiting_on_kzero") {
    return "waiting_on_kzero";
  }

  if (task.status === "waiting_on_msp") {
    return "waiting_on_msp";
  }

  if (task.owner === "kzero_se") {
    return "waiting_on_kzero";
  }

  return "waiting_on_msp";
}

function getPlanMetrics(bundle: PlanBundle, persistedTasks: PortalTaskRecord[]) {
  const orderedTemplateTasks = getOrderedTemplateTasks(bundle);
  const completedCount = persistedTasks.filter((task) => task.status === "complete").length;
  const nextTaskIndex = persistedTasks.findIndex((task) => task.status !== "complete");
  const progress = orderedTemplateTasks.length === 0 ? 0 : Math.round((completedCount / orderedTemplateTasks.length) * 100);
  const nextPersistedTask = nextTaskIndex === -1 ? undefined : persistedTasks[nextTaskIndex];
  const nextTemplateTask = nextTaskIndex === -1 ? undefined : orderedTemplateTasks[nextTaskIndex];
  const currentStage = progress >= 100 ? "Completed" : getPhaseTitleForTask(bundle, nextTemplateTask);
  const status = progress >= 100 ? "complete" : getPlanStatusForTask(nextPersistedTask);

  return {
    completedCount,
    currentStage,
    nextTaskIndex,
    progress,
    status
  };
}

function buildBundleFromPersistedState(
  bundle: PlanBundle,
  persistedTasks: PortalTaskRecord[],
  persistedApps: MockSaaSApp[],
  persistedPlan?: {
    customerName?: string | null;
    currentStage: string | null;
    firstCustomerPilot?: FirstCustomerPilot | null;
    mspName?: string | null;
    organizationName?: string | null;
    progress: number;
    title?: string | null;
  }
) {
  const orderedTemplateTasks = getOrderedTemplateTasks(bundle);
  const metrics = getPlanMetrics(bundle, persistedTasks);

  const tasks = orderedTemplateTasks.map((task, index) => {
    const persistedTask = persistedTasks[index];
    const status = persistedTask?.status ?? task.status;
    const waitingOn =
      status === "waiting_on_kzero"
        ? ("kzero" as const)
        : status === "waiting_on_msp"
          ? ("msp" as const)
          : undefined;

    return {
      ...task,
      description: persistedTask?.description ?? task.description,
      dueLabel: persistedTask?.dueLabel ?? task.dueLabel,
      owner: (persistedTask?.owner as MockTask["owner"] | undefined) ?? task.owner,
      status,
      waitingOn
    };
  });

  const nextTask = tasks.find((task) => task.status !== "complete") ?? tasks[tasks.length - 1];

  if (!nextTask) {
    return null;
  }

  return {
    ...bundle,
    apps: persistedApps,
    attachments: [],
    firstCustomerPilot: persistedPlan?.firstCustomerPilot ?? bundle.firstCustomerPilot ?? null,
    organization: {
      ...bundle.organization,
      name: persistedPlan?.organizationName?.trim() || bundle.organization.name
    },
    nextTask,
    plan: {
      ...bundle.plan,
      customerName: persistedPlan?.customerName?.trim() || bundle.plan.customerName,
      mspName: persistedPlan?.mspName?.trim() || bundle.plan.mspName,
      nextTaskId: nextTask.id,
      progress: persistedPlan?.progress ?? metrics.progress,
      title: persistedPlan?.title?.trim() || bundle.plan.title
    },
    tasks
  } satisfies PlanBundle;
}

function getPortalPlanDisplayTitle(
  mspName: string,
  tenantType: PlanBundle["plan"]["tenantType"],
  customerName?: string | null
) {
  const trimmedMspName = mspName.trim();
  const trimmedCustomerName = customerName?.trim();

  if (tenantType === "customer") {
    return trimmedCustomerName ? `${trimmedCustomerName} Customer Onboarding` : "Customer Onboarding";
  }

  if (!trimmedMspName) {
    return "NFR Tenant Onboarding";
  }

  return `${trimmedMspName} NFR Tenant Onboarding`;
}

function mapPersistedAppsToBundleApps(planBundle: PlanBundle, statuses: Array<{
  appName: string;
  id: string;
  loginUrl: string | null;
  notes: string | null;
  priority: string | null;
  status: string;
}>) {
  return statuses.map((submission) => ({
    id: submission.id,
    loginUrl: submission.loginUrl ?? undefined,
    name: submission.appName,
    notes: submission.notes ?? undefined,
    organizationId: planBundle.organization.id,
    priority: submission.priority ?? undefined,
    status:
      submission.status === "approved_for_sso" || submission.status === "under_review"
        ? submission.status
        : "submitted"
  })) satisfies MockSaaSApp[];
}

function mapFirstCustomerPilotFromPlan(plan: {
  firstCustomerAdminContactEmail: string | null;
  firstCustomerAdminContactName: string | null;
  firstCustomerAlias: string | null;
  firstCustomerEstimatedUserCount: number | null;
  firstCustomerNotes: string | null;
  firstCustomerTargetRolloutTiming: string | null;
}): FirstCustomerPilot | null {
  if (!plan.firstCustomerAlias || !plan.firstCustomerTargetRolloutTiming) {
    return null;
  }

  return {
    adminContactEmail: plan.firstCustomerAdminContactEmail ?? undefined,
    adminContactName: plan.firstCustomerAdminContactName ?? undefined,
    customerAlias: plan.firstCustomerAlias,
    estimatedUserCount: plan.firstCustomerEstimatedUserCount ?? undefined,
    notes: plan.firstCustomerNotes ?? undefined,
    targetRolloutTiming: plan.firstCustomerTargetRolloutTiming
  };
}

function hasSavedFirstCustomerPilotDetails(pilot: FirstCustomerPilot | null | undefined) {
  return Boolean(pilot?.customerAlias?.trim() && pilot?.targetRolloutTiming?.trim());
}

export type PublicMspRecord = {
  accessMode: AccessMode;
  assignedSalesEngineer: string;
  customerName?: string;
  createdAt: Date;
  enrollmentDate: Date;
  id: string;
  isGmmPartner: boolean;
  name: string;
  planId?: string;
  planType?: PlanBundle["plan"]["tenantType"];
  primaryContactEmail: string;
  slug: string;
  tenantRealm?: string;
  updatedAt: Date;
};

export type PortalLookupMatch = {
  accessMode: AccessMode;
  customerName?: string;
  displayName: string;
  id: string;
  mspName: string;
  planId: string;
  planType: PlanBundle["plan"]["tenantType"];
  slug: string;
  tenantRealm?: string;
};

export type PortalLookupResult =
  | {
      match: PortalLookupMatch;
      status: "found";
    }
  | {
      matches: PortalLookupMatch[];
      status: "ambiguous";
    }
  | {
      status: "not_found";
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
  activeTaskOwner?: string;
  activeTaskStatus?: string;
  activeTaskTitle?: string;
  assignedSalesEngineer: string;
  customerName?: string;
  currentStage: string;
  enrollmentDate: string;
  enrollmentDateRaw: string;
  id: string;
  isGmmPartner: boolean;
  lastActivity: string;
  lastActivityRaw: string;
  mspName: string;
  mspSlug: string;
  oidcClientId?: string;
  oidcConfigured: boolean;
  planId: string;
  primaryContactEmail: string;
  progress: number;
  status: string;
  submittedApps: Array<{
    id: string;
    loginUrl?: string;
    name: string;
    notes?: string;
    priority?: string;
    status: "submitted" | "under_review" | "approved_for_sso";
  }>;
  submittedSaasAppCount: number;
  tenantRealm?: string;
  planType: PlanBundle["plan"]["tenantType"];
  firstCustomerPilot?: FirstCustomerPilot | null;
};

type PortalTaskRecord = {
  description: string;
  dueLabel?: string;
  order: number;
  owner: string;
  status: TaskStatus;
  title: string;
};

type CreateMspInput = {
  accessMode: AccessMode;
  assignedSalesEngineer?: string;
  customerName?: string;
  enrollmentDate?: string;
  isGmmPartner?: boolean;
  name: string;
  planType?: PlanBundle["plan"]["tenantType"];
  primaryContactEmail: string;
  slug?: string;
};

type UpdateMspInput = {
  accessMode?: AccessMode;
  assignedSalesEngineer?: string;
  customerName?: string;
  currentStage?: string;
  enrollmentDate?: string;
  isGmmPartner?: boolean;
  lastActivity?: string;
  name?: string;
  primaryContactEmail?: string;
  progress?: number;
  planType?: PlanBundle["plan"]["tenantType"];
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

type SubmitFirstCustomerPilotInput = {
  adminContactEmail?: string;
  adminContactName?: string;
  customerAlias: string;
  estimatedUserCount?: number;
  notes?: string;
  targetRolloutTiming: string;
};

type SubmitPortalSaasAppInput = {
  loginUrl?: string;
  name: string;
  notes?: string;
  priority?: string;
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
    select: typeof mspWithDashboardSelection;
  }>
): PublicMspRecord {
  return {
    accessMode: msp.accessMode,
    assignedSalesEngineer: msp.assignedSalesEngineer,
    customerName: msp.onboardingPlans[0]?.customerName ?? undefined,
    createdAt: msp.createdAt,
    enrollmentDate: msp.enrollmentDate,
    id: msp.id,
    isGmmPartner: msp.isGmmPartner,
    name: msp.name,
    planId: msp.onboardingPlans[0]?.planId,
    planType: msp.onboardingPlans[0]?.tenantType as PlanBundle["plan"]["tenantType"] | undefined,
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
    select: typeof mspWithDashboardSelection;
  }>
): AdminDashboardCase {
  const plan = msp.onboardingPlans[0];
  const planId = plan?.planId ?? `${msp.slug}-nfr`;
  const templateBundle = plan ? getTemplateBundle(planId) : null;
  const portalTasks =
    plan && templateBundle ? buildPortalTaskRecords(templateBundle, plan.onboardingTasks) : [];
  const derivedMetrics =
    plan && templateBundle
      ? getPlanMetrics(templateBundle, portalTasks)
      : null;
  const activeTask =
    derivedMetrics && derivedMetrics.nextTaskIndex >= 0
      ? portalTasks[derivedMetrics.nextTaskIndex]
      : null;
  const firstCustomerPilot = plan ? mapFirstCustomerPilotFromPlan(plan) : null;
  const planType = plan?.tenantType === "customer" ? "customer" : "nfr";

  return {
    firstCustomerPilot,
    accessMode: msp.accessMode,
    activeTaskOwner: activeTask?.owner,
    activeTaskStatus: activeTask?.status,
    activeTaskTitle: activeTask?.title,
    assignedSalesEngineer: DEFAULT_SALES_ENGINEER,
    customerName: plan?.customerName ?? undefined,
    currentStage: derivedMetrics?.currentStage ?? plan?.currentStage ?? "Kickoff",
    enrollmentDate: formatDateLabelFromValue(msp.enrollmentDate ?? msp.createdAt),
    enrollmentDateRaw: (msp.enrollmentDate ?? msp.createdAt).toISOString(),
    id: msp.id,
    isGmmPartner: msp.isGmmPartner,
    lastActivity: formatDateLabelFromValue(plan?.lastActivityAt ?? plan?.updatedAt ?? msp.updatedAt),
    lastActivityRaw: (plan?.lastActivityAt ?? plan?.updatedAt ?? msp.updatedAt).toISOString(),
    mspName: msp.name,
    mspSlug: msp.slug,
    oidcClientId: msp.oidcConfig?.clientId,
    oidcConfigured: Boolean(msp.oidcConfig),
    planId,
    primaryContactEmail: msp.primaryContactEmail,
    progress: derivedMetrics?.progress ?? plan?.progress ?? 0,
    planType,
    status: derivedMetrics?.status ?? plan?.status ?? "waiting_on_msp",
    submittedApps: (plan?.saasAppSubmissions ?? []).map((submission) => ({
      id: submission.id,
      loginUrl: submission.loginUrl ?? undefined,
      name: submission.appName,
      notes: submission.notes ?? undefined,
      priority: submission.priority ?? undefined,
      status:
        submission.status === "approved_for_sso" || submission.status === "under_review"
          ? submission.status
          : "submitted"
    })),
    submittedSaasAppCount: plan?.submittedAppCount ?? 0,
    tenantRealm: msp.oidcConfig?.tenantRealm
  };
}

async function ensurePortalTasksSeeded(onboardingPlanId: string, planId: string) {
  const existingTasks = await prisma.onboardingTask.findMany({
    where: { onboardingPlanId },
    orderBy: {
      order: "asc"
    }
  });

  const templateBundle = getTemplateBundle(planId);
  if (!templateBundle) {
    return [];
  }

  const orderedTemplateTasks = getOrderedTemplateTasks(templateBundle);

  if (orderedTemplateTasks.length === 0) {
    return [];
  }

  if (existingTasks.length > 0) {
    const updateOperations = [];
    const createOperations = [];
    const unmatchedExistingTaskIds = new Set(existingTasks.map((task) => task.id));

    for (const [index, templateTask] of orderedTemplateTasks.entries()) {
      const existingTask = existingTasks.find((task) => unmatchedExistingTaskIds.has(task.id) && task.title === templateTask.title) ??
        existingTasks.find((task) => unmatchedExistingTaskIds.has(task.id) && task.order === index);

      if (existingTask) {
        unmatchedExistingTaskIds.delete(existingTask.id);
        updateOperations.push(
          prisma.onboardingTask.update({
            where: { id: existingTask.id },
            data: {
              description: templateTask.description,
              dueLabel: templateTask.dueLabel,
              order: index,
              owner: templateTask.owner,
              title: templateTask.title
            }
          })
        );
        continue;
      }

      createOperations.push(
        prisma.onboardingTask.create({
          data: {
            description: templateTask.description,
            dueLabel: templateTask.dueLabel,
            onboardingPlanId,
            order: index,
            owner: templateTask.owner,
            status: deriveInsertedTaskStatus(templateTask.title, existingTasks, templateTask.status),
            title: templateTask.title
          }
        })
      );
    }

    if (updateOperations.length > 0 || createOperations.length > 0) {
      await prisma.$transaction([...updateOperations, ...createOperations]);
    }

    return prisma.onboardingTask.findMany({
      where: { onboardingPlanId },
      orderBy: {
        order: "asc"
      }
    });
  }

  await prisma.onboardingTask.createMany({
    data: orderedTemplateTasks.map((task, index) => ({
      description: task.description,
      dueLabel: task.dueLabel,
      onboardingPlanId,
      order: index,
      owner: task.owner,
      status: task.status,
      title: task.title
    }))
  });

  return prisma.onboardingTask.findMany({
    where: { onboardingPlanId },
    orderBy: {
      order: "asc"
    }
  });
}

export async function createMsp(input: CreateMspInput) {
  ensureDatabaseConfigured();

  const planType = input.planType === "customer" ? "customer" : "nfr";
  const customerName = input.customerName?.trim() || null;
  const slug =
    input.slug?.trim() ||
    (planType === "customer" && customerName
      ? `${normalizeTenantName(input.name)}-${normalizeTenantName(customerName)}`
      : normalizeTenantName(input.name));
  if (!slug) {
    throw new Error("MSP slug is required.");
  }
  if (planType === "customer" && !customerName) {
    throw new Error("Customer name is required for a Customer Plan.");
  }

  const planId = `${slug}-${planType}`;
  const templateBundle = getTemplateBundle(planId);
  const templateTasks = templateBundle ? getOrderedTemplateTasks(templateBundle) : [];

  const msp = await prisma.msp.create({
    data: {
      accessMode: input.accessMode,
      assignedSalesEngineer: input.assignedSalesEngineer?.trim() || DEFAULT_SALES_ENGINEER,
      enrollmentDate: parseCalendarDateInput(input.enrollmentDate) ?? new Date(),
      isGmmPartner: input.isGmmPartner ?? false,
      name: input.name.trim(),
      onboardingPlans: {
        create: {
          customerName,
          currentStage: "Kickoff",
          lastActivityAt: new Date(),
          onboardingTasks: templateTasks.length > 0
            ? {
                create: templateTasks.map((task, index) => ({
                  description: task.description,
                  dueLabel: task.dueLabel,
                  order: index,
                  owner: task.owner,
                  status: task.status,
                  title: task.title
                }))
              }
            : undefined,
          planId,
          progress: 0,
          status: "waiting_on_msp",
          submittedAppCount: 0,
          tenantType: planType,
          title: getPortalPlanDisplayTitle(input.name, planType, customerName)
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
        select: onboardingPlanSelection,
        take: 1
      }
    }
  });

  return toAdminDashboardCase(msp);
}

export async function updateMsp(mspId: string, input: UpdateMspInput) {
  ensureDatabaseConfigured();

  const trimmedName = input.name?.trim();
  const nextPlanType = input.planType === "customer" ? "customer" : input.planType === "nfr" ? "nfr" : undefined;
  const nextCustomerName = input.customerName?.trim();

  const msp = await prisma.msp.update({
    where: { id: mspId },
    data: {
      accessMode: input.accessMode,
      assignedSalesEngineer: input.assignedSalesEngineer?.trim(),
      enrollmentDate: input.enrollmentDate !== undefined ? parseCalendarDateInput(input.enrollmentDate) : undefined,
      isGmmPartner: input.isGmmPartner,
      name: trimmedName,
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
            customerName: nextCustomerName || undefined,
            currentStage: input.currentStage?.trim(),
            lastActivityAt: parseLastActivityInput(input.lastActivity),
            progress: input.progress,
            status: input.status?.trim(),
            submittedAppCount: input.submittedSaasAppCount,
            tenantType: nextPlanType,
            title:
              trimmedName || nextPlanType || nextCustomerName
                ? getPortalPlanDisplayTitle(trimmedName ?? "", nextPlanType ?? "nfr", nextCustomerName)
                : undefined
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
        select: onboardingPlanSelection,
        take: 1
      }
    }
  });

  return toAdminDashboardCase(msp);
}

export async function deleteMsp(mspId: string) {
  ensureDatabaseConfigured();

  await prisma.msp.delete({
    where: { id: mspId }
  });
}

export async function getPortalPlanBundle(planId: string) {
  ensureDatabaseConfigured();

  const templateBundle = getTemplateBundle(planId);
  if (!templateBundle) {
    return null;
  }

  const onboardingPlan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    include: {
      msp: {
        select: {
          name: true
        }
      },
      saasAppSubmissions: {
        orderBy: {
          createdAt: "asc"
        }
      },
      onboardingTasks: {
        orderBy: {
          order: "asc"
        }
      }
    }
  });

  if (!onboardingPlan) {
    return null;
  }

  const persistedTasks = await ensurePortalTasksSeeded(onboardingPlan.id, planId);
  const persistedApps = mapPersistedAppsToBundleApps(templateBundle, onboardingPlan.saasAppSubmissions);
  const firstCustomerPilot = mapFirstCustomerPilotFromPlan(onboardingPlan);

  return buildBundleFromPersistedState(
    templateBundle,
    buildPortalTaskRecords(templateBundle, persistedTasks),
    persistedApps,
    {
      currentStage: onboardingPlan.currentStage,
      customerName: onboardingPlan.customerName,
      firstCustomerPilot,
      mspName: onboardingPlan.msp?.name,
      organizationName: onboardingPlan.msp?.name,
      progress: onboardingPlan.progress,
      title: getPortalPlanDisplayTitle(
        onboardingPlan.msp?.name ?? onboardingPlan.title,
        onboardingPlan.tenantType as PlanBundle["plan"]["tenantType"],
        onboardingPlan.customerName
      )
    }
  );
}

export async function submitPortalSaasApp(planId: string, input: SubmitPortalSaasAppInput) {
  ensureDatabaseConfigured();

  const appName = input.name.trim();
  if (!appName) {
    throw new Error("App name is required.");
  }

  const onboardingPlan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    include: {
      msp: {
        select: {
          name: true
        }
      },
      saasAppSubmissions: {
        orderBy: {
          createdAt: "asc"
        }
      },
      onboardingTasks: {
        orderBy: {
          order: "asc"
        }
      }
    }
  });

  if (!onboardingPlan) {
    return null;
  }

  const templateBundle = getTemplateBundle(planId);
  if (!templateBundle) {
    return null;
  }

  await prisma.saaSAppSubmission.create({
    data: {
      appName,
      loginUrl: input.loginUrl?.trim() || null,
      notes: input.notes?.trim() || null,
      onboardingPlanId: onboardingPlan.id,
      priority: input.priority?.trim() || null
    }
  });

  const refreshedPlan = await prisma.onboardingPlan.update({
    where: { id: onboardingPlan.id },
    data: {
      lastActivityAt: new Date(),
      submittedAppCount: onboardingPlan.saasAppSubmissions.length + 1
    },
    include: {
      msp: {
        select: {
          name: true
        }
      },
      saasAppSubmissions: {
        orderBy: {
          createdAt: "asc"
        }
      },
      onboardingTasks: {
        orderBy: {
          order: "asc"
        }
      }
    }
  });

  return buildBundleFromPersistedState(
    templateBundle,
    buildPortalTaskRecords(templateBundle, refreshedPlan.onboardingTasks),
    mapPersistedAppsToBundleApps(templateBundle, refreshedPlan.saasAppSubmissions),
    {
      currentStage: refreshedPlan.currentStage,
      customerName: refreshedPlan.customerName,
      firstCustomerPilot: mapFirstCustomerPilotFromPlan(refreshedPlan),
      mspName: refreshedPlan.msp?.name,
      organizationName: refreshedPlan.msp?.name,
      progress: refreshedPlan.progress,
      title: getPortalPlanDisplayTitle(
        refreshedPlan.msp?.name ?? refreshedPlan.title,
        refreshedPlan.tenantType as PlanBundle["plan"]["tenantType"],
        refreshedPlan.customerName
      )
    }
  );
}

async function advanceOnboardingPlanTask({
  planId,
  requestedTaskId,
  notifyTaskCompletion = false,
  requireOwner
}: {
  notifyTaskCompletion?: boolean;
  planId: string;
  requestedTaskId?: string;
  requireOwner?: "kzero_se";
}) {
  ensureDatabaseConfigured();

  const templateBundle = getTemplateBundle(planId);
  if (!templateBundle) {
    return null;
  }

  const onboardingPlan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    include: {
      msp: {
        select: {
          name: true
        }
      },
      saasAppSubmissions: {
        orderBy: {
          createdAt: "asc"
        }
      },
      onboardingTasks: {
        orderBy: {
          order: "asc"
        }
      }
    }
  });

  if (!onboardingPlan) {
    return null;
  }

  const orderedTemplateTasks = getOrderedTemplateTasks(templateBundle);
  const persistedTasks = await ensurePortalTasksSeeded(onboardingPlan.id, planId);
  const portalTasks = buildPortalTaskRecords(templateBundle, persistedTasks);
  const activeTaskIndex = portalTasks.findIndex((task) => task.status !== "complete");
  const persistedApps = mapPersistedAppsToBundleApps(templateBundle, onboardingPlan.saasAppSubmissions);
  const firstCustomerPilot = mapFirstCustomerPilotFromPlan(onboardingPlan);

  if (activeTaskIndex === -1) {
    return buildBundleFromPersistedState(templateBundle, portalTasks, persistedApps, {
      currentStage: onboardingPlan.currentStage,
      firstCustomerPilot,
      organizationName: onboardingPlan.msp?.name,
      progress: onboardingPlan.progress,
      title: getPortalPlanDisplayTitle(onboardingPlan.msp?.name ?? onboardingPlan.title, onboardingPlan.tenantType as PlanBundle["plan"]["tenantType"])
    });
  }

  const activeTask = portalTasks[activeTaskIndex];
  const activeTemplateTask = orderedTemplateTasks[activeTaskIndex];

  if (!activeTask || !activeTemplateTask) {
    return buildBundleFromPersistedState(templateBundle, portalTasks, persistedApps, {
      currentStage: onboardingPlan.currentStage,
      firstCustomerPilot,
      organizationName: onboardingPlan.msp?.name,
      progress: onboardingPlan.progress,
      title: getPortalPlanDisplayTitle(onboardingPlan.msp?.name ?? onboardingPlan.title, onboardingPlan.tenantType as PlanBundle["plan"]["tenantType"])
    });
  }

  if (requestedTaskId && activeTemplateTask.id !== requestedTaskId) {
    return buildBundleFromPersistedState(templateBundle, portalTasks, persistedApps, {
      currentStage: onboardingPlan.currentStage,
      firstCustomerPilot,
      organizationName: onboardingPlan.msp?.name,
      progress: onboardingPlan.progress,
      title: getPortalPlanDisplayTitle(onboardingPlan.msp?.name ?? onboardingPlan.title, onboardingPlan.tenantType as PlanBundle["plan"]["tenantType"])
    });
  }

  if (requireOwner && activeTask.owner !== requireOwner) {
    throw new Error("The current active onboarding step is not owned by KZero.");
  }

  if (activeTemplateTask.title === "Select First Customer Pilot" && !hasSavedFirstCustomerPilotDetails(firstCustomerPilot)) {
    throw new Error("Save the first customer pilot details before completing this step.");
  }

  const nextPortalTasks = portalTasks.map((task, index) => {
    if (index < activeTaskIndex + 1) {
      return { ...task, status: "complete" as const };
    }

    if (index === activeTaskIndex + 1) {
      return {
        ...task,
        status: getTaskStatusForOwner(task.owner)
      };
    }

    return {
      ...task,
      status: "not_started" as const
    };
  });

  const metrics = getPlanMetrics(templateBundle, nextPortalTasks);
  const lastActivityAt = new Date();

  await prisma.$transaction([
    ...persistedTasks.map((task, index) =>
      prisma.onboardingTask.update({
        where: { id: task.id },
        data: {
          status: nextPortalTasks[index]?.status ?? task.status
        }
      })
    ),
    prisma.onboardingPlan.update({
      where: { id: onboardingPlan.id },
      data: {
        currentStage: metrics.currentStage,
        lastActivityAt,
        progress: metrics.progress,
        status: metrics.status
      }
    })
  ]);

  if (notifyTaskCompletion) {
    try {
      await createTaskCompletedAdminNotification({
        mspId: onboardingPlan.mspId,
        mspName:
          onboardingPlan.tenantType === "customer" && onboardingPlan.customerName
            ? `${onboardingPlan.msp?.name ?? "MSP"} - ${onboardingPlan.customerName}`
            : onboardingPlan.msp?.name ?? onboardingPlan.title ?? "MSP",
        planId,
        stage: metrics.currentStage,
        taskId: activeTemplateTask.id,
        taskTitle: activeTask.title
      });
    } catch (error) {
      console.error("Could not create admin task completion notification.", error);
    }
  }

  return buildBundleFromPersistedState(templateBundle, nextPortalTasks, persistedApps, {
    currentStage: metrics.currentStage,
    customerName: onboardingPlan.customerName,
    firstCustomerPilot,
    mspName: onboardingPlan.msp?.name,
    organizationName: onboardingPlan.msp?.name,
    progress: metrics.progress,
    title: getPortalPlanDisplayTitle(
      onboardingPlan.msp?.name ?? onboardingPlan.title,
      onboardingPlan.tenantType as PlanBundle["plan"]["tenantType"],
      onboardingPlan.customerName
    )
  });
}

export async function completePortalTask(planId: string, templateTaskId: string) {
  return advanceOnboardingPlanTask({
    notifyTaskCompletion: true,
    planId,
    requestedTaskId: templateTaskId
  });
}

export async function completeCurrentKzeroTaskForMsp(mspId: string) {
  ensureDatabaseConfigured();

  const onboardingPlan = await prisma.onboardingPlan.findFirst({
    where: { mspId },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      planId: true
    }
  });

  if (!onboardingPlan) {
    return null;
  }

  return advanceOnboardingPlanTask({
    planId: onboardingPlan.planId,
    requireOwner: "kzero_se"
  });
}

export async function rollbackPortalTaskForMsp(mspId: string, templateTaskId: string) {
  ensureDatabaseConfigured();

  const onboardingPlan = await prisma.onboardingPlan.findFirst({
    where: { mspId },
    include: {
      msp: {
        select: {
          name: true
        }
      },
      saasAppSubmissions: {
        orderBy: {
          createdAt: "asc"
        }
      },
      onboardingTasks: {
        orderBy: {
          order: "asc"
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  if (!onboardingPlan) {
    return null;
  }

  const templateBundle = getTemplateBundle(onboardingPlan.planId);
  if (!templateBundle) {
    return null;
  }

  const orderedTemplateTasks = getOrderedTemplateTasks(templateBundle);
  const targetTaskIndex = orderedTemplateTasks.findIndex((task) => task.id === templateTaskId);

  if (targetTaskIndex === -1) {
    throw new Error("The selected onboarding step could not be found.");
  }

  const persistedTasks = await ensurePortalTasksSeeded(onboardingPlan.id, onboardingPlan.planId);
  const persistedApps = mapPersistedAppsToBundleApps(templateBundle, onboardingPlan.saasAppSubmissions);
  const firstCustomerPilot = mapFirstCustomerPilotFromPlan(onboardingPlan);

  const nextPortalTasks = orderedTemplateTasks.map((task, index) => {
    if (index < targetTaskIndex) {
      return {
        description: task.description,
        dueLabel: task.dueLabel,
        order: index,
        owner: task.owner,
        status: "complete" as const,
        title: task.title
      } satisfies PortalTaskRecord;
    }

    if (index === targetTaskIndex) {
      return {
        description: task.description,
        dueLabel: task.dueLabel,
        order: index,
        owner: task.owner,
        status: getTaskStatusForOwner(task.owner),
        title: task.title
      } satisfies PortalTaskRecord;
    }

    return {
      description: task.description,
      dueLabel: task.dueLabel,
      order: index,
      owner: task.owner,
      status: "not_started" as const,
      title: task.title
    } satisfies PortalTaskRecord;
  });

  const metrics = getPlanMetrics(templateBundle, nextPortalTasks);
  const lastActivityAt = new Date();

  await prisma.$transaction([
    ...persistedTasks.map((task, index) =>
      prisma.onboardingTask.update({
        where: { id: task.id },
        data: {
          description: nextPortalTasks[index]?.description ?? task.description,
          dueLabel: nextPortalTasks[index]?.dueLabel ?? task.dueLabel,
          order: nextPortalTasks[index]?.order ?? task.order,
          owner: nextPortalTasks[index]?.owner ?? task.owner,
          status: nextPortalTasks[index]?.status ?? task.status,
          title: nextPortalTasks[index]?.title ?? task.title
        }
      })
    ),
    prisma.onboardingPlan.update({
      where: { id: onboardingPlan.id },
      data: {
        currentStage: metrics.currentStage,
        lastActivityAt,
        progress: metrics.progress,
        status: metrics.status
      }
    })
  ]);

  return buildBundleFromPersistedState(templateBundle, nextPortalTasks, persistedApps, {
    currentStage: metrics.currentStage,
    customerName: onboardingPlan.customerName,
    firstCustomerPilot,
    mspName: onboardingPlan.msp?.name,
    organizationName: onboardingPlan.msp?.name,
    progress: metrics.progress,
    title: getPortalPlanDisplayTitle(
      onboardingPlan.msp?.name ?? onboardingPlan.title,
      onboardingPlan.tenantType as PlanBundle["plan"]["tenantType"],
      onboardingPlan.customerName
    )
  });
}

export async function submitFirstCustomerPilot(planId: string, input: SubmitFirstCustomerPilotInput) {
  ensureDatabaseConfigured();

  const customerAlias = input.customerAlias.trim();
  const targetRolloutTiming = input.targetRolloutTiming.trim();

  if (!customerAlias || !targetRolloutTiming) {
    throw new Error("Customer alias and target rollout timing are required.");
  }

  const onboardingPlan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    include: {
      msp: {
        select: {
          name: true
        }
      },
      saasAppSubmissions: {
        orderBy: {
          createdAt: "asc"
        }
      },
      onboardingTasks: {
        orderBy: {
          order: "asc"
        }
      }
    }
  });

  if (!onboardingPlan) {
    return null;
  }

  const templateBundle = getTemplateBundle(planId);
  if (!templateBundle) {
    return null;
  }

  const updatedPlan = await prisma.onboardingPlan.update({
    where: { id: onboardingPlan.id },
    data: {
      firstCustomerAdminContactEmail: input.adminContactEmail?.trim() || null,
      firstCustomerAdminContactName: input.adminContactName?.trim() || null,
      firstCustomerAlias: customerAlias,
      firstCustomerEstimatedUserCount:
        input.estimatedUserCount && input.estimatedUserCount > 0 ? input.estimatedUserCount : null,
      firstCustomerNotes: input.notes?.trim() || null,
      firstCustomerTargetRolloutTiming: targetRolloutTiming,
      lastActivityAt: new Date()
    },
    include: {
      msp: {
        select: {
          name: true
        }
      },
      saasAppSubmissions: {
        orderBy: {
          createdAt: "asc"
        }
      },
      onboardingTasks: {
        orderBy: {
          order: "asc"
        }
      }
    }
  });

  return buildBundleFromPersistedState(
    templateBundle,
    buildPortalTaskRecords(templateBundle, updatedPlan.onboardingTasks),
    mapPersistedAppsToBundleApps(templateBundle, updatedPlan.saasAppSubmissions),
    {
      currentStage: updatedPlan.currentStage,
      customerName: updatedPlan.customerName,
      firstCustomerPilot: mapFirstCustomerPilotFromPlan(updatedPlan),
      mspName: updatedPlan.msp?.name,
      organizationName: updatedPlan.msp?.name,
      progress: updatedPlan.progress,
      title: getPortalPlanDisplayTitle(
        updatedPlan.msp?.name ?? updatedPlan.title,
        updatedPlan.tenantType as PlanBundle["plan"]["tenantType"],
        updatedPlan.customerName
      )
    }
  );
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

  const result = await findPortalLookupMatch(lookupValue);
  if (result.status !== "found") {
    return null;
  }

  const msp = await prisma.msp.findUnique({
    where: { id: result.match.id },
    select: mspWithDashboardSelection
  });

  return msp ? toPublicMspRecord(msp) : null;
}

export async function getAdminDashboardCases() {
  ensureDatabaseConfigured();

  const msps = await prisma.msp.findMany({
    select: mspWithDashboardSelection,
    orderBy: {
      createdAt: "desc"
    }
  });

  return msps.map(toAdminDashboardCase);
}

export async function getAdminPortalAccessByMspId(mspId: string, requestedPlanId?: string | null) {
  ensureDatabaseConfigured();

  const msp = await prisma.msp.findUnique({
    where: { id: mspId },
    select: {
      id: true,
      name: true,
      onboardingPlans: {
        orderBy: {
          createdAt: "asc"
        },
        select: {
          planId: true
        }
      },
      oidcConfig: {
        select: {
          tenantRealm: true
        }
      }
    }
  });

  if (!msp) {
    return null;
  }

  const resolvedPlanId =
    requestedPlanId?.trim() && msp.onboardingPlans.some((plan) => plan.planId === requestedPlanId.trim())
      ? requestedPlanId.trim()
      : msp.onboardingPlans[0]?.planId ?? null;

  return {
    id: msp.id,
    planId: resolvedPlanId,
    tenantName: msp.oidcConfig?.tenantRealm ?? msp.name
  };
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

  const result = await findPortalLookupMatch(lookupValue);
  if (result.status !== "found") {
    return null;
  }

  return prisma.msp.findUnique({
    where: { id: result.match.id },
    select: mspWithDashboardSelection
  });
}

function buildPortalLookupCandidates(msp: Prisma.MspGetPayload<{ select: typeof mspWithDashboardSelection }>) {
  const plan = msp.onboardingPlans[0];
  const planType = plan?.tenantType === "customer" ? "customer" : "nfr";
  const customerName = plan?.customerName?.trim();
  const combinedCustomerLabel = customerName ? `${msp.name} - ${customerName}` : "";

  if (planType === "customer") {
    return [
      { priority: 0, value: customerName },
      { priority: 1, value: combinedCustomerLabel },
      { priority: 2, value: msp.oidcConfig?.tenantRealm },
      { priority: 3, value: plan?.planId },
      { priority: 4, value: msp.slug }
    ];
  }

  return [
    { priority: 2, value: msp.oidcConfig?.tenantRealm },
    { priority: 3, value: plan?.planId },
    { priority: 4, value: msp.slug },
    { priority: 5, value: msp.name }
  ];
}

function toPortalLookupMatch(msp: Prisma.MspGetPayload<{ select: typeof mspWithDashboardSelection }>): PortalLookupMatch {
  const plan = msp.onboardingPlans[0];
  const planType = plan?.tenantType === "customer" ? "customer" : "nfr";
  const customerName = plan?.customerName?.trim() || undefined;

  return {
    accessMode: msp.accessMode,
    customerName,
    displayName: planType === "customer" ? customerName ?? msp.name : msp.name,
    id: msp.id,
    mspName: msp.name,
    planId: plan?.planId ?? `${msp.slug}-${planType}`,
    planType,
    slug: msp.slug,
    tenantRealm: msp.oidcConfig?.tenantRealm
  };
}

export async function findPortalLookupMatch(lookupValue: string): Promise<PortalLookupResult> {
  ensureDatabaseConfigured();

  const normalizedLookupValue = normalizeTenantName(lookupValue);
  if (!normalizedLookupValue) {
    return { status: "not_found" };
  }

  const msps = await prisma.msp.findMany({
    select: mspWithDashboardSelection
  });

  const rankedMatches: Array<{ match: PortalLookupMatch; priority: number }> = msps
    .map((msp) => {
      const matchPriority = buildPortalLookupCandidates(msp)
        .filter((candidate) => normalizeTenantName(candidate.value) === normalizedLookupValue)
        .sort((left, right) => left.priority - right.priority)[0];

      if (!matchPriority) {
        return null;
      }

      return {
        match: toPortalLookupMatch(msp),
        priority: matchPriority.priority
      };
    })
    .filter((item) => item !== null);

  if (rankedMatches.length === 0) {
    return { status: "not_found" };
  }

  const bestPriority = Math.min(...rankedMatches.map((item) => item.priority));
  const bestMatches = rankedMatches
    .filter((item) => item.priority === bestPriority)
    .map((item) => item.match);

  if (bestMatches.length > 1) {
    return {
      matches: bestMatches.sort((left, right) => left.displayName.localeCompare(right.displayName)),
      status: "ambiguous"
    };
  }

  return {
    match: bestMatches[0],
    status: "found"
  };
}

export async function getMspWithOidcByPlanIdServer(planId: string) {
  ensureDatabaseConfigured();

  const plan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    include: {
      msp: {
        select: mspWithDashboardSelection
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
