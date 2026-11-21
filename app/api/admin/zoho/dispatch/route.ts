import { NextResponse } from "next/server";
import { getAdminApiAuthError, getSensitiveAdminApiAuthError } from "@/lib/admin-auth";
import { getZohoConfigurationStatus, getZohoDispatchConfiguration, getZohoTopicId } from "@/lib/zoho-config";
import { dispatchExactZohoOutboxEvent, dispatchZohoOutboxBatch, getZohoDispatcherSummary } from "@/lib/zoho-dispatcher";
import { getExistingFullFieldTestIntent } from "@/lib/zoho-existing-plan-test-intent";

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
      body.confirmation !== "DISPATCH ONE ALLOWLISTED FULL-FIELD TEST EVENT" ||
      typeof body.eventId !== "string" ||
      typeof body.planId !== "string"
    ) {
      return NextResponse.json({ error: "Exact event, plan, and full-field test confirmation are required." }, { status: 400 });
    }
    const approvedEvent = await getExistingFullFieldTestIntent(body.planId);
    if (!approvedEvent || approvedEvent.id !== body.eventId) {
      return NextResponse.json({ error: "The requested event is not the exact configured full-field test intent." }, { status: 403 });
    }
    const posture = getZohoConfigurationStatus();
    if (
      config.globalKillSwitch ||
      !config.contactSyncEnabled ||
      config.automaticDispatchEnabled ||
      config.journeyTriggeringEnabled ||
      config.productionApproved ||
      posture.eventEmissionEnabled ||
      !posture.fieldMappingVerified ||
      !posture.listKeyPresent ||
      !posture.listPrivacyVerified ||
      posture.mspEnrollmentContactSyncEnabled ||
      posture.nudgeEvaluationEnabled ||
      !posture.oauthConfigured ||
      posture.singleContactPilotEnabled ||
      posture.testContactSync.enabled ||
      !/^\d+$/.test(getZohoTopicId()) ||
      !posture.testMode.enabled ||
      posture.testMode.allowlistedEmailCount !== 1 ||
      posture.testMode.allowlistedPlanCount !== 1
    ) {
      return NextResponse.json({ error: "The exact-event maintenance window is not safely isolated." }, { status: 409 });
    }
    return NextResponse.json(await dispatchExactZohoOutboxEvent(approvedEvent.id));
  }
  if (body?.confirmation !== "DISPATCH ALLOWLISTED ZOHO TEST EVENTS") {
    return NextResponse.json({ error: "Explicit test dispatch confirmation is required." }, { status: 400 });
  }
  const requested = typeof body.maxEvents === "number" ? Math.trunc(body.maxEvents) : 1;
  return NextResponse.json(await dispatchZohoOutboxBatch({ maxEvents: Math.max(1, Math.min(10, requested)) }));
}
