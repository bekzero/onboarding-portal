export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "waiting_on_msp"
  | "waiting_on_kzero"
  | "complete";

export type TaskOwner = "msp" | "kzero_se" | "shared";
export type TenantType = "nfr" | "customer";
export type OnboardingCaseStatus = "waiting_on_msp" | "waiting_on_kzero" | "in_progress" | "complete";
export type AccessMode = "temporary" | "oidc";
export type OidcStatus = "not_configured" | "configured";

export type Organization = {
  id: string;
  name: string;
  tenantSlug: string;
  tenantType: TenantType;
  assignedSalesEngineerId: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  organizationId: string;
  role: "msp_admin" | "sales_engineer" | "admin";
};

export type Phase = {
  id: string;
  title: string;
  description: string;
  order: number;
};

export type Task = {
  id: string;
  phaseId: string;
  title: string;
  description: string;
  owner: TaskOwner;
  status: TaskStatus;
  dueLabel?: string;
  waitingOn?: "msp" | "kzero";
  meetingCta?: string;
};

export type SaaSApp = {
  id: string;
  name: string;
  status: "submitted" | "under_review" | "approved_for_sso";
  organizationId: string;
};

export type Attachment = {
  id: string;
  taskId: string;
  name: string;
  kind: "guide" | "plan";
};

export type Comment = {
  id: string;
  taskId: string;
  author: string;
  body: string;
};

export type TaskSubmission = {
  id: string;
  taskId: string;
  submittedBy: string;
  submittedAt: string;
  note: string;
};

export type Plan = {
  id: string;
  organizationId: string;
  title: string;
  tenantType: TenantType;
  phaseIds: string[];
  taskIds: string[];
  nextTaskId: string;
  progress: number;
};

export type PlanBundle = {
  plan: Plan;
  organization: Organization;
  phases: Phase[];
  tasks: Task[];
  nextTask: Task;
  apps: SaaSApp[];
  attachments: Attachment[];
  comments: Comment[];
};

export type OnboardingCase = {
  accessMode: AccessMode;
  actionHref: string;
  assignedSalesEngineer: string;
  currentStage: string;
  lastActivity: string;
  mspName: string;
  mspSlug: string;
  oidcClientId?: string;
  oidcClientSecretConfigured: boolean;
  oidcStatus: OidcStatus;
  onboardingPlanId: string;
  primaryContactEmail: string;
  progress: number;
  status: OnboardingCaseStatus;
  startingPlanType: "nfr" | "customer";
  submittedSaasAppCount: number;
  tenantName?: string;
};

type DemoCaseConfig = {
  accessMode: AccessMode;
  currentStage: string;
  lastActivity: string;
  name: string;
  planId: string;
  primaryContactEmail: string;
  progress: number;
  salesEngineerId: string;
  status: OnboardingCaseStatus;
  submittedSaasAppCount: number;
  tenantSlug: string;
  tenantType: TenantType;
  tenantName?: string;
};

export const phases: Phase[] = [
  {
    id: "phase-kickoff",
    title: "Kickoff",
    description: "Launch the onboarding engagement and prepare the tenant.",
    order: 1
  },
  {
    id: "phase-tenant-setup",
    title: "Tenant Setup",
    description: "Prepare admins and users for passwordless rollout.",
    order: 2
  },
  {
    id: "phase-app-review",
    title: "App Review",
    description: "Submit SaaS apps and wait for KZero compatibility planning.",
    order: 3
  },
  {
    id: "phase-sso-rollout",
    title: "SSO Rollout",
    description: "Review the plan and implement the first app set together.",
    order: 4
  },
  {
    id: "phase-customer-rollout",
    title: "Customer Rollout",
    description: "Repeat the motion for the first customer tenant.",
    order: 5
  }
];

