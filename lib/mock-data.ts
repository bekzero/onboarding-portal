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

export type FirstCustomerPilot = {
  adminContactEmail?: string;
  adminContactName?: string;
  customerAlias: string;
  estimatedUserCount?: number;
  notes?: string;
  targetRolloutTiming: string;
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
  firstCustomerPilot: FirstCustomerPilot | null;
};

export type OnboardingCase = {
  accessMode: AccessMode;
  actionHref: string;
  assignedSalesEngineer: string;
  currentStage: string;
  enrollmentDate?: string;
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
    description: "Start your KZero Passwordless onboarding plan and confirm the first tenant setup activities.",
    order: 1
  },
  {
    id: "phase-tenant-setup",
    title: "Tenant Setup",
    description: "Prepare your team, tenant access, and user readiness for the first rollout wave.",
    order: 2
  },
  {
    id: "phase-app-review",
    title: "App Review",
    description: "Submit your priority SaaS applications so KZero Passwordless can review them for SSO readiness.",
    order: 3
  },
  {
    id: "phase-sso-rollout",
    title: "SSO Rollout",
    description: "Review the onboarding plan and implement the first SSO application wave with your KZero Sales Engineer.",
    order: 4
  },
  {
    id: "phase-customer-rollout",
    title: "First Customer Pilot",
    description: "Confirm the first customer pilot and prepare the customer tenant for rollout.",
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
    currentStage: "Repeatable Rollout Ready",
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

const baseTasks: Array<{ stableId: string } & Omit<Task, "id">> = [
  {
    stableId: "task-1",
    phaseId: "phase-kickoff",
    title: "Book Setup Call with Your KZero Sales Engineer",
    description: "Schedule the kickoff meeting with your KZero Sales Engineer to begin NFR tenant setup and confirm the first rollout steps.",
    owner: "msp",
    status: "waiting_on_msp",
    dueLabel: "This week",
    meetingCta: "Open Microsoft Bookings"
  },
  {
    stableId: "import-your-passwords",
    phaseId: "phase-tenant-setup",
    title: "Import Your Passwords",
    description: "Import your saved passwords into KZero Passwordless Vault first so you can validate the user experience before guiding the rest of your team. Complete this step when the onboarding owner has imported saved passwords, confirmed access to imported items, and noted any import issues before the wider rollout.",
    owner: "msp",
    status: "not_started"
  },
  {
    stableId: "task-2",
    phaseId: "phase-tenant-setup",
    title: "Add Backup Administrators",
    description: "Invite backup administrators in the KZero Passwordless Dashboard so your tenant is not dependent on a single admin account. Complete this step when backup administrators are invited, break-glass coverage is identified, and the invited administrators can access the dashboard.",
    owner: "msp",
    status: "not_started"
  },
  {
    stableId: "task-3",
    phaseId: "phase-tenant-setup",
    title: "Add Employees and Contractors",
    description: "Invite the members of your team who will participate in the NFR rollout using their company email addresses. Complete this step when pilot users are invited, activation emails are sent, and the users appear in the selected tenant.",
    owner: "msp",
    status: "not_started"
  },
  {
    stableId: "task-4",
    phaseId: "phase-tenant-setup",
    title: "Share Vault and Browser Extension Guidance",
    description: "Share the KZero Passwordless Vault and browser extension guides with the users you added. Complete this step when your team knows where to find the guides, understands password import preparation, and knows which browsers and extensions are supported.",
    owner: "msp",
    status: "not_started"
  },
  {
    stableId: "task-5",
    phaseId: "phase-app-review",
    title: "Submit SaaS Applications for Review",
    description: "Submit the SaaS applications your team wants KZero Passwordless to review for SSO readiness and rollout planning. Complete this step when priority applications, login URLs, and supporting notes are included where available.",
    owner: "msp",
    status: "waiting_on_msp"
  },
  {
    stableId: "task-6",
    phaseId: "phase-app-review",
    title: "Review App Compatibility and Prepare the Onboarding Plan",
    description: "KZero reviews the submitted applications and prepares a recommended implementation plan for the first SSO rollout wave.",
    owner: "kzero_se",
    status: "waiting_on_kzero",
    waitingOn: "kzero"
  },
  {
    stableId: "task-7",
    phaseId: "phase-sso-rollout",
    title: "Upload the Onboarding Plan",
    description: "KZero will upload the onboarding plan with recommended app sequencing and implementation guidance so your team can review it before implementation.",
    owner: "kzero_se",
    status: "not_started"
  },
  {
    stableId: "task-8",
    phaseId: "phase-sso-rollout",
    title: "Book the SSO Implementation Session",
    description: "Schedule a working session with your KZero Sales Engineer to implement the first SSO application wave.",
    owner: "shared",
    status: "not_started",
    meetingCta: "Book implementation session"
  },
  {
    stableId: "task-9",
    phaseId: "phase-customer-rollout",
    title: "Select First Customer Pilot",
    description: "Provide the customer name or alias, estimated user count, target rollout timing, and any rollout notes so KZero Passwordless can prepare the first customer rollout.",
    owner: "msp",
    status: "not_started"
  },
  {
    stableId: "task-10",
    phaseId: "phase-customer-rollout",
    title: "Confirm Customer Readiness",
    description: "Confirm the customer has agreed to participate, customer administrators are identified, and the rollout timing is acceptable for the first pilot.",
    owner: "msp",
    status: "not_started"
  },
  {
    stableId: "task-11",
    phaseId: "phase-customer-rollout",
    title: "KZero Reviews Pilot Plan",
    description: "KZero reviews the first customer details and confirms the rollout approach for the pilot tenant.",
    owner: "kzero_se",
    status: "not_started"
  },
  {
    stableId: "task-12",
    phaseId: "phase-customer-rollout",
    title: "Book Customer Rollout Session",
    description: "Schedule a working session with your KZero Sales Engineer to prepare the first customer tenant for rollout.",
    owner: "shared",
    status: "not_started",
    meetingCta: "Book customer rollout session"
  },
  {
    stableId: "task-13",
    phaseId: "phase-customer-rollout",
    title: "Complete First Customer Rollout",
    description: "Apply the validated KZero Passwordless rollout process to the first customer tenant and confirm the initial rollout is complete.",
    owner: "shared",
    status: "not_started"
  }
];

function createTasks(prefix: string) {
  return baseTasks.map(({ stableId, ...task }) => ({
    ...task,
    id: `${prefix}-${stableId}`
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
    ],
    firstCustomerPilot: null
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
    comments: planComments,
    firstCustomerPilot: null
  } satisfies PlanBundle;
}
