import "server-only";

import { Prisma } from "@prisma/client";
import { getZohoConfigurationStatus } from "@/lib/zoho-config";
import { getZohoNudgeSummary } from "@/lib/zoho-nudge-engine";
import { getZohoAutomationReadiness } from "@/lib/zoho-readiness";
import { prisma } from "@/lib/prisma";
import { getAuthorizedStaffIdentity, isStaffOidcConfigured } from "@/lib/staff-auth";

const JOURNEYS = [
  { id: "J1", name: "Welcome and Kickoff Booking" },
  { id: "J3_R1", name: "Next Action Nudge" },
  { id: "J5", name: "Your Next Step Is Ready" },
  { id: "J8", name: "Completion and Expansion" }
] as const;

function boundedInt(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

function safeDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  const date = new Date(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sanitizeZohoAdminText(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/Zoho-oauthtoken\s+[^\s]+/gi, "[authorization removed]")
    .replace(/(client_secret|refresh_token|access_token)\s*[:=]\s*[^\s,;}]+/gi, "$1=[removed]")
    .slice(0, 500);
}

export async function getZohoAdminOverview() {
  const configuration = getZohoConfigurationStatus();
  const staffAdmin = await getAuthorizedStaffIdentity("ADMIN");
  const [pending, held, retrying, failed, processing, uncertain, lastSync, nudgeSummary, stopEvents, audits] = await Promise.all([
    prisma.zohoOutboxEvent.count({ where: { status: "PENDING" } }),
    prisma.zohoOutboxEvent.count({ where: { status: "HELD" } }),
    prisma.zohoOutboxEvent.count({ where: { status: "RETRY" } }),
    prisma.zohoOutboxEvent.count({ where: { status: "DEAD" } }),
    prisma.zohoOutboxEvent.count({ where: { status: "PROCESSING" } }),
    prisma.zohoJourneySend.count({ where: { attemptedAt: { not: null }, providerResult: "UNKNOWN" } }),
    prisma.zohoOutboxEvent.findFirst({
      where: { eventType: "UPSERT_CONTACT", status: "SUCCEEDED" },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true }
    }),
    getZohoNudgeSummary(),
    prisma.zohoOutboxEvent.findMany({
      where: { isStopState: true, status: { in: ["PENDING", "HELD", "PROCESSING", "RETRY", "DEAD"] } },
      orderBy: [{ createdAt: "asc" }],
      take: 20,
      select: {
        id: true, planId: true, recipientEmailNormalized: true, journey: true, status: true,
        holdReason: true, lastSanitizedError: true, lastAttemptAt: true, lastProviderOutcome: true, createdAt: true,
        onboardingPlan: { select: { customerName: true, msp: { select: { name: true } } } }
      }
    }),
    prisma.zohoAutomationAudit.findMany({
      where: { action: { in: ["zoho.fields.discovered", "zoho.journeys.discovered", "zoho.test_sync.accepted", "zoho.test_sync.failed"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { action: true, createdAt: true, reason: true }
    })
  ]);

  const journeyConfig = configuration.journeys as Record<string, { journeyKeyPresent: boolean; triggerKeyPresent: boolean }>;
  return {
    counts: { failed, held, pending, processing, retrying, uncertain },
    nudgeSummary,
    lastSuccessfulSynchronization: lastSync?.updatedAt ?? null,
    configuration: {
      ...configuration,
      cronSecretPresent: Boolean(process.env.CRON_SECRET?.trim()),
      productionDispatchApproved: process.env.ZOHO_PRODUCTION_DISPATCH_APPROVED?.trim().toLowerCase() === "true",
      staffIdentityConfigured: isStaffOidcConfigured()
    },
    journeys: JOURNEYS.map((journey) => ({
      ...journey,
      configured: Boolean(journeyConfig[journey.id]?.journeyKeyPresent && journeyConfig[journey.id]?.triggerKeyPresent)
    })),
    stopEvents: stopEvents.map((event) => ({
      ...event,
      holdReason: sanitizeZohoAdminText(event.holdReason),
      lastSanitizedError: sanitizeZohoAdminText(event.lastSanitizedError),
      providerConfirmed: event.status === "SUCCEEDED" && Boolean(event.lastProviderOutcome)
    })),
    diagnostics: {
      lastFieldDiscovery: audits.find((audit) => audit.action === "zoho.fields.discovered") ?? null,
      lastJourneyDiscovery: audits.find((audit) => audit.action === "zoho.journeys.discovered") ?? null,
      lastApprovedTest: audits.find((audit) => audit.action.startsWith("zoho.test_sync.")) ?? null
    },
    sensitiveActions: {
      identityAuthorized: Boolean(staffAdmin),
      enabled: false,
      reason: staffAdmin
        ? "Individual ADMIN authorization is verified. Operational context, enrollment, and cancellation workflows remain disabled until their Phase 6 controls are implemented."
        : isStaffOidcConfigured()
          ? "Sign in with an individually attributable staff ADMIN identity to authorize sensitive operations."
          : "The approved staff identity provider is not configured. Shared access cannot authorize sensitive operations."
    }
  };
}

export async function getZohoAdminEvents(searchParams: URLSearchParams) {
  const page = boundedInt(searchParams.get("page"), 1, 100_000);
  const pageSize = boundedInt(searchParams.get("pageSize"), 25, 100);
  const query = searchParams.get("query")?.trim();
  const plan = searchParams.get("plan")?.trim();
  const recipient = searchParams.get("recipient")?.trim().toLowerCase();
  const journey = searchParams.get("journey")?.trim();
  const eventType = searchParams.get("eventType")?.trim();
  const status = searchParams.get("status")?.trim();
  const from = safeDate(searchParams.get("from"));
  const to = safeDate(searchParams.get("to"), true);
  const sort = searchParams.get("sort") === "attempts" ? "attemptCount" : "createdAt";
  const direction = searchParams.get("direction") === "asc" ? "asc" : "desc";

  const where: Prisma.ZohoOutboxEventWhereInput = {
    ...(plan ? { OR: [
      { planId: { contains: plan, mode: "insensitive" } },
      { onboardingPlan: { msp: { name: { contains: plan, mode: "insensitive" } } } },
      { onboardingPlan: { customerName: { contains: plan, mode: "insensitive" } } }
    ] } : {}),
    ...(recipient ? { recipientEmailNormalized: { contains: recipient, mode: "insensitive" } } : {}),
    ...(journey && ["J1", "J3_R1", "J5", "J8"].includes(journey) ? { journey: journey as never } : {}),
    ...(eventType && ["UPSERT_CONTACT", "TRIGGER_JOURNEY"].includes(eventType) ? { eventType: eventType as never } : {}),
    ...(status && ["PENDING", "HELD", "PROCESSING", "SUCCEEDED", "RETRY", "DEAD", "CANCELLED"].includes(status) ? { status: status as never } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(query ? { AND: [{ OR: [
      { planId: { contains: query, mode: "insensitive" } },
      { recipientEmailNormalized: { contains: query.toLowerCase(), mode: "insensitive" } },
      { onboardingPlan: { msp: { name: { contains: query, mode: "insensitive" } } } },
      { onboardingPlan: { customerName: { contains: query, mode: "insensitive" } } }
    ] }] } : {})
  };

  const [total, rows] = await Promise.all([
    prisma.zohoOutboxEvent.count({ where }),
    prisma.zohoOutboxEvent.findMany({
      where,
      orderBy: { [sort]: direction },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, onboardingPlanId: true, planId: true, recipientEmailNormalized: true, eventType: true, journey: true, taskKey: true,
        handoffKey: true, status: true, holdReason: true, attemptCount: true, nextAttemptAt: true,
        lastSanitizedError: true, lastAttemptAt: true, lastProviderOutcome: true, isStopState: true,
        createdAt: true, updatedAt: true,
        onboardingPlan: { select: { customerName: true, tenantType: true, msp: { select: { name: true } } } }
      }
    })
  ]);
  const sends = await prisma.zohoJourneySend.findMany({
    where: { onboardingPlanId: { in: [...new Set(rows.map((row) => row.onboardingPlanId).filter(Boolean) as string[])] } },
    orderBy: { updatedAt: "desc" },
    take: Math.min(200, rows.length * 4),
    select: { planId: true, recipientEmailNormalized: true, journey: true, providerResult: true, attemptedAt: true, succeededAt: true }
  }).catch(() => []);

  return {
    page, pageSize, total,
    events: rows.map((row) => {
      const send = row.journey ? sends.find((item) => item.planId === row.planId && item.recipientEmailNormalized === row.recipientEmailNormalized && item.journey === row.journey) : null;
      return {
        ...row,
        holdReason: sanitizeZohoAdminText(row.holdReason),
        lastSanitizedError: sanitizeZohoAdminText(row.lastSanitizedError),
        journeyOutcome: send?.providerResult ?? null,
        journeyAttemptedAt: send?.attemptedAt ?? null,
        journeyAcceptedAt: send?.succeededAt ?? null
      };
    })
  };
}

export async function getZohoAdminContacts(searchParams: URLSearchParams) {
  const cursor = searchParams.get("cursor")?.trim().toLowerCase();
  const query = searchParams.get("query")?.trim().toLowerCase();
  const take = boundedInt(searchParams.get("take"), 30, 75);
  const seed = await prisma.planContact.findMany({
    where: {
      ...(cursor ? { normalizedEmail: { gt: cursor } } : {}),
      ...(query ? { normalizedEmail: { contains: query, mode: "insensitive" } } : {})
    },
    distinct: ["normalizedEmail"],
    orderBy: { normalizedEmail: "asc" },
    take: take + 1,
    select: { normalizedEmail: true }
  });
  const page = seed.slice(0, take);
  const emails = page.map((item) => item.normalizedEmail);
  const [contacts, contexts, events, sends] = await Promise.all([
    prisma.planContact.findMany({
      where: { normalizedEmail: { in: emails } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, normalizedEmail: true, email: true, firstName: true, lastName: true, role: true,
        automationEnabled: true, subscriptionStatus: true, subscriptionVerificationSource: true,
        subscriptionVerifiedAt: true, subscriptionEvidenceReference: true,
        onboardingPlan: { select: { id: true, planId: true, tenantType: true, customerName: true, automationEnrollmentState: true, msp: { select: { name: true } } } }
      }
    }),
    prisma.zohoCommunicationContext.findMany({ where: { recipientEmailNormalized: { in: emails } } }),
    prisma.zohoOutboxEvent.findMany({
      where: { recipientEmailNormalized: { in: emails }, OR: [{ status: "HELD" }, { eventType: "UPSERT_CONTACT", status: "SUCCEEDED" }] },
      orderBy: { updatedAt: "desc" },
      take: Math.min(500, Math.max(50, emails.length * 10)),
      select: { recipientEmailNormalized: true, status: true, eventType: true, updatedAt: true, holdReason: true }
    }),
    prisma.zohoJourneySend.findMany({
      where: { recipientEmailNormalized: { in: emails }, attemptedAt: { not: null }, providerResult: "UNKNOWN" },
      select: { recipientEmailNormalized: true, journey: true, attemptedAt: true }
    })
  ]);

  return {
    nextCursor: seed.length > take ? page.at(-1)?.normalizedEmail ?? null : null,
    recipients: emails.map((email) => {
      const emailContacts = contacts.filter((contact) => contact.normalizedEmail === email);
      const context = contexts.find((item) => item.recipientEmailNormalized === email) ?? null;
      const activePlans = emailContacts.filter((contact) => contact.onboardingPlan.automationEnrollmentState === "ACTIVE");
      const emailEvents = events.filter((event) => event.recipientEmailNormalized === email);
      const lastSync = emailEvents.find((event) => event.eventType === "UPSERT_CONTACT" && event.status === "SUCCEEDED");
      const held = emailEvents.filter((event) => event.status === "HELD");
      return {
        recipient: email,
        context: context ? {
          activePlanId: context.activePlanId,
          owningPlan: emailContacts.find((contact) => contact.onboardingPlan.id === context.activePlanId)?.onboardingPlan ?? null,
          state: context.state,
          releaseReason: sanitizeZohoAdminText(context.releaseReason),
          verificationEvidence: sanitizeZohoAdminText(context.verificationEvidence)
        } : null,
        plans: emailContacts.map((contact) => ({
          ...contact.onboardingPlan,
          contactId: contact.id,
          role: contact.role,
          automationEnabled: contact.automationEnabled,
          subscriptionStatus: contact.subscriptionStatus,
          subscriptionVerificationSource: contact.subscriptionVerificationSource,
          subscriptionVerifiedAt: contact.subscriptionVerifiedAt,
          subscriptionEvidenceReference: sanitizeZohoAdminText(contact.subscriptionEvidenceReference)
        })),
        competingActivePlans: activePlans.length,
        heldEventCount: held.length,
        holdReason: sanitizeZohoAdminText(held[0]?.holdReason),
        lastSuccessfulSync: lastSync?.updatedAt ?? null,
        outstandingJourneyUncertainty: sends.filter((send) => send.recipientEmailNormalized === email)
      };
    })
  };
}

export async function getZohoPlanAutomationSummary(planId: string) {
  const plan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    select: {
      id: true, planId: true, automationEnrollmentState: true, automationOrigin: true, nudgeStatus: true,
      nudgeTaskKey: true, planContacts: { where: { role: "ONBOARDING_OWNER" }, take: 1, select: { normalizedEmail: true, subscriptionStatus: true } }
    }
  });
  if (!plan) return null;
  const owner = plan.planContacts[0];
  const [readiness, context, lastSync, lastJourney, eventCounts] = await Promise.all([
    getZohoAutomationReadiness(planId),
    owner ? prisma.zohoCommunicationContext.findUnique({ where: { recipientEmailNormalized: owner.normalizedEmail }, select: { activePlanId: true, state: true } }) : null,
    prisma.zohoOutboxEvent.findFirst({ where: { onboardingPlanId: plan.id, eventType: "UPSERT_CONTACT", status: "SUCCEEDED" }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true, lastProviderOutcome: true } }),
    prisma.zohoJourneySend.findFirst({ where: { onboardingPlanId: plan.id }, orderBy: { updatedAt: "desc" }, select: { journey: true, providerResult: true, attemptedAt: true, succeededAt: true } }),
    Promise.all([
      prisma.zohoOutboxEvent.count({ where: { onboardingPlanId: plan.id, status: "HELD" } }),
      prisma.zohoOutboxEvent.count({ where: { onboardingPlanId: plan.id, status: { in: ["DEAD", "RETRY"] } } })
    ])
  ]);
  return {
    automationEnrollmentState: plan.automationEnrollmentState,
    automationOrigin: plan.automationOrigin,
    readiness,
    subscriptionStatus: owner?.subscriptionStatus ?? null,
    communicationContext: context,
    lastSuccessfulContactSync: lastSync,
    lastJourneyOutcome: lastJourney,
    nudge: { status: plan.nudgeStatus, taskKey: plan.nudgeTaskKey },
    heldEventCount: eventCounts[0], failedEventCount: eventCounts[1]
  };
}
