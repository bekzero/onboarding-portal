import type { ZohoContactDisplayField } from "./zoho-field-mapping";

export const ZOHO_TENANT_TYPES = ["NFR", "Customer"] as const;
export const ZOHO_PHASES = [
  "Kickoff",
  "Tenant Setup",
  "App Review",
  "SSO Rollout",
  "First Customer Pilot",
  "Onboarding Complete"
] as const;
export const ZOHO_CONTACT_ROLES = [
  "Onboarding Owner",
  "Executive Sponsor",
  "Technical Admin"
] as const;
export const ZOHO_ONBOARDING_STATES = ["Active", "Paused", "Complete"] as const;
export const ZOHO_TASK_OWNERS = ["MSP", "KZero SE", "Shared"] as const;
export const ZOHO_TASK_STATUSES = [
  "Action Required",
  "In Progress",
  "KZero Working",
  "Upcoming",
  "Complete"
] as const;
export const ZOHO_NUDGE_STATUSES = ["Waiting", "Done"] as const;

type TenantType = (typeof ZOHO_TENANT_TYPES)[number];
type CurrentPhase = (typeof ZOHO_PHASES)[number];
type ContactRole = (typeof ZOHO_CONTACT_ROLES)[number];
type OnboardingState = (typeof ZOHO_ONBOARDING_STATES)[number];
type TaskOwner = (typeof ZOHO_TASK_OWNERS)[number];
type TaskStatus = (typeof ZOHO_TASK_STATUSES)[number];
type NudgeStatus = (typeof ZOHO_NUDGE_STATUSES)[number];

export type ZohoContactSnapshotInput = {
  appsApproved: number;
  appsSubmitted: number;
  contact: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: "ONBOARDING_OWNER" | "EXECUTIVE_SPONSOR" | "TECHNICAL_ADMIN";
  };
  kickoffBookedAt: Date | null;
  lastMspActivity: Date | null;
  lastSeTouch: Date | null;
  nextTask: {
    guideUrl: string | null;
    minutes: number | null;
    owner: string | null;
    since: Date | null;
    status: string;
    templateKey: string;
    tip: string | null;
    title: string;
  };
  nudgeStatus: "NONE" | "WAITING" | "DONE";
  plan: {
    currentStage: string | null;
    planId: string;
    progress: number;
    status: string;
    tenantType: string | null;
  };
  portalBaseUrl: string;
  salesEngineer: {
    bookingUrl: string | null;
    email: string | null;
    name: string | null;
  };
};

export type ZohoContactSnapshot = Record<ZohoContactDisplayField, string | number | null>;

export class ZohoContactMappingError extends Error {
  constructor(message: string, readonly field: string) {
    super(message);
    this.name = "ZohoContactMappingError";
  }
}

function mapTenantType(value: string | null): TenantType {
  if (value?.toLowerCase() === "nfr") return "NFR";
  if (value?.toLowerCase() === "customer") return "Customer";
  throw new ZohoContactMappingError("Tenant type is not mapped to a Zoho picklist value.", "Tenant Type");
}

function mapPhase(value: string | null, progress: number, status: string): CurrentPhase {
  if (progress >= 100 || status.toLowerCase() === "complete") return "Onboarding Complete";
  const normalized = value?.trim().toLowerCase();
  const phases: Record<string, CurrentPhase> = {
    "app review": "App Review",
    kickoff: "Kickoff",
    "first customer pilot": "First Customer Pilot",
    "first customer rollout": "First Customer Pilot",
    "sso rollout": "SSO Rollout",
    "tenant setup": "Tenant Setup"
  };
  const phase = normalized ? phases[normalized] : undefined;
  if (!phase) throw new ZohoContactMappingError("Current phase is not mapped to a Zoho picklist value.", "Current Phase");
  return phase;
}

function mapRole(value: ZohoContactSnapshotInput["contact"]["role"]): ContactRole {
  return {
    EXECUTIVE_SPONSOR: "Executive Sponsor",
    ONBOARDING_OWNER: "Onboarding Owner",
    TECHNICAL_ADMIN: "Technical Admin"
  }[value] as ContactRole;
}

function mapState(value: string): OnboardingState {
  const normalized = value.toLowerCase();
  if (normalized === "complete") return "Complete";
  if (normalized === "paused") return "Paused";
  return "Active";
}

function mapOwner(value: string | null): TaskOwner {
  const owner = { kzero_se: "KZero SE", msp: "MSP", shared: "Shared" }[value ?? ""];
  if (!owner) throw new ZohoContactMappingError("Next task owner is not mapped to a Zoho picklist value.", "Next Task Owner");
  return owner as TaskOwner;
}

