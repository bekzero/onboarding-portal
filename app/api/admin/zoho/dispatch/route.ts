import { NextResponse } from "next/server";
import { getAdminApiAuthError, getSensitiveAdminApiAuthError } from "@/lib/admin-auth";
import {
  getZohoConfigurationStatus,
  getZohoDispatchConfiguration,
  getZohoMspEnrollmentPilotConfiguration,
  getZohoTestConfiguration,
  getZohoTopicId
} from "@/lib/zoho-config";
import { dispatchExactZohoOutboxEvent, dispatchZohoOutboxBatch, getZohoDispatcherSummary } from "@/lib/zoho-dispatcher";
import { evaluateExactEventMaintenancePosture } from "@/lib/zoho-exact-event-dispatch-core";
import { getExistingFullFieldTestIntent } from "@/lib/zoho-existing-plan-test-intent";
import { authorizeExactTestJ1LifecycleDispatch } from "@/lib/zoho-exact-lifecycle-maintenance";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export async function GET() {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  return NextResponse.json(await getZohoDispatcherSummary());
}

export async function POST(request: Request) {
  const authError = await getAdminApiAuthError("ADMIN");
  if (authError) return authError;
  const identityError = await getSensitiveAdminApiAuthError(request);
  if (identityError) return identityError;
  const config = getZohoDispatchConfiguration();
  if (config.mode !== "test") {
    return NextResponse.json({ error: "Manual dispatch is restricted to explicit test mode." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { confirmation?: unknown; eventId?: unknown; maxEvents?: unknown; planId?: unknown } | null;
  if (typeof body?.eventId === "string" || typeof body?.planId === "string") {
    if (
      typeof body.confirmation !== "string" ||
      typeof body.eventId !== "string" ||
      typeof body.planId !== "string"
    ) {
      return NextResponse.json({ error: "Exact event, plan, and full-field test confirmation are required." }, { status: 400 });
    }
    const approvedEvent = await getExistingFullFieldTestIntent(body.planId);
    if (!approvedEvent || approvedEvent.id !== body.eventId) {
      try {
        const lifecycleEvent = await authorizeExactTestJ1LifecycleDispatch({
          confirmation: body.confirmation,
          eventId: body.eventId,
          planId: body.planId
        });
        return NextResponse.json(await dispatchExactZohoOutboxEvent(lifecycleEvent.id));
      } catch (error) {
        return zohoAdminErrorResponse(error);
      }
    }
    if (body.confirmation !== "DISPATCH ONE ALLOWLISTED FULL-FIELD TEST EVENT") {
      return NextResponse.json({ error: "Enter the exact full-field test confirmation phrase." }, { status: 400 });
    }
    const posture = getZohoConfigurationStatus();
    const target = getZohoMspEnrollmentPilotConfiguration();
    const allowlist = getZohoTestConfiguration();
    const isolation = evaluateExactEventMaintenancePosture({
      allowlistMatchesTarget:
        target.configured &&
        target.planId === body.planId &&
        allowlist.allowedPlanIds.size === 1 &&
        allowlist.allowedPlanIds.has(target.planId) &&
        allowlist.allowedEmails.size === 1 &&
        allowlist.allowedEmails.has(target.email),
      automaticDispatchEnabled: config.automaticDispatchEnabled,
      contactSyncEnabled: config.contactSyncEnabled,
      eventEmissionEnabled: posture.eventEmissionEnabled,
      exactEventDispatchEnabled: config.exactEventDispatchEnabled,
      fieldMappingVerified: posture.fieldMappingVerified,
      globalKillSwitch: config.globalKillSwitch,
      journeyTriggeringEnabled: config.journeyTriggeringEnabled,
      legacyTestSyncEnabled: allowlist.enabled,
      listKeyPresent: posture.listKeyPresent,
      listPrivacyVerified: posture.listPrivacyVerified,
      mode: config.mode,
      mspEnrollmentContactSyncEnabled: posture.mspEnrollmentContactSyncEnabled,
      nudgeEvaluationEnabled: posture.nudgeEvaluationEnabled,
      oauthConfigured: posture.oauthConfigured,
      productionApproved: config.productionApproved,
      singleContactPilotEnabled: posture.singleContactPilotEnabled,
      testContactSyncEnabled: posture.testContactSync.enabled,
      topicIdValid: /^\d+$/.test(getZohoTopicId())
    });
    if (!isolation.allowed) {
      return NextResponse.json({ error: "The exact-event maintenance window is not safely isolated." }, { status: 409 });
    }
    return NextResponse.json(await dispatchExactZohoOutboxEvent(approvedEvent.id));
  }
  if (config.exactEventDispatchEnabled) {
    return NextResponse.json({ error: "Generic batch dispatch is unavailable during exact-event maintenance." }, { status: 403 });
  }
  if (!getZohoTestConfiguration().enabled) {
    return NextResponse.json({ error: "Legacy Zoho test dispatch is disabled." }, { status: 403 });
  }
  if (body?.confirmation !== "DISPATCH ALLOWLISTED ZOHO TEST EVENTS") {
    return NextResponse.json({ error: "Explicit test dispatch confirmation is required." }, { status: 400 });
  }
  const requested = typeof body.maxEvents === "number" ? Math.trunc(body.maxEvents) : 1;
  return NextResponse.json(await dispatchZohoOutboxBatch({ maxEvents: Math.max(1, Math.min(10, requested)) }));
}
