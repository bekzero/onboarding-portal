import { NextResponse } from "next/server";
import { getSensitiveAdminApiAuthError, getSensitiveAdminAuditActor } from "@/lib/admin-auth";
import { getZohoPlanAutomationSummary } from "@/lib/zoho-admin-center";
import {
  approvePilotPlanAutomation,
  assignPilotCommunicationContext,
  confirmPilotSubscriptionEligibility,
  recordPilotDownstreamAutomationVerification,
  verifyPilotMailingListPrivacy
} from "@/lib/zoho-pilot-admin";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";
import {
  restoreRetiredCommunicationContext,
  retireCommunicationContextForTestSuccessor
} from "@/lib/zoho-context-admin";
import { recordTestJ1ContactValuesVerification } from "@/lib/zoho-exact-lifecycle-maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set([
  "APPROVE_AUTOMATION",
  "ASSIGN_CONTEXT",
  "CONFIRM_SUBSCRIPTION",
  "RESTORE_RETIRED_CONTEXT",
  "RETIRE_CONTEXT_FOR_TEST_SUCCESSOR",
  "VERIFY_TEST_J1_CONTACT_VALUES",
  "VERIFY_LIST_PRIVACY",
  "VERIFY_DOWNSTREAM_AUTOMATION"
]);

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getSensitiveAdminApiAuthError(request, "ADMIN");
  if (authError) return authError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) return NextResponse.json({ error: "Authenticated ADMIN identity is required." }, { status: 403 });

  try {
    const body = (await request.json()) as {
      action?: unknown;
      authorizationBasis?: unknown;
      authorizationEvidenceConfirmed?: unknown;
      confirmation?: unknown;
      confirmed?: unknown;
      evidenceReference?: unknown;
      eventId?: unknown;
      reviewComplete?: unknown;
      reviewedItems?: unknown;
      reviewResult?: unknown;
      reason?: unknown;
      successorPlanId?: unknown;
    };
    if (typeof body.action !== "string" || !ACTIONS.has(body.action) || body.confirmed !== true) {
      return NextResponse.json({ error: "Select and explicitly confirm a supported readiness action." }, { status: 400 });
    }
    const { planId } = await context.params;
    const result = body.action === "VERIFY_TEST_J1_CONTACT_VALUES"
      ? await recordTestJ1ContactValuesVerification({
          actor,
          confirmation: typeof body.confirmation === "string" ? body.confirmation : "",
          contactEventId: typeof body.eventId === "string" ? body.eventId : "",
          evidenceReference: typeof body.evidenceReference === "string" ? body.evidenceReference : "",
          planId
        })
      : body.action === "RETIRE_CONTEXT_FOR_TEST_SUCCESSOR"
      ? await retireCommunicationContextForTestSuccessor({
          actor,
          confirmation: typeof body.confirmation === "string" ? body.confirmation : "",
          planId,
          reason: typeof body.reason === "string" ? body.reason : "",
          successorPlanId: typeof body.successorPlanId === "string" ? body.successorPlanId : ""
        })
      : body.action === "RESTORE_RETIRED_CONTEXT"
        ? await restoreRetiredCommunicationContext({
            actor,
            confirmation: typeof body.confirmation === "string" ? body.confirmation : "",
            planId,
            successorPlanId: typeof body.successorPlanId === "string" ? body.successorPlanId : ""
          })
      : body.action === "APPROVE_AUTOMATION"
      ? await approvePilotPlanAutomation({ actor, planId })
      : body.action === "ASSIGN_CONTEXT"
        ? await assignPilotCommunicationContext({ actor, planId })
        : body.action === "CONFIRM_SUBSCRIPTION"
          ? await confirmPilotSubscriptionEligibility({
              actor,
              authorizationBasis: body.authorizationBasis,
              authorizationEvidenceConfirmed: body.authorizationEvidenceConfirmed,
              confirmation: body.confirmation,
              evidenceReference: body.evidenceReference,
              planId
            })
          : body.action === "VERIFY_LIST_PRIVACY"
            ? await verifyPilotMailingListPrivacy({ actor, planId })
            : await recordPilotDownstreamAutomationVerification({
                actor,
                evidenceReference: body.evidenceReference,
                planId,
                reviewComplete: body.reviewComplete,
                reviewedItems: body.reviewedItems,
                reviewResult: body.reviewResult
              });
    const summary = await getZohoPlanAutomationSummary(planId, {
      currentStaffRole: "ADMIN",
      includePermissionEvidenceReference: true
    });
    return NextResponse.json({ action: body.action, changed: result.changed, summary });
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