const demoCaseConfigs: DemoCaseConfig[] = [
  {
    accessMode: "oidc",
    currentStage: "Kickoff",
    lastActivity: "June 16, 2026",
    name: "ABCMSP",
    planId: "abcmsp-nfr",
    primaryContactEmail: "taylor@abcmsp.com",
    progress: 12,
    salesEngineerId: "user-se-ben",
    status: "waiting_on_msp",
    submittedSaasAppCount: 0,
    tenantSlug: "abcmsp",
    tenantType: "nfr",
    tenantName: "ABCMSP"
  },
  {
    accessMode: "oidc",
    currentStage: "SSO Rollout",
    lastActivity: "June 15, 2026",
    name: "Northwind MSP",
    planId: "northwind-nfr",
    primaryContactEmail: "avery@northwindmsp.com",
    progress: 82,
    salesEngineerId: "user-se-ben",
    status: "in_progress",
    submittedSaasAppCount: 2,
    tenantSlug: "northwind",
    tenantType: "nfr",
    tenantName: "northwind"
  },
  {
    accessMode: "oidc",
    currentStage: "App Review",
    lastActivity: "June 14, 2026",
    name: "PeakPoint MSP",
    planId: "peakpoint-nfr",
    primaryContactEmail: "casey@peakpointmsp.com",
    progress: 58,
    salesEngineerId: "user-se-ben",
    status: "waiting_on_kzero",
    submittedSaasAppCount: 4,
    tenantSlug: "peakpoint",
    tenantType: "nfr",
    tenantName: "peakpoint"
  },
  {
    accessMode: "temporary",
    currentStage: "Customer Rollout",
    lastActivity: "June 13, 2026",
    name: "Skyline MSP",
    planId: "skyline-nfr",
    primaryContactEmail: "jamie@skylinemsp.com",
    progress: 100,
    salesEngineerId: "user-se-ben",
    status: "complete",
    submittedSaasAppCount: 5,
    tenantSlug: "skyline",
    tenantType: "nfr"
  }
];

export const organizations: Organization[] = [
  ...demoCaseConfigs.map((config) => ({
    id: `org-${config.tenantSlug}`,
    name: config.name,
    tenantSlug: config.tenantSlug,
    tenantType: config.tenantType,
    assignedSalesEngineerId: config.salesEngineerId
  })),
  {
    id: "org-northwind-customer",
    name: "Northwind Dental",
    tenantSlug: "northwind-dental",
    tenantType: "customer",
    assignedSalesEngineerId: "user-se-ben"
  }
];

export const users: User[] = [
  {
    id: "user-msp-abcmsp",
    name: "Taylor Brooks",
    email: "taylor@abcmsp.com",
    organizationId: "org-abcmsp",
    role: "msp_admin"
  },
  {
    id: "user-msp-northwind",
    name: "Avery Cole",
    email: "avery@northwindmsp.com",
    organizationId: "org-northwind",
    role: "msp_admin"
  },
  {
    id: "user-msp-peakpoint",
    name: "Casey Doyle",
    email: "casey@peakpointmsp.com",
    organizationId: "org-peakpoint",
    role: "msp_admin"
  },
  {
    id: "user-msp-skyline",
    name: "Jamie Patel",
    email: "jamie@skylinemsp.com",
    organizationId: "org-skyline",
    role: "msp_admin"
  },
  {
    id: "user-se-ben",
    name: "Ben Eakin",
    email: "ben@kzero.com",
    organizationId: "org-abcmsp",
    role: "sales_engineer"
  },
  {
    id: "user-admin",
    name: "Jordan Park",
    email: "jordan@kzero.com",
    organizationId: "org-abcmsp",
    role: "admin"
  }
];

const baseTasks: Omit<Task, "id">[] = [
  {
    phaseId: "phase-kickoff",
    title: "Book setup call with KZero Sales Engineer",
    description: "Schedule the kickoff with your KZero Sales Engineer to deploy and configure the NFR tenant.",
    owner: "msp",
    status: "waiting_on_msp",
    dueLabel: "This week",
    meetingCta: "Open Microsoft Bookings"
  },
  {
    phaseId: "phase-tenant-setup",
    title: "Add backup admins",
    description: "Add techs and a break-glass account to the MSP Dashboard.",
    owner: "msp",
    status: "not_started"
  },
  {
    phaseId: "phase-tenant-setup",
    title: "Add employees and contractors",
    description: "Provision the NFR tenant with company-email users who will pilot KZero.",
    owner: "msp",
    status: "not_started"
  },
  {
    phaseId: "phase-tenant-setup",
    title: "Distribute Vault and extension guidance",
    description: "Share partners.kzero.com Vault docs and confirm Edge, Chrome, or Brave extension rollout.",
    owner: "msp",
    status: "not_started"
  },
  {
    phaseId: "phase-app-review",
    title: "Submit SaaS apps for compatibility review",
    description: "Provide the SaaS app list you want KZero to evaluate for SSO readiness.",
    owner: "msp",
    status: "waiting_on_msp"
  },
  {
    phaseId: "phase-app-review",
    title: "Investigate app compatibility and draft plan",
    description: "KZero Sales Engineer reviews the submitted apps and creates the onboarding implementation plan.",
    owner: "kzero_se",
    status: "waiting_on_kzero",
    waitingOn: "kzero"
  },
  {
    phaseId: "phase-sso-rollout",
    title: "Upload onboarding plan for review",
    description: "Plan placeholder for implementation guidance and sequencing.",
    owner: "kzero_se",
    status: "not_started"
  },
  {
    phaseId: "phase-sso-rollout",
    title: "Book SSO implementation meeting",
    description: "Schedule a working session to implement the first 3-5 apps or until your team is comfortable.",
    owner: "shared",
    status: "not_started",
    meetingCta: "Book implementation session"
  },
  {
    phaseId: "phase-customer-rollout",
    title: "Roll out KZero to the first customer",
    description: "Identify the first customer and confirm rollout readiness.",
    owner: "shared",
    status: "not_started"
  },
  {
    phaseId: "phase-customer-rollout",
    title: "Repeat tenant setup for the customer tenant",
    description: "Reuse this onboarding motion for the customer environment once the MSP NFR is validated.",
    owner: "shared",
    status: "not_started"
  }
];

