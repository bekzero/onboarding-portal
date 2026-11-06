import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const TEMPLATE_VERSION = 1;
const TEMPLATE = [
  ["book-kickoff", 0, "Book Setup Call with Your KZero Sales Engineer"],
  ["import-your-passwords", 1, "Import Your Passwords"],
  ["add-backup-administrators", 2, "Add Backup Administrators"],
  ["add-employees-and-contractors", 3, "Add Employees and Contractors"],
  ["share-vault-browser-extension-guidance", 4, "Share Vault and Browser Extension Guidance"],
  ["submit-saas-applications-for-review", 5, "Submit SaaS Applications for Review"],
  ["review-app-compatibility-prepare-onboarding-plan", 6, "Review App Compatibility and Prepare the Onboarding Plan"],
  ["upload-onboarding-plan", 7, "Upload the Onboarding Plan"],
  ["book-sso-implementation-session", 8, "Book the SSO Implementation Session"],
  ["select-first-customer-pilot", 9, "Select First Customer Pilot"],
  ["confirm-customer-readiness", 10, "Confirm Customer Readiness"],
  ["kzero-reviews-pilot-plan", 11, "KZero Reviews Pilot Plan"],
  ["book-customer-rollout-session", 12, "Book Customer Rollout Session"],
  ["complete-first-customer-rollout", 13, "Complete First Customer Rollout"]
].map(([templateKey, order, title]) => ({ templateKey, order, title }));

if (process.env.ZOHO_FOUNDATION_VERIFY_READ_ONLY !== "1") {
  throw new Error("Set ZOHO_FOUNDATION_VERIFY_READ_ONLY=1 to acknowledge this read-only database report.");
}

if (process.env.VERCEL_ENV === "production" && process.env.ALLOW_PRODUCTION_ZOHO_VERIFY !== "1") {
  throw new Error("Production verification requires explicit ALLOW_PRODUCTION_ZOHO_VERIFY=1 approval.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function describeCandidates(task) {
  const titleCandidate = TEMPLATE.find((item) => item.title === task.title);
  const orderCandidate = TEMPLATE.find((item) => item.order === task.order);

  if (titleCandidate && orderCandidate && titleCandidate.templateKey !== orderCandidate.templateKey) {
    return {
      orderCandidate: orderCandidate.templateKey,
      titleCandidate: titleCandidate.templateKey
    };
  }

  return null;
}

try {
  const [plans, outboxCount, journeySendCount, contextCount, contactCount] = await Promise.all([
    prisma.onboardingPlan.findMany({
      orderBy: { planId: "asc" },
      select: {
        automaticJ1Allowed: true,
        automationEnrollmentState: true,
        automationOrigin: true,
        automationTaskMappingState: true,
        kickoffBookedAt: true,
        nextTaskSince: true,
        planId: true,
        onboardingTasks: {
          orderBy: [{ order: "asc" }, { id: "asc" }],
          select: {
            completedAt: true,
            id: true,
            order: true,
            statusChangedAt: true,
            templateKey: true,
            title: true
          }
        }
      }
    }),
    prisma.zohoOutboxEvent.count(),
    prisma.zohoJourneySend.count(),
    prisma.zohoCommunicationContext.count(),
    prisma.planContact.count()
  ]);

  const report = {
    templateVersion: TEMPLATE_VERSION,
    expectedTaskCount: TEMPLATE.length,
    totals: {
      plans: plans.length,
      planContacts: contactCount,
      communicationContexts: contextCount,
      outboxEvents: outboxCount,
      journeySends: journeySendCount
    },
    historicalProtectionViolations: [],
    missingMappings: [],
    duplicateMappings: [],
    ambiguousMappings: [],
    taskCountMismatches: [],
    planMappingStateMismatches: []
  };

  for (const plan of plans) {
    if (
      plan.automationOrigin === "LEGACY" &&
      (plan.automationEnrollmentState !== "EXCLUDED" ||
        plan.automaticJ1Allowed ||
        plan.nextTaskSince !== null ||
        plan.kickoffBookedAt !== null)
    ) {
      report.historicalProtectionViolations.push({
        planId: plan.planId,
        automationEnrollmentState: plan.automationEnrollmentState,
        automaticJ1Allowed: plan.automaticJ1Allowed,
        hasKickoffBookedAt: plan.kickoffBookedAt !== null,
        hasNextTaskSince: plan.nextTaskSince !== null
      });
    }

    const tasksByKey = new Map();
    for (const task of plan.onboardingTasks) {
      if (!task.templateKey) {
        report.missingMappings.push({
          planId: plan.planId,
          taskId: task.id,
          order: task.order,
          title: task.title
        });

        const ambiguity = describeCandidates(task);
        if (ambiguity) {
          report.ambiguousMappings.push({
            planId: plan.planId,
            taskId: task.id,
            order: task.order,
            title: task.title,
            ...ambiguity
          });
        }
      } else {
        const taskIds = tasksByKey.get(task.templateKey) ?? [];
        taskIds.push(task.id);
        tasksByKey.set(task.templateKey, taskIds);
      }

      if (plan.automationOrigin === "LEGACY" && (task.statusChangedAt !== null || task.completedAt !== null)) {
        report.historicalProtectionViolations.push({
          planId: plan.planId,
          taskId: task.id,
          hasStatusChangedAt: task.statusChangedAt !== null,
          hasCompletedAt: task.completedAt !== null
        });
      }
    }

    for (const [templateKey, taskIds] of tasksByKey) {
      if (taskIds.length > 1) {
        report.duplicateMappings.push({ planId: plan.planId, templateKey, taskIds });
      }
    }

    if (plan.onboardingTasks.length !== TEMPLATE.length) {
      report.taskCountMismatches.push({
        planId: plan.planId,
        actual: plan.onboardingTasks.length,
        expected: TEMPLATE.length
      });
    }

    const mappingIsComplete =
      plan.onboardingTasks.length === TEMPLATE.length &&
      plan.onboardingTasks.every((task) => task.templateKey !== null) &&
      new Set(plan.onboardingTasks.map((task) => task.templateKey)).size === TEMPLATE.length &&
      TEMPLATE.every((template) => tasksByKey.has(template.templateKey));
    const expectedMappingState = mappingIsComplete ? "VERIFIED" : "NEEDS_REVIEW";
    if (plan.automationTaskMappingState !== expectedMappingState) {
      report.planMappingStateMismatches.push({
        planId: plan.planId,
        actual: plan.automationTaskMappingState,
        expected: expectedMappingState
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));

  const issueCount =
    report.historicalProtectionViolations.length +
    report.missingMappings.length +
    report.duplicateMappings.length +
    report.ambiguousMappings.length +
    report.taskCountMismatches.length +
    report.planMappingStateMismatches.length;
  if (issueCount > 0) {
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
  await pool.end();
}
