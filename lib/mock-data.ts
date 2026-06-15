export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "waiting_on_msp"
  | "waiting_on_kzero"
  | "complete";

export type TaskOwner = "msp" | "kzero_se" | "shared";
export type TenantType = "nfr" | "customer";

export type Organization = {
  id: string;
  name: string;
  tenantType: TenantType;
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

export const organizations: Organization[] = [
  { id: "org-nfr", name: "Northwind MSP", tenantType: "nfr" },
  { id: "org-customer", name: "Northwind Dental", tenantType: "customer" }
];

export const users: User[] = [
  {
    id: "user-msp",
    name: "Avery Cole",
    email: "avery@northwindmsp.com",
    organizationId: "org-nfr",
    role: "msp_admin"
  },
  {
    id: "user-se",
    name: "Morgan Lee",
    email: "morgan@kzero.com",
    organizationId: "org-nfr",
    role: "sales_engineer"
  },
  {
    id: "user-admin",
    name: "Jordan Park",
    email: "jordan@kzero.com",
    organizationId: "org-nfr",
    role: "admin"
  }
];

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

const baseTasks: Omit<Task, "id">[] = [
  {
    phaseId: "phase-kickoff",
    title: "Book NFR deployment meeting",
    description: "Schedule the kickoff with your KZero Sales Engineer to deploy the NFR license.",
    owner: "shared",
    status: "in_progress",
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

function createTasks(prefix: TenantType) {
  return baseTasks.map((task, index) => ({
    ...task,
    id: `${prefix}-task-${index + 1}`
  }));
}

const nfrTasks = createTasks("nfr");
const customerTasks = createTasks("customer").map((task, index) => ({
  ...task,
  status: index === 0 ? "not_started" : task.status
}));

export const tasks: Task[] = [...nfrTasks, ...customerTasks];

export const plans: Plan[] = [
  {
    id: "northwind-nfr",
    organizationId: "org-nfr",
    title: "Northwind MSP NFR Tenant Onboarding",
    tenantType: "nfr",
    phaseIds: phases.map((phase) => phase.id),
    taskIds: nfrTasks.map((task) => task.id),
    nextTaskId: "nfr-task-1",
    progress: 20
  },
  {
    id: "northwind-customer",
    organizationId: "org-customer",
    title: "Northwind Dental Customer Rollout",
    tenantType: "customer",
    phaseIds: phases.map((phase) => phase.id),
    taskIds: customerTasks.map((task) => task.id),
    nextTaskId: "customer-task-1",
    progress: 5
  }
];

export const saasApps: SaaSApp[] = [
  {
    id: "app-1",
    name: "Microsoft 365",
    status: "under_review",
    organizationId: "org-nfr"
  },
  {
    id: "app-2",
    name: "Salesforce",
    status: "submitted",
    organizationId: "org-nfr"
  },
  {
    id: "app-3",
    name: "Dentrix Ascend",
    status: "submitted",
    organizationId: "org-customer"
  }
];

export const attachments: Attachment[] = [
  {
    id: "attachment-1",
    taskId: "nfr-task-4",
    name: "Vault adoption guide placeholder",
    kind: "guide"
  },
  {
    id: "attachment-2",
    taskId: "nfr-task-7",
    name: "Onboarding plan placeholder",
    kind: "plan"
  }
];

export const comments: Comment[] = [
  {
    id: "comment-1",
    taskId: "nfr-task-6",
    author: "Morgan Lee",
    body: "Waiting on final SaaS app list before compatibility review begins."
  }
];

export const taskSubmissions: TaskSubmission[] = [
  {
    id: "submission-1",
    taskId: "nfr-task-5",
    submittedBy: "Avery Cole",
    submittedAt: "2026-06-14",
    note: "Initial SaaS list submitted for review."
  }
];

export function getPlan(planId: string) {
  return plans.find((plan) => plan.id === planId);
}

export function getPlanBundle(planId: string) {
  const plan = getPlan(planId);

  if (!plan) {
    return null;
  }

  const organization = organizations.find((item) => item.id === plan.organizationId);
  const planPhases = phases.filter((phase) => plan.phaseIds.includes(phase.id));
  const planTasks = tasks.filter((task) => plan.taskIds.includes(task.id));
  const nextTask = planTasks.find((task) => task.id === plan.nextTaskId);
  const apps = saasApps.filter((app) => app.organizationId === plan.organizationId);

  return {
    plan,
    organization,
    phases: planPhases,
    tasks: planTasks,
    nextTask,
    apps
  };
}