function createTasks(prefix: string) {
  return baseTasks.map((task, index) => ({
    ...task,
    id: `${prefix}-task-${index + 1}`
  }));
}

const mspTaskSets = demoCaseConfigs.flatMap((config) => createTasks(config.tenantSlug));
const customerTasks = createTasks("northwind-customer");

export const tasks: Task[] = [...mspTaskSets, ...customerTasks];

export const plans: Plan[] = [
  ...demoCaseConfigs.map((config) => ({
    id: config.planId,
    organizationId: `org-${config.tenantSlug}`,
    title: `${config.name} NFR Tenant Onboarding`,
    tenantType: config.tenantType,
    phaseIds: phases.map((phase) => phase.id),
    taskIds: createTasks(config.tenantSlug).map((task) => task.id),
    nextTaskId: `${config.tenantSlug}-task-1`,
    progress: config.progress
  })),
  {
    id: "northwind-customer",
    organizationId: "org-northwind-customer",
    title: "Northwind Dental Customer Rollout",
    tenantType: "customer",
    phaseIds: phases.map((phase) => phase.id),
    taskIds: customerTasks.map((task) => task.id),
    nextTaskId: "northwind-customer-task-1",
    progress: 5
  }
];

export const saasApps: SaaSApp[] = [
  {
    id: "app-abcmsp-1",
    name: "Microsoft 365",
    status: "submitted",
    organizationId: "org-abcmsp"
  },
  {
    id: "app-northwind-1",
    name: "Microsoft 365",
    status: "under_review",
    organizationId: "org-northwind"
  },
  {
    id: "app-northwind-2",
    name: "Salesforce",
    status: "submitted",
    organizationId: "org-northwind"
  },
  {
    id: "app-peakpoint-1",
    name: "Google Workspace",
    status: "under_review",
    organizationId: "org-peakpoint"
  },
  {
    id: "app-peakpoint-2",
    name: "Zendesk",
    status: "under_review",
    organizationId: "org-peakpoint"
  },
  {
    id: "app-peakpoint-3",
    name: "Autotask",
    status: "submitted",
    organizationId: "org-peakpoint"
  },
  {
    id: "app-peakpoint-4",
    name: "QuickBooks Online",
    status: "submitted",
    organizationId: "org-peakpoint"
  },
  {
    id: "app-skyline-1",
    name: "Microsoft 365",
    status: "approved_for_sso",
    organizationId: "org-skyline"
  },
  {
    id: "app-skyline-2",
    name: "Zoom",
    status: "approved_for_sso",
    organizationId: "org-skyline"
  },
  {
    id: "app-skyline-3",
    name: "HubSpot",
    status: "approved_for_sso",
    organizationId: "org-skyline"
  },
  {
    id: "app-skyline-4",
    name: "Slack",
    status: "approved_for_sso",
    organizationId: "org-skyline"
  },
  {
    id: "app-skyline-5",
    name: "DocuSign",
    status: "approved_for_sso",
    organizationId: "org-skyline"
  },
  {
    id: "app-customer-1",
    name: "Dentrix Ascend",
    status: "submitted",
    organizationId: "org-northwind-customer"
  }
];

export const attachments: Attachment[] = [
  ...demoCaseConfigs.flatMap((config) => [
    {
      id: `attachment-${config.tenantSlug}-1`,
      taskId: `${config.tenantSlug}-task-4`,
      name: "Vault adoption guide placeholder",
      kind: "guide" as const
    },
    {
      id: `attachment-${config.tenantSlug}-2`,
      taskId: `${config.tenantSlug}-task-7`,
      name: "Onboarding plan placeholder",
      kind: "plan" as const
    }
  ])
];

export const comments: Comment[] = [
  {
    id: "comment-abcmsp-1",
    taskId: "abcmsp-task-1",
    author: "Ben Eakin",
    body: "Kickoff booking link is ready when ABCMSP is ready to schedule."
  },
  {
    id: "comment-peakpoint-1",
    taskId: "peakpoint-task-6",
    author: "Ben Eakin",
    body: "Compatibility review is waiting on the final app inventory and login URLs."
  },
  {
    id: "comment-skyline-1",
    taskId: "skyline-task-8",
    author: "Ben Eakin",
    body: "Skyline is ready for customer rollout handoff."
  }
];

