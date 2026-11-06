import "server-only";
import type {
  AutomationEnrollmentState,
  AutomationOrigin,
  AutomationTaskMappingState,
  PlanContactRole,
  SubscriptionEligibilityStatus,
  ZohoCommunicationContextState
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ZohoTransaction } from "@/lib/zoho-foundation";
import { isValidEmailAddress, isValidHttpUrl } from "@/lib/zoho-validation";

export type ZohoReadinessCode =
  | "AUTOMATION_EXCLUDED"
  | "AUTOMATION_NOT_ACTIVE"
  | "ONBOARDING_OWNER_MISSING"
  | "ONBOARDING_OWNER_FIRST_NAME_MISSING"
  | "ONBOARDING_OWNER_EMAIL_INVALID"
  | "ONBOARDING_OWNER_NOT_ENABLED"
  | "SE_NAME_MISSING"
  | "SE_EMAIL_INVALID"
  | "SE_BOOKING_URL_INVALID"
  | "TASK_MAPPING_NEEDS_REVIEW"
  | "ACTIVE_TASK_MISSING"
  | "SYNC_CONFIGURATION_MISSING"
  | "FIELD_MAPPING_UNVERIFIED"
  | "LIST_PRIVACY_UNVERIFIED"
  | "JOURNEY_CONFIGURATION_MISSING"
  | "COMMUNICATION_CONTEXT_REQUIRED"
  | "COMMUNICATION_CONTEXT_CONFLICT"
  | "SUBSCRIPTION_NOT_VERIFIED"
  | "J1_NOT_APPROVED";

export type ZohoReadinessStatus =
  | "READY_FOR_JOURNEY_ENROLLMENT"
  | "READY_FOR_DATA_SYNC"
  | "MISSING_INFORMATION"
  | "MANUAL_VERIFICATION_REQUIRED"
  | "AUTOMATION_EXCLUDED"
  | "TASK_MAPPING_NEEDS_REVIEW";

export type ZohoReadinessReason = {
  code: ZohoReadinessCode;
  message: string;
};

export type ZohoAutomationReadiness = {
  readyForDataSync: boolean;
  readyForJourneyEnrollment: boolean;
  reasons: ZohoReadinessReason[];
  status: ZohoReadinessStatus;
};

type ReadinessContact = {
  automationEnabled: boolean;
  email: string;
  firstName: string | null;
  normalizedEmail: string;
  role: PlanContactRole;
  subscriptionStatus: SubscriptionEligibilityStatus;
};

type ReadinessContext = {
  activePlanId: string | null;
  recipientEmailNormalized: string;
  state: ZohoCommunicationContextState;
};

type ReadinessPlan = {
  assignedSeBookingUrl: string | null;
  assignedSeEmail: string | null;
  assignedSeName: string | null;
  automaticJ1Allowed: boolean;
  automationEnrollmentState: AutomationEnrollmentState;
  automationOrigin: AutomationOrigin;
  automationTaskMappingState: AutomationTaskMappingState;
  id: string;
  status: string;
  contacts: ReadinessContact[];
  tasks: Array<{ status: string; templateKey: string | null }>;
};

function hasConfiguration(name: string) {
  return Boolean(process.env[name]?.trim());
}