function mapTaskStatus(value: string, kickoffBooked: boolean, taskKey: string): TaskStatus {
  if (kickoffBooked && taskKey === "book-kickoff") return "Upcoming";
  const status = {
    complete: "Complete",
    in_progress: "In Progress",
    not_started: "Upcoming",
    waiting_on_kzero: "KZero Working",
    waiting_on_msp: "Action Required"
  }[value];
  if (!status) throw new ZohoContactMappingError("Next task status is not mapped to a Zoho picklist value.", "Next Task Status");
  return status as TaskStatus;
}

function mapNudgeStatus(value: ZohoContactSnapshotInput["nudgeStatus"]): NudgeStatus {
  return value === "WAITING" ? "Waiting" : "Done";
}

function requireText(value: string | null, field: string) {
  const normalized = value?.trim();
  if (!normalized) throw new ZohoContactMappingError(`${field} is required for Zoho synchronization.`, field);
  return normalized;
}

function dateValue(value: Date | null) {
  return value ? value.toISOString() : null;
}

export function createZohoContactSnapshot(input: ZohoContactSnapshotInput): ZohoContactSnapshot {
  const firstName = requireText(input.contact.firstName, "First Name");
  const contactEmail = requireText(input.contact.email, "Lead Email");
  const seName = requireText(input.salesEngineer.name, "SE Name");
  const seEmail = requireText(input.salesEngineer.email, "SE Email");
  const seBookingUrl = requireText(input.salesEngineer.bookingUrl, "SE Booking URL");
  const baseUrl = requireText(input.portalBaseUrl, "Portal URL").replace(/\/$/, "");
  const portalUrl = `${baseUrl}/portal/${encodeURIComponent(input.plan.planId)}`;
  const nextTaskLink = `${portalUrl}?tab=tasks&task=${encodeURIComponent(input.nextTask.templateKey)}`;

  if (!Number.isInteger(input.appsSubmitted) || input.appsSubmitted < 0) {
    throw new ZohoContactMappingError("Apps Submitted must be an accurate non-negative count.", "Apps Submitted");
  }
  if (!Number.isInteger(input.plan.progress) || input.plan.progress < 0 || input.plan.progress > 100) {
    throw new ZohoContactMappingError("Onboarding Progress must be an integer from 0 to 100.", "Onboarding Progress");
  }
  if (![contactEmail, seEmail].every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new ZohoContactMappingError("Contact and Sales Engineer emails must be valid.", "Lead Email");
  }
  for (const [urlValue, field] of [[baseUrl, "Portal URL"], [seBookingUrl, "SE Booking URL"]] as const) {
    try {
      const url = new URL(urlValue);
      if (!(["http:", "https:"] as string[]).includes(url.protocol)) throw new Error("protocol");
    } catch {
      throw new ZohoContactMappingError(`${field} must be a valid HTTP or HTTPS URL.`, field);
    }
  }
  if (!Number.isInteger(input.appsApproved) || input.appsApproved < 0) {
    throw new ZohoContactMappingError("Apps Approved must be an accurate non-negative count.", "Apps Approved");
  }
  if (input.nextTask.minutes !== null && (!Number.isInteger(input.nextTask.minutes) || input.nextTask.minutes < 0)) {
    throw new ZohoContactMappingError("Next Task Minutes must be an accurate integer estimate.", "Next Task Minutes");
  }

  return {
    "Lead Email": contactEmail,
    "First Name": firstName,
    "Last Name": input.contact.lastName?.trim() || "",
    "Plan ID": input.plan.planId,
    "Tenant Type": mapTenantType(input.plan.tenantType),
    "Portal URL": portalUrl,
    "Current Phase": mapPhase(input.plan.currentStage, input.plan.progress, input.plan.status),
    "Onboarding Progress": input.plan.progress,
    "Onboarding Role": mapRole(input.contact.role),
    "Onboarding State": mapState(input.plan.status),
    "Next Task ID": input.nextTask.templateKey,
    "Next Task Title": requireText(input.nextTask.title, "Next Task Title"),
    "Next Task Owner": mapOwner(input.nextTask.owner),
    "Next Task Status": mapTaskStatus(
      input.nextTask.status,
      Boolean(input.kickoffBookedAt),
      input.nextTask.templateKey
    ),
    "Next Task Minutes": input.nextTask.minutes,
    "Next Task Link": nextTaskLink,
    "Next Task Tip": input.nextTask.tip,
    "Next Task Guide URL": input.nextTask.guideUrl,
    "Next Task Since": dateValue(input.nextTask.since),
    "Last MSP Activity": dateValue(input.lastMspActivity),
    "Last SE Touch": dateValue(input.lastSeTouch),
    "Apps Submitted": input.appsSubmitted,
    "Apps Approved": input.appsApproved,
    "SE Name": seName,
    "SE Email": seEmail,
    "SE Booking URL": seBookingUrl,
    "Nudge Status": mapNudgeStatus(input.nudgeStatus)
  };
}