export const taskSubmissions: TaskSubmission[] = [
  {
    id: "submission-northwind-1",
    taskId: "northwind-task-5",
    submittedBy: "Avery Cole",
    submittedAt: "2026-06-14",
    note: "Initial SaaS list submitted for review."
  },
  {
    id: "submission-peakpoint-1",
    taskId: "peakpoint-task-5",
    submittedBy: "Casey Doyle",
    submittedAt: "2026-06-13",
    note: "Four SaaS applications submitted for compatibility review."
  }
];

export const onboardingCases: OnboardingCase[] = demoCaseConfigs.map((config) => ({
  accessMode: config.accessMode,
  actionHref: `/portal/${config.planId}`,
  assignedSalesEngineer:
    users.find((user) => user.id === config.salesEngineerId)?.name ?? "Unassigned",
  currentStage: config.currentStage,
  lastActivity: config.lastActivity,
  mspName: config.name,
  mspSlug: config.tenantSlug,
  oidcClientId: config.accessMode === "oidc" ? `portal-${config.tenantSlug}` : undefined,
  oidcClientSecretConfigured: config.accessMode === "oidc",
  oidcStatus: config.accessMode === "oidc" ? "configured" : "not_configured",
  onboardingPlanId: config.planId,
  primaryContactEmail: config.primaryContactEmail,
  progress: config.progress,
  status: config.status,
  startingPlanType: config.tenantType,
  submittedSaasAppCount: config.submittedSaasAppCount,
  tenantName: config.tenantName
}));

function titleCaseFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createGeneratedPlanBundle(planId: string) {
  const tenantType: TenantType = planId.endsWith("-customer") ? "customer" : "nfr";
  const tenantSlug = planId.replace(/-(nfr|customer)$/i, "");

  if (!tenantSlug) {
    return null;
  }

  const displayName = titleCaseFromSlug(tenantSlug);
  const organizationName = tenantType === "nfr" ? `${displayName} MSP` : displayName;
  const generatedOrganization: Organization = {
    id: `org-generated-${tenantSlug}`,
    name: organizationName,
    tenantSlug,
    tenantType,
    assignedSalesEngineerId: "user-se-ben"
  };
  const generatedTasks = createTasks(tenantSlug);
  const generatedPlan: Plan = {
    id: planId,
    organizationId: generatedOrganization.id,
    title: tenantType === "nfr" ? `${organizationName} NFR Tenant Onboarding` : `${organizationName} Customer Rollout`,
    tenantType,
    phaseIds: phases.map((phase) => phase.id),
    taskIds: generatedTasks.map((task) => task.id),
    nextTaskId: `${tenantSlug}-task-1`,
    progress: 8
  };

  return {
    plan: generatedPlan,
    organization: generatedOrganization,
    phases,
    tasks: generatedTasks,
    nextTask: generatedTasks[0],
    apps: [],
    attachments: [
      {
        id: `attachment-generated-${tenantSlug}-1`,
        taskId: `${tenantSlug}-task-4`,
        name: "Vault adoption guide placeholder",
        kind: "guide"
      },
      {
        id: `attachment-generated-${tenantSlug}-2`,
        taskId: `${tenantSlug}-task-7`,
        name: "Onboarding plan placeholder",
        kind: "plan"
      }
    ],
    comments: [
      {
        id: `comment-generated-${tenantSlug}-1`,
        taskId: `${tenantSlug}-task-1`,
        author: "Ben Eakin",
        body: "Demo-generated onboarding case. Production data will come from enrolled MSP records."
      }
    ]
  } satisfies PlanBundle;
}

export function getPlan(planId: string) {
  return plans.find((plan) => plan.id === planId);
}

export function getPlanBundle(planId: string) {
  const plan = getPlan(planId);

  if (!plan) {
    return createGeneratedPlanBundle(planId);
  }

  const organization = organizations.find((item) => item.id === plan.organizationId);
  const planPhases = phases.filter((phase) => plan.phaseIds.includes(phase.id));
  const planTasks = tasks.filter((task) => plan.taskIds.includes(task.id));
  const nextTask = planTasks.find((task) => task.id === plan.nextTaskId);
  const apps = saasApps.filter((app) => app.organizationId === plan.organizationId);
  const planAttachments = attachments.filter((attachment) => plan.taskIds.includes(attachment.taskId));
  const planComments = comments.filter((comment) => plan.taskIds.includes(comment.taskId));

  if (!organization || !nextTask) {
    return null;
  }

  return {
    plan,
    organization,
    phases: planPhases,
    tasks: planTasks,
    nextTask,
    apps,
    attachments: planAttachments,
    comments: planComments
  } satisfies PlanBundle;
}