export function evaluateZohoAutomationReadiness(
  plan: ReadinessPlan,
  contexts: ReadinessContext[]
): ZohoAutomationReadiness {
  const reasons: ZohoReadinessReason[] = [];
  const owners = plan.contacts.filter((contact) => contact.role === "ONBOARDING_OWNER");
  const owner = owners.find((contact) => contact.automationEnabled) ?? owners[0];

  if (plan.automationEnrollmentState === "EXCLUDED") {
    reasons.push({
      code: "AUTOMATION_EXCLUDED",
      message: "This plan is excluded from automation and requires a separately approved enrollment action."
    });
  } else if (plan.automationEnrollmentState !== "ACTIVE") {
    reasons.push({
      code: "AUTOMATION_NOT_ACTIVE",
      message: "Automation enrollment is not active for this plan."
    });
  }

  if (!owner) {
    reasons.push({ code: "ONBOARDING_OWNER_MISSING", message: "Add an Onboarding Owner." });
  } else {
    if (!owner.firstName?.trim()) {
      reasons.push({
        code: "ONBOARDING_OWNER_FIRST_NAME_MISSING",
        message: "The Onboarding Owner needs a first name."
      });
    }
    if (!isValidEmailAddress(owner.email)) {
      reasons.push({ code: "ONBOARDING_OWNER_EMAIL_INVALID", message: "The Onboarding Owner email is invalid." });
    }
    if (!owner.automationEnabled) {
      reasons.push({
        code: "ONBOARDING_OWNER_NOT_ENABLED",
        message: "The Onboarding Owner is not marked eligible for automation."
      });
    }
  }

  if (!plan.assignedSeName?.trim()) {
    reasons.push({ code: "SE_NAME_MISSING", message: "Add the assigned Sales Engineer name." });
  }
  if (!plan.assignedSeEmail || !isValidEmailAddress(plan.assignedSeEmail)) {
    reasons.push({ code: "SE_EMAIL_INVALID", message: "Add a valid assigned Sales Engineer email." });
  }
  if (!plan.assignedSeBookingUrl || !isValidHttpUrl(plan.assignedSeBookingUrl)) {
    reasons.push({
      code: "SE_BOOKING_URL_INVALID",
      message: "Add a valid assigned Sales Engineer booking URL."
    });
  }

  const stableMappingsComplete =
    plan.automationTaskMappingState === "VERIFIED" &&
    plan.tasks.length > 0 &&
    plan.tasks.every((task) => Boolean(task.templateKey));
  if (!stableMappingsComplete) {
    reasons.push({
      code: "TASK_MAPPING_NEEDS_REVIEW",
      message: "Stable task mappings must be reviewed before automation can be enabled."
    });
  }

  const activeTask = plan.tasks.find((task) => task.status !== "complete");
  if (plan.status !== "complete" && !activeTask) {
    reasons.push({ code: "ACTIVE_TASK_MISSING", message: "The plan has no identifiable active next task." });
  }

  const listConfigured = hasConfiguration("ZMA_LIST_KEY") || hasConfiguration("ZOHO_MA_LIST_KEY");
  const topicConfigured = hasConfiguration("ZMA_TOPIC_ID") || hasConfiguration("ZOHO_MA_TOPIC_ID");
  const portalUrlConfigured = hasConfiguration("PORTAL_PUBLIC_BASE_URL") || hasConfiguration("AUTH_URL");
  if (!listConfigured || !topicConfigured || !portalUrlConfigured) {
    reasons.push({
      code: "SYNC_CONFIGURATION_MISSING",
      message: "Required contact synchronization configuration is not complete."
    });
  }
  if (!hasConfiguration("ZMA_J1_TRIGGER_KEY")) {
    reasons.push({
      code: "JOURNEY_CONFIGURATION_MISSING",
      message: "The approved J1 journey trigger configuration is missing."
    });
  }
  if (process.env.ZMA_FIELD_MAPPING_VERIFIED?.trim().toLowerCase() !== "true") {
    reasons.push({
      code: "FIELD_MAPPING_UNVERIFIED",
      message: "Zoho custom-field identifiers require a controlled write verification."
    });
  }
  if (process.env.ZMA_PRIVATE_LIST_VERIFIED?.trim().toLowerCase() !== "true") {
    reasons.push({
      code: "LIST_PRIVACY_UNVERIFIED",
      message: "The KZero Partner Onboarding list must be verified as private."
    });
  }

  if (owner) {
    const context = contexts.find(
      (item) => item.recipientEmailNormalized === owner.normalizedEmail
    );
    if (!context || context.state === "UNASSIGNED") {
      reasons.push({
        code: "COMMUNICATION_CONTEXT_REQUIRED",
        message: "An authorized administrator must assign this recipient's communication context."
      });
    } else if (
      context &&
      (context.state === "BLOCKED" ||
        context.state === "RELEASE_PENDING" ||
        (context.activePlanId !== null && context.activePlanId !== plan.id))
    ) {
      reasons.push({
        code: "COMMUNICATION_CONTEXT_CONFLICT",
        message: "This recipient has an unresolved communication-context conflict."
      });
    }

    if (owner.subscriptionStatus !== "CONFIRMED") {
      reasons.push({
        code: "SUBSCRIPTION_NOT_VERIFIED",
        message: "Partner Onboarding subscription eligibility requires manual verification."
      });
    }
  }

  if (!plan.automaticJ1Allowed) {
    reasons.push({
      code: "J1_NOT_APPROVED",
      message: "Automatic J1 enrollment has not been explicitly approved for this plan."
    });
  }

  const dataBlockingCodes = new Set<ZohoReadinessCode>([
    "AUTOMATION_EXCLUDED",
    "ONBOARDING_OWNER_MISSING",
    "ONBOARDING_OWNER_FIRST_NAME_MISSING",
    "ONBOARDING_OWNER_EMAIL_INVALID",
    "ONBOARDING_OWNER_NOT_ENABLED",
    "SE_NAME_MISSING",
    "SE_EMAIL_INVALID",
    "SE_BOOKING_URL_INVALID",
    "TASK_MAPPING_NEEDS_REVIEW",
    "ACTIVE_TASK_MISSING",
    "SYNC_CONFIGURATION_MISSING",
    "FIELD_MAPPING_UNVERIFIED",
    "LIST_PRIVACY_UNVERIFIED",
    "COMMUNICATION_CONTEXT_REQUIRED",
    "COMMUNICATION_CONTEXT_CONFLICT"
  ]);
  const readyForDataSync = !reasons.some((reason) => dataBlockingCodes.has(reason.code));
  const readyForJourneyEnrollment =
    readyForDataSync &&
    !reasons.some((reason) =>
      [
        "AUTOMATION_EXCLUDED",
        "AUTOMATION_NOT_ACTIVE",
        "ONBOARDING_OWNER_NOT_ENABLED",
        "JOURNEY_CONFIGURATION_MISSING",
        "SUBSCRIPTION_NOT_VERIFIED",
        "J1_NOT_APPROVED"
      ].includes(reason.code)
    );

  let status: ZohoReadinessStatus = "MISSING_INFORMATION";
  if (plan.automationEnrollmentState === "EXCLUDED") {
    status = "AUTOMATION_EXCLUDED";
  } else if (!stableMappingsComplete) {
    status = "TASK_MAPPING_NEEDS_REVIEW";
  } else if (
    reasons.some((reason) =>
      ["COMMUNICATION_CONTEXT_REQUIRED", "COMMUNICATION_CONTEXT_CONFLICT"].includes(reason.code)
    )
  ) {
    status = "MANUAL_VERIFICATION_REQUIRED";
  } else if (readyForJourneyEnrollment) {
    status = "READY_FOR_JOURNEY_ENROLLMENT";
  } else if (readyForDataSync) {
    status = reasons.some((reason) =>
      [
        "SUBSCRIPTION_NOT_VERIFIED",
        "COMMUNICATION_CONTEXT_REQUIRED",
        "COMMUNICATION_CONTEXT_CONFLICT"
      ].includes(reason.code)
    )
      ? "MANUAL_VERIFICATION_REQUIRED"
      : "READY_FOR_DATA_SYNC";
  }

  return { readyForDataSync, readyForJourneyEnrollment, reasons, status };
}

type ReadinessClient = ZohoTransaction | typeof prisma;

export async function getZohoAutomationReadinessWithClient(
  client: ReadinessClient,
  planId: string
) {
  const plan = await client.onboardingPlan.findUnique({
    where: { planId },
    select: {
      assignedSeBookingUrl: true,
      assignedSeEmail: true,
      assignedSeName: true,
      automaticJ1Allowed: true,
      automationEnrollmentState: true,
      automationOrigin: true,
      automationTaskMappingState: true,
      id: true,
      status: true,
      planContacts: {
        select: {
          automationEnabled: true,
          email: true,
          firstName: true,
          normalizedEmail: true,
          role: true,
          subscriptionStatus: true
        }
      },
      onboardingTasks: {
        orderBy: { order: "asc" },
        select: { status: true, templateKey: true }
      }
    }
  });
  if (!plan) {
    return null;
  }

  const contexts = await client.zohoCommunicationContext.findMany({
    where: {
      recipientEmailNormalized: {
        in: plan.planContacts.map((contact) => contact.normalizedEmail)
      }
    },
    select: {
      activePlanId: true,
      recipientEmailNormalized: true,
      state: true
    }
  });

  return evaluateZohoAutomationReadiness(
    { ...plan, contacts: plan.planContacts, tasks: plan.onboardingTasks },
    contexts
  );
}

export function getZohoAutomationReadiness(planId: string) {
  return getZohoAutomationReadinessWithClient(prisma, planId);
}
