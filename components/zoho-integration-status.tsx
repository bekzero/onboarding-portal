"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  ContactRound,
  RefreshCw,
  Route,
  Settings2,
  ShieldCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ContactOption = {
  automationEnabled: boolean;
  email: string;
  firstName: string | null;
  id: string;
};

type StatusPayload = {
  configuration: {
    automaticDispatchEnabled: boolean;
    contactSynchronizationEnabled: boolean;
    dispatchMode: string;
    eventEmissionEnabled: boolean;
    exactEventDispatchEnabled: boolean;
    exactEventAllowlistedCount: number;
    fieldMappingVerified: boolean;
    globalKillSwitch: boolean;
    journeyTriggeringEnabled: boolean;
    journeys: Record<string, { journeyKeyPresent: boolean; triggerKeyPresent: boolean }>;
    listKeyPresent: boolean;
    listPrivacyVerified: boolean;
    mspEnrollmentContactSyncEnabled: boolean;
    mspEnrollmentPilotTargetConfigured: boolean;
    nudgeEvaluationEnabled: boolean;
    oauthConfigured: boolean;
    productionDispatchApproved: boolean;
    singleContactPilotEnabled: boolean;
    testContactSync: { enabled: boolean };
    testJ1EnrollmentEnabled: boolean;
    testMode: { allowlistedEmailCount: number; allowlistedPlanCount: number; enabled: boolean };
    topicIdPresent: boolean;
  };
  lastFieldDiscovery: { createdAt: string; reason: string } | null;
  lastJourneyDiscovery: { createdAt: string; reason: string } | null;
  lastTestResult: { action: string; createdAt: string; reason: string } | null;
};

type PreviewPayload = {
  fieldCount: number;
  planId: string;
  previewFingerprint: string;
  recipient: string;
  warnings: string[];
};

type PlanAutomationSummary = {
  administrativeControls: {
    canManage: boolean;
    communicationContextAssigned: boolean;
    listPrivacyEvidenceAt: string | null;
    listPrivacyEvidenceSource: string;
    listPrivacyVerified: boolean;
    planAndOwnerApproved: boolean;
  };
  automationEnrollmentState: string;
  communicationContext: { activePlanId: string | null; state: string } | null;
  enrollmentContactSync: {
    event: { createdAt: string; holdReason: string | null; status: string } | null;
    individuallyAttributable: boolean;
    mspName: string;
    permissionAttested: boolean;
    permissionEvidencePresent: boolean;
    permissionEvidenceReference: string | null;
    permissionRecordedAt: string | null;
    primaryContactEmail: string;
    primaryContactMatchesOwner: boolean;
    controlledPilot: {
      destinationList: string;
      downstreamAutomationReview: {
        evidenceReference: string | null;
        reviewedAt: string;
        result: "ACTIVE_AUTOMATION_FOUND" | "NO_UNINTENDED_AUTOMATION";
      } | null;
      downstreamAutomationVerified: boolean;
      enabled: boolean;
      executionAuthorized: boolean;
      lastAttemptAt: string | null;
      lastOutcome: string | null;
      lastVerificationAt: string | null;
      readiness: { blockers: string[]; canExecute: boolean; canPreview: boolean; verificationOnly: boolean };
      subscriptionConfirmation: { evidenceReference: string | null; recordedAt: string } | null;
      targetEmail: string;
      targetMsp: string;
    } | null;
    fullFieldTestIntent: {
      attemptCount: number;
      createdAt: string;
      holdReason: string | null;
      id: string;
      lastProviderOutcome: string | null;
      status: string;
      updatedAt: string;
    } | null;
    testJ1LifecycleEvents: Array<{
      attemptCount: number;
      createdAt: string;
      eventType: "UPSERT_CONTACT" | "TRIGGER_JOURNEY";
      holdReason: string | null;
      id: string;
      journey: "J1" | null;
      lastProviderOutcome: string | null;
      planId: string;
      recipientEmailNormalized: string;
      status: string;
      updatedAt: string;
    }>;
    pilotReadiness: {
      blockers: string[];
      candidateEligible: boolean;
      classification: string;
      liveSynchronizationAvailable: false;
    };
    readiness: {
      blockers: string[];
      classification: string;
      eligibleIfEnabled: boolean;
      flagBlockers: string[];
      wouldPrepareNow: boolean;
    };
    staffIdentityVerified: boolean;
    synchronizationState: string;
  };
  failedEventCount: number;
  heldEventCount: number;
  lastJourneyOutcome: { journey: string; providerResult: string } | null;
  lastSuccessfulContactSync: { updatedAt: string } | null;
  nudge: { status: string; taskKey: string | null };
  readiness: { status: string; readyForDataSync: boolean; readyForJourneyEnrollment: boolean } | null;
  subscriptionStatus: string | null;
};

type BlockerCategory = "contact" | "identity" | "plan" | "context" | "provider" | "flags";
type BlockerKind = "action" | "intentional" | "unverified";
type ZohoCaseSection = "overview" | "contact-sync" | "journeys" | "advanced";

const zohoCaseSections: Array<{
  description: string;
  icon: typeof Activity;
  id: ZohoCaseSection;
  label: string;
}> = [
  { description: "Safety and current state", icon: Activity, id: "overview", label: "Overview" },
  { description: "Eligibility and outcomes", icon: ContactRound, id: "contact-sync", label: "Contact Sync" },
  { description: "Journey holds", icon: Route, id: "journeys", label: "Journeys" },
  { description: "Restricted tools", icon: Settings2, id: "advanced", label: "Advanced" }
];

const journeyCatalog = [
  {
    dependencies: ["Next Task Tip and Guide URL are verified not used"],
    id: "J1",
    name: "Welcome and Kickoff Booking"
  },
  {
    dependencies: ["Current Next Task Tip required", "Current approved Guide URL required"],
    id: "J3_R1",
    name: "Next Action Nudge"
  },
  {
    dependencies: ["Current Next Task Tip required", "Guide usage remains unverified and fail-closed"],
    id: "J5",
    name: "Your Next Step Is Ready"
  },
  {
    dependencies: ["Task Tip and Guide are verified not used"],
    id: "J8",
    name: "Completion and Expansion"
  }
] as const;

const blockerCopy: Record<string, { category: BlockerCategory; kind: BlockerKind; label: string }> = {
  AUTOMATION_APPROVAL_REQUIRED: { category: "plan", kind: "action", label: "Approve automation for the plan and Onboarding Owner contact." },
  COMMUNICATION_CONTEXT_REQUIRED: { category: "context", kind: "action", label: "Assign this plan as the active communication context for the contact." },
  CONTACT_PERMISSION_NOT_DOCUMENTED: { category: "contact", kind: "action", label: "Record appropriate contact permission and its supporting evidence." },
  CONTACT_SYNCHRONIZATION_DISABLED: { category: "flags", kind: "intentional", label: "Contact synchronization is intentionally disabled." },
  EVENT_EMISSION_DISABLED: { category: "flags", kind: "intentional", label: "Zoho event preparation is intentionally disabled." },
  EMAIL_ONLY_PROVIDER_CONFIGURATION_INCOMPLETE: { category: "provider", kind: "unverified", label: "Configure OAuth and the KZero Partner Onboarding ListKey for email-only list synchronization." },
  GLOBAL_KILL_SWITCH_ENABLED: { category: "flags", kind: "intentional", label: "The global Zoho kill switch is enabled." },
  INDIVIDUAL_STAFF_IDENTITY_REQUIRED: { category: "identity", kind: "action", label: "Sign in with an individually attributable staff identity." },
  INVALID_PRIMARY_CONTACT: { category: "contact", kind: "action", label: "Make the primary MSP contact match a valid Onboarding Owner email." },
  MSP_ENROLLMENT_SYNC_DISABLED: { category: "flags", kind: "intentional", label: "MSP enrollment contact-sync preparation is intentionally disabled." },
  LIST_PRIVACY_UNVERIFIED: { category: "provider", kind: "unverified", label: "Verify that the selected KZero Partner Onboarding mailing list has the approved privacy setting." },
  PILOT_TARGET_NOT_ALLOWLISTED: { category: "contact", kind: "intentional", label: "This plan and primary contact are not the single server-side pilot target." },
  PILOT_TARGET_NOT_CONFIGURED: { category: "contact", kind: "intentional", label: "No single MSP pilot target is configured server-side." },
  PERMISSION_EVIDENCE_MISSING: { category: "contact", kind: "action", label: "Add a permission evidence reference for the primary contact." },
  PRODUCTION_DISPATCH_NOT_APPROVED: { category: "flags", kind: "intentional", label: "Production dispatch has not been approved." },
  PROVIDER_CONFIGURATION_INCOMPLETE: { category: "provider", kind: "unverified", label: "Complete and verify the required Zoho provider configuration." },
  RECIPIENT_INELIGIBLE: { category: "contact", kind: "action", label: "The contact is unsubscribed, bounced, suppressed, or otherwise ineligible." },
  UNRESOLVED_ENROLLMENT_EVENT: { category: "plan", kind: "action", label: "Resolve the existing enrollment outbox event before considering a pilot." },
  GLOBAL_KILL_SWITCH_MUST_REMAIN_ENABLED: { category: "flags", kind: "intentional", label: "Phase 7B.6A requires the global kill switch to remain enabled." },
  AUTOMATIC_DISPATCH_MUST_REMAIN_DISABLED: { category: "flags", kind: "intentional", label: "Phase 7B.6A requires automatic dispatch to remain disabled." },
  AUTOMATIC_PATH_ISOLATION_REQUIRED: { category: "flags", kind: "intentional", label: "Every automatic Zoho path and dispatch mode must remain disabled for the manual pilot." },
  DOWNSTREAM_AUTOMATION_UNVERIFIED: { category: "provider", kind: "unverified", label: "Verify in Zoho that list entry has no active journey, workflow, campaign, or email side effect." },
  PILOT_EXECUTION_ALREADY_RESERVED: { category: "plan", kind: "intentional", label: "The durable one-shot execution is already reserved; only membership verification is permitted." },
  SINGLE_CONTACT_PILOT_DISABLED: { category: "flags", kind: "intentional", label: "The manual single-contact pilot is disabled." },
  SUBSCRIPTION_STATUS_UNVERIFIED: { category: "contact", kind: "unverified", label: "Subscription eligibility must be explicitly verified as CONFIRMED before execution." },
  PILOT_SUBSCRIPTION_EVIDENCE_REQUIRED: { category: "contact", kind: "unverified", label: "Record independently supportable authorization for this exact private-list addition." }
};

const categoryLabels: Record<BlockerCategory, string> = {
  contact: "Contact and permission",
  identity: "Staff identity",
  plan: "Plan and onboarding readiness",
  context: "Communication context",
  provider: "Provider configuration",
  flags: "Automation feature flags"
};

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function displayStatus(classification: string) {
  if (classification === "READY_FOR_PREPARATION") return { label: "Ready", tone: "complete" as const, icon: CheckCircle2 };
  if (classification === "ALREADY_SYNCHRONIZED") return { label: "Already Synchronized", tone: "complete" as const, icon: CheckCircle2 };
  if (classification === "AUTOMATION_DISABLED") return { label: "Disabled", tone: "in_progress" as const, icon: CircleOff };
  if (classification === "UNABLE_TO_VERIFY") return { label: "Unable to Verify", tone: "waiting_on_kzero" as const, icon: AlertTriangle };
  return { label: "Needs Attention", tone: "waiting_on_msp" as const, icon: AlertTriangle };
}

function kindLabel(kind: BlockerKind) {
  if (kind === "intentional") return "Intentional safeguard";
  if (kind === "unverified") return "Verification required";
  return "Administrator action";
}

export function ZohoIntegrationStatus({ contacts, planId }: { contacts: ContactOption[]; planId: string }) {
  const eligibleContacts = contacts.filter((contact) => contact.automationEnabled);
  const [activeSection, setActiveSection] = useState<ZohoCaseSection>("overview");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [planSummary, setPlanSummary] = useState<PlanAutomationSummary | null>(null);
  const [selectedContactId, setSelectedContactId] = useState(eligibleContacts[0]?.id ?? "");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [readinessControlMessage, setReadinessControlMessage] = useState<string | null>(null);
  const [fullFieldIntentMessage, setFullFieldIntentMessage] = useState<string | null>(null);
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<string | null>(null);
  const [pilotPreview, setPilotPreview] = useState<{
    membership: { complete: boolean; statuses: string[] } | null;
    outcome: string | null;
    previewedAt: string;
  } | null>(null);
  const [pilotMessage, setPilotMessage] = useState<string | null>(null);
  const [subscriptionEvidenceReference, setSubscriptionEvidenceReference] = useState("");
  const [subscriptionAuthorizationBasis, setSubscriptionAuthorizationBasis] = useState("");
  const [subscriptionEvidenceConfirmed, setSubscriptionEvidenceConfirmed] = useState(false);
  const [downstreamEvidenceReference, setDownstreamEvidenceReference] = useState("");
  const [downstreamReviewComplete, setDownstreamReviewComplete] = useState(false);
  const [downstreamReviewResult, setDownstreamReviewResult] = useState<"" | "ACTIVE_AUTOMATION_FOUND" | "NO_UNINTENDED_AUTOMATION">("");
  const [downstreamReviewedItems, setDownstreamReviewedItems] = useState<Record<string, boolean>>({});
  const [successorPlanId, setSuccessorPlanId] = useState("");
  const [contextRetirementReason, setContextRetirementReason] = useState("");
  const [contactVerificationEvidence, setContactVerificationEvidence] = useState("");
  const [subscriptionVerificationReason, setSubscriptionVerificationReason] = useState("");
  const [subscriptionVerificationEvidence, setSubscriptionVerificationEvidence] = useState("");

  const loadDetails = useCallback(async () => {
    const [statusResponse, planResponse] = await Promise.all([
      fetch(`/api/admin/zoho/status?planId=${encodeURIComponent(planId)}`, { cache: "no-store" }),
      fetch(`/api/admin/zoho/automation/plans/${encodeURIComponent(planId)}`, { cache: "no-store" })
    ]);
    const statusPayload = (await statusResponse.json().catch(() => null)) as (StatusPayload & { error?: string }) | null;
    const planPayload = (await planResponse.json().catch(() => null)) as (PlanAutomationSummary & { error?: string }) | null;
    if (statusResponse.ok && statusPayload) setStatus(statusPayload);
    if (planResponse.ok && planPayload) setPlanSummary(planPayload);
    if (!planResponse.ok || !planPayload) throw new Error(planPayload?.error ?? "Could not load enrollment synchronization readiness.");
    if (!statusResponse.ok || !statusPayload) throw new Error(statusPayload?.error ?? "Could not load Zoho configuration status.");
  }, [planId]);

  useEffect(() => {
    void loadDetails().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load Zoho readiness."));
  }, [loadDetails]);

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      throw new Error(typeof payload?.error === "string" ? payload.error : "Zoho operation failed.");
    }
    return payload;
  }

  async function runDiscovery() {
    setBusy(true);
    setError(null);
    setOperationMessage(null);
    try {
      await post("/api/admin/zoho/discover", { operation: "all" });
      setOperationMessage("Read-only field and journey discovery completed.");
      await loadDetails();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Discovery failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createPreview() {
    if (!selectedContactId) return;
    setBusy(true);
    setError(null);
    setOperationMessage(null);
    setPreview(null);
    setConfirmed(false);
    try {
      setPreview(await post("/api/admin/zoho/test-sync/preview", { contactId: selectedContactId, planId }) as unknown as PreviewPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function performTestSync() {
    if (!preview || !confirmed) return;
    setBusy(true);
    setError(null);
    setOperationMessage(null);
    try {
      const result = await post("/api/admin/zoho/test-sync", {
        confirmation: "ADD ALLOWLISTED TEST EMAIL",
        contactId: selectedContactId,
        planId,
        previewFingerprint: preview.previewFingerprint
      });
      setPreview(null);
      setConfirmed(false);
      setOperationMessage(`Zoho test request: ${String(result.classification ?? "accepted")}. This does not confirm delivery or journey eligibility.`);
      await loadDetails();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test synchronization failed.");
    } finally {
      setBusy(false);
    }
  }

  async function checkMembership() {
    const contact = eligibleContacts.find((item) => item.id === selectedContactId);
    if (!contact) return;
    setBusy(true);
    setError(null);
    setOperationMessage(null);
    try {
      const result = await post("/api/admin/zoho/subscription-check", { email: contact.email });
      const statuses = Array.isArray(result.listStatuses) ? result.listStatuses.join(", ") || "not found" : "unknown";
      setOperationMessage(`List membership: ${statuses}. Topic and Marketing eligibility still require manual ZMA verification.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Membership check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function evaluateEnrollmentSync() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/zoho/automation/plans/${encodeURIComponent(planId)}`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as {
        enrollmentContactSync?: PlanAutomationSummary["enrollmentContactSync"];
        error?: string;
        evaluatedAt?: string;
      } | null;
      if (!response.ok || !payload?.enrollmentContactSync) {
        throw new Error(payload?.error ?? "Could not evaluate enrollment contact synchronization.");
      }
      setPlanSummary((current) => current ? { ...current, enrollmentContactSync: payload.enrollmentContactSync! } : current);
      setLastEvaluatedAt(payload.evaluatedAt ?? new Date().toISOString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enrollment synchronization evaluation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runReadinessControl(
    action: "APPROVE_AUTOMATION" | "ASSIGN_CONTEXT" | "CONFIRM_SUBSCRIPTION" | "VERIFY_LIST_PRIVACY" | "VERIFY_DOWNSTREAM_AUTOMATION" | "RETIRE_CONTEXT_FOR_TEST_SUCCESSOR" | "RESTORE_RETIRED_CONTEXT" | "VERIFY_TEST_J1_CONTACT_VALUES",
    confirmation: string,
    details: Record<string, unknown> = {}
  ) {
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    setError(null);
    setReadinessControlMessage(null);
    try {
      const response = await fetch(
        `/api/admin/zoho/automation/plans/${encodeURIComponent(planId)}/readiness-controls`,
        {
          body: JSON.stringify({ ...details, action, confirmed: true }),
          headers: { "content-type": "application/json" },
          method: "POST"
        }
      );
      const payload = (await response.json().catch(() => null)) as {
        changed?: boolean;
        error?: string;
        summary?: PlanAutomationSummary;
      } | null;
      if (!response.ok || !payload?.summary) {
        throw new Error(payload?.error ?? "The readiness setting could not be updated.");
      }
      setPlanSummary(payload.summary);
      setReadinessControlMessage(
        payload.changed
          ? "Readiness state updated and audited. No event or Zoho write was created."
          : "The requested readiness state was already satisfied; no duplicate change was recorded."
      );
      await loadDetails();
      setLastEvaluatedAt(new Date().toISOString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The readiness setting could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function previewControlledPilot() {
    setBusy(true);
    setError(null);
    setPilotMessage(null);
    try {
      const payload = await post(`/api/admin/zoho/automation/plans/${encodeURIComponent(planId)}/pilot/preview`, {});
      setPilotPreview(payload as unknown as typeof pilotPreview);
      setPilotMessage("Read-only preview completed. No reservation, outbox event, or provider write was created.");
      await loadDetails();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The controlled pilot preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runControlledPilot() {
    const confirmation = window.prompt(
      "This will attempt to add exactly one configured contact to the private KZero Partner Onboarding list. Enter RUN SINGLE-CONTACT ZOHO PILOT to continue."
    );
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    setPilotMessage(null);
    try {
      const result = await post(`/api/admin/zoho/automation/plans/${encodeURIComponent(planId)}/pilot/execute`, { confirmation });
      setPilotMessage(`Pilot result: ${String(result.outcome ?? "UNABLE_TO_VERIFY")}. A provider acceptance alone is not reported as verified.`);
      await loadDetails();
      await previewControlledPilot();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The controlled pilot could not run.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareFullFieldTestIntent() {
    const confirmation = window.prompt(
      "This prepares one durable full-field contact-sync intent but does not send it. Enter PREPARE ONE FULL-FIELD ZOHO TEST INTENT to continue."
    );
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    setFullFieldIntentMessage(null);
    try {
      const result = await post(
        `/api/admin/zoho/automation/plans/${encodeURIComponent(planId)}/full-field-test-intent`,
        { confirmation }
      );
      setFullFieldIntentMessage(
        result.created
          ? "One audited full-field UPSERT_CONTACT intent was prepared. No provider request or journey was triggered."
          : "The exact test intent already exists; no duplicate event or provider request was created."
      );
      await loadDetails();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The full-field test intent could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function dispatchFullFieldTestIntent() {
    const event = planSummary?.enrollmentContactSync.fullFieldTestIntent;
    if (!event) return;
    const confirmation = window.prompt(
      "This will dispatch only the displayed full-field test intent. Enter DISPATCH ONE ALLOWLISTED FULL-FIELD TEST EVENT to continue."
    );
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    setFullFieldIntentMessage(null);
    try {
      const result = await post("/api/admin/zoho/dispatch", {
        confirmation,
        eventId: event.id,
        planId
      });
      setFullFieldIntentMessage(
        result.completed
          ? "The exact event was processed. Review its sanitized provider outcome and verify every field in Zoho before treating the test as successful."
          : "The exact event was not dispatched. Review the event ordering and maintenance-window safeguards."
      );
      await loadDetails();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The exact full-field event could not be dispatched.");
    } finally {
      setBusy(false);
    }
  }

  async function dispatchTestJ1LifecycleEvent(event: PlanAutomationSummary["enrollmentContactSync"]["testJ1LifecycleEvents"][number]) {
    const phrase = event.eventType === "UPSERT_CONTACT"
      ? "DISPATCH ONE ALLOWLISTED TEST J1 CONTACT EVENT"
      : "DISPATCH ONE ALLOWLISTED TEST J1 JOURNEY EVENT";
    const confirmation = window.prompt(`This processes only event ${event.id}. Enter ${phrase} to continue.`);
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    setFullFieldIntentMessage(null);
    try {
      const result = await post("/api/admin/zoho/dispatch", { confirmation, eventId: event.id, planId });
      setFullFieldIntentMessage(result.completed
        ? "The exact TEST J1 event was processed. Independently verify the sanitized outcome before continuing."
        : "The exact TEST J1 event was not dispatched; inspect sequencing and maintenance safeguards.");
      await loadDetails();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The exact TEST J1 event could not be dispatched.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyTestJ1Subscription() {
    const contact = eligibleContacts.find((item) => item.id === selectedContactId) ?? eligibleContacts[0];
    if (!contact || !window.confirm("Record CONFIRMED subscription eligibility for this exact plan contact and release only its held TEST J1 event?")) return;
    setBusy(true);
    setError(null);
    setReadinessControlMessage(null);
    try {
      await post("/api/admin/zoho/verify-subscription", {
        contactId: contact.id,
        evidenceReference: subscriptionVerificationEvidence,
        planId,
        reason: subscriptionVerificationReason,
        status: "CONFIRMED"
      });
      setReadinessControlMessage("Subscription eligibility was audited. The allowlisted held TEST J1 event may now be pending; no provider request was made.");
      await loadDetails();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Subscription eligibility could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  const blockerGroups = useMemo(() => {
    const groups = new Map<BlockerCategory, Array<{ code: string; kind: BlockerKind; label: string }>>();
    for (const code of planSummary?.enrollmentContactSync.readiness.blockers ?? []) {
      const copy = blockerCopy[code] ?? { category: "provider" as const, kind: "unverified" as const, label: humanize(code) };
      const rows = groups.get(copy.category) ?? [];
      if (!rows.some((row) => row.code === code)) rows.push({ code, kind: copy.kind, label: copy.label });
      groups.set(copy.category, rows);
    }
    return Array.from(groups.entries());
  }, [planSummary]);

  const readiness = planSummary?.enrollmentContactSync.readiness;
  const pilotReadiness = planSummary?.enrollmentContactSync.pilotReadiness;
  const controlledPilot = planSummary?.enrollmentContactSync.controlledPilot;
  const fullFieldTestIntent = planSummary?.enrollmentContactSync.fullFieldTestIntent;
  const testJ1LifecycleEvents = planSummary?.enrollmentContactSync.testJ1LifecycleEvents ?? [];
  const exactDispatchBase = Boolean(
    status &&
    !status.configuration.globalKillSwitch &&
    status.configuration.dispatchMode === "test" &&
    status.configuration.contactSynchronizationEnabled &&
    status.configuration.fieldMappingVerified &&
    status.configuration.listKeyPresent &&
    status.configuration.listPrivacyVerified &&
    status.configuration.oauthConfigured &&
    status.configuration.topicIdPresent &&
    !status.configuration.eventEmissionEnabled &&
    !status.configuration.automaticDispatchEnabled &&
    !status.configuration.productionDispatchApproved &&
    !status.configuration.mspEnrollmentContactSyncEnabled &&
    !status.configuration.nudgeEvaluationEnabled &&
    !status.configuration.singleContactPilotEnabled &&
    !status.configuration.testContactSync.enabled &&
    !status.configuration.testJ1EnrollmentEnabled &&
    status.configuration.exactEventDispatchEnabled &&
    status.configuration.exactEventAllowlistedCount === 1 &&
    !status.configuration.testMode.enabled &&
    status.configuration.testMode.allowlistedEmailCount === 1 &&
    status.configuration.testMode.allowlistedPlanCount === 1
  );
  const exactDispatchWindow = exactDispatchBase && !status?.configuration.journeyTriggeringEnabled;
  const exactJourneyDispatchWindow = exactDispatchBase && status?.configuration.journeyTriggeringEnabled === true;
  const primaryStatus = displayStatus(readiness?.classification ?? "UNABLE_TO_VERIFY");
  const PrimaryIcon = primaryStatus.icon;
  const configuredJourneys = status
    ? Object.values(status.configuration.journeys).filter((journey) => journey.journeyKeyPresent && journey.triggerKeyPresent).length
    : 0;

  return (
    <div className="grid min-w-0 gap-4">
      <div className="sticky -top-4 z-10 -mx-1 border-b border-border bg-surface/95 px-1 pb-3 pt-1 backdrop-blur md:-top-6" aria-label="Zoho case sections">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist">
          {zohoCaseSections.map((section, index) => {
            const Icon = section.icon;
            const selected = activeSection === section.id;
            return (
              <button
                aria-controls={`zoho-case-panel-${section.id}`}
                aria-selected={selected}
                className={`flex min-h-14 min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  selected
                    ? "border-primary/40 bg-primary/15 text-foreground"
                    : "border-transparent text-secondary hover:border-border hover:bg-input hover:text-foreground"
                }`}
                id={`zoho-case-tab-${section.id}`}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const nextIndex = event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? zohoCaseSections.length - 1
                      : (index + (event.key === "ArrowRight" ? 1 : -1) + zohoCaseSections.length) % zohoCaseSections.length;
                  const next = zohoCaseSections[nextIndex];
                  setActiveSection(next.id);
                  document.getElementById(`zoho-case-tab-${next.id}`)?.focus();
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{section.label}</span>
                  <span className="block truncate text-[11px] text-muted">{section.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error ? <p className="break-words rounded-xl border border-danger-border/60 bg-danger-surface px-3 py-2 text-sm text-danger" role="alert">{error}</p> : null}

      <section
        aria-labelledby="zoho-case-tab-overview"
        className={activeSection === "overview" ? "grid min-w-0 gap-4" : "hidden"}
        id="zoho-case-panel-overview"
        role="tabpanel"
      >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted">MSP-specific Zoho readiness</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PrimaryIcon className="h-5 w-5 text-primary" />
            <h4 className="text-xl font-semibold text-foreground">{primaryStatus.label}</h4>
            <Badge status={primaryStatus.tone}>{primaryStatus.label}</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">
            {readiness?.classification === "READY_FOR_PREPARATION"
              ? "Current case requirements are satisfied. Event preparation and dispatch still require separate explicit enablement."
              : readiness?.classification === "ALREADY_SYNCHRONIZED"
                ? "The existing outbox history records a successful synchronization for this enrollment identity."
                : readiness?.classification === "AUTOMATION_DISABLED"
                  ? "Case eligibility is evaluated, but intentional system safeguards prevent preparation or dispatch."
                  : "Review the items below before this contact can be considered for synchronization."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-input p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Safety state</p>
          <div className="mt-2 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><p className="font-semibold text-foreground">{!status ? "Loading" : status.configuration.globalKillSwitch ? "Disabled" : "Maintenance mode"}</p></div>
          <p className="mt-1 text-xs leading-5 text-secondary">{!status ? "Checking authoritative configuration" : status.configuration.globalKillSwitch ? "Global kill switch enabled" : `Dispatch mode: ${status.configuration.dispatchMode}`}</p>
        </div>
        <div className="rounded-xl border border-border bg-input p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Contact sync</p>
          <p className="mt-2 font-semibold text-foreground">{fullFieldTestIntent?.status ? humanize(fullFieldTestIntent.status) : humanize(planSummary?.enrollmentContactSync.synchronizationState ?? "not prepared")}</p>
          <p className="mt-1 text-xs leading-5 text-secondary">{fullFieldTestIntent ? `${fullFieldTestIntent.attemptCount} provider attempt${fullFieldTestIntent.attemptCount === 1 ? "" : "s"}` : "No full-field intent recorded"}</p>
        </div>
        <div className="rounded-xl border border-border bg-input p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Latest outcome</p>
          <p className="mt-2 font-semibold text-foreground">{fullFieldTestIntent?.lastProviderOutcome ? humanize(fullFieldTestIntent.lastProviderOutcome) : planSummary?.lastSuccessfulContactSync ? "Succeeded" : "No provider outcome"}</p>
          <p className="mt-1 text-xs leading-5 text-secondary">Provider acceptance is not independent field verification.</p>
        </div>
        <div className="rounded-xl border border-border bg-input p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Plan and recipient</p>
          <p className="mt-2 truncate font-semibold text-foreground">{planSummary?.enrollmentContactSync.mspName ?? planId}</p>
          <p className="mt-1 break-all text-xs leading-5 text-secondary">{planSummary?.enrollmentContactSync.primaryContactEmail ?? "Recipient unavailable"}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-input p-4">
        <div className="flex items-center justify-between gap-3"><h5 className="text-sm font-semibold text-foreground">Important blockers</h5><span className="text-xs text-muted">{readiness?.blockers.length ?? 0} total</span></div>
        {readiness?.blockers.length ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {readiness.blockers.slice(0, 4).map((code) => <li className="flex min-w-0 items-start gap-2 text-sm leading-5 text-secondary" key={code}><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span className="break-words">{blockerCopy[code]?.label ?? humanize(code)}</span></li>)}
          </ul>
        ) : <p className="mt-2 text-sm text-secondary">No case-level readiness blockers were reported. Operational feature flags remain authoritative.</p>}
        {(readiness?.blockers.length ?? 0) > 4 ? <button className="mt-3 text-xs font-medium text-primary hover:underline" onClick={() => setActiveSection("advanced")} type="button">View all blockers in Advanced</button> : null}
      </div>

      </section>

      <section
        aria-labelledby="zoho-case-tab-contact-sync"
        className={activeSection === "contact-sync" ? "grid min-w-0 gap-4" : "hidden"}
        id="zoho-case-panel-contact-sync"
        role="tabpanel"
      >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Contact synchronization</p>
          <h4 className="mt-1 text-lg font-semibold text-foreground">Eligibility, preview, and outcomes</h4>
          <p className="mt-1 text-sm leading-6 text-secondary">Evaluate current persisted state and inspect provider outcomes. Opening this section never creates work or contacts Zoho.</p>
        </div>
        <Button className="h-10 shrink-0" disabled={busy || !planSummary} onClick={() => void evaluateEnrollmentSync()}>
          <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Evaluating..." : "Evaluate Zoho Sync"}
        </Button>
      </div>
      {lastEvaluatedAt ? (
        <p className="rounded-xl border border-success-border/50 bg-success-surface px-3 py-2 text-xs leading-5 text-success">
          Evaluated {new Date(lastEvaluatedAt).toLocaleString()}. No event or provider request was created.
        </p>
      ) : null}

      <section className="rounded-xl border border-border bg-input p-4" aria-labelledby="zoho-pilot-readiness-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-muted">Phase 7B.6A · preview only</p>
            <h5 className="mt-1 text-sm font-semibold text-foreground" id="zoho-pilot-readiness-heading">Single-contact pilot readiness</h5>
            <p className="mt-1 text-xs leading-5 text-secondary">
              Evaluates this MSP against one server-side plan and email allowlist. It cannot create an event or contact Zoho.
            </p>
          </div>
          <Badge status={pilotReadiness?.candidateEligible ? "complete" : "waiting_on_kzero"}>
            {pilotReadiness?.candidateEligible ? "Eligible for future pilot" : pilotReadiness?.classification === "ALREADY_SYNCHRONIZED" ? "Already synchronized" : "Not eligible"}
          </Badge>
        </div>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted">Selected MSP</dt><dd className="mt-1 truncate text-foreground">{planSummary?.enrollmentContactSync.mspName ?? "Unavailable"}</dd></div>
          <div><dt className="text-muted">Primary contact</dt><dd className="mt-1 break-all text-foreground">{planSummary?.enrollmentContactSync.primaryContactEmail ?? "Unavailable"}</dd></div>
          <div><dt className="text-muted">Current staff</dt><dd className="mt-1 text-foreground">{pilotReadiness?.blockers.includes("INDIVIDUAL_ADMIN_IDENTITY_REQUIRED") ? "ADMIN identity required" : "Individually authenticated ADMIN"}</dd></div>
          <div><dt className="text-muted">Email-only provider</dt><dd className="mt-1 text-foreground">{pilotReadiness?.blockers.includes("EMAIL_ONLY_PROVIDER_CONFIGURATION_INCOMPLETE") ? "Incomplete" : "OAuth and ListKey present"}</dd></div>
        </dl>
        {pilotReadiness?.blockers.length ? (
          <ul className="mt-3 grid gap-1 border-t border-border pt-3 text-xs leading-5 text-secondary sm:grid-cols-2">
            {pilotReadiness.blockers.map((code) => <li className="break-words" key={code}>• {blockerCopy[code]?.label ?? humanize(code)}</li>)}
          </ul>
        ) : null}
        <p className="mt-3 text-xs font-medium text-warning">No live Sync control is available in this phase. Production automation and the global kill switch remain authoritative.</p>
      </section>

      <section className="rounded-xl border border-border bg-input p-4" aria-labelledby="controlled-contact-sync-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-muted">Phase 7B.6B · dormant by default</p>
            <h5 className="mt-1 text-sm font-semibold text-foreground" id="controlled-contact-sync-heading">Controlled Contact Sync Pilot</h5>
            <p className="mt-1 text-xs leading-5 text-secondary">One server-selected MSP, one email, and one durable execution reservation. This does not use the outbox or enable automatic synchronization.</p>
          </div>
          <Badge status={controlledPilot?.executionAuthorized ? "complete" : "waiting_on_kzero"}>
            {controlledPilot?.executionAuthorized ? "Execution window authorized" : controlledPilot?.readiness.verificationOnly ? "Verification only" : "Not authorized"}
          </Badge>
        </div>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted">Selected MSP</dt><dd className="mt-1 text-foreground">{controlledPilot?.targetMsp ?? "Not configured"}</dd></div>
          <div><dt className="text-muted">Exact target</dt><dd className="mt-1 break-all text-foreground">{controlledPilot?.targetEmail ?? "Not configured"}</dd></div>
          <div><dt className="text-muted">Destination</dt><dd className="mt-1 text-foreground">{controlledPilot?.destinationList ?? "KZero Partner Onboarding"}</dd></div>
          <div><dt className="text-muted">Suppression check</dt><dd className="mt-1 text-foreground">{pilotPreview?.membership ? pilotPreview.membership.complete ? pilotPreview.membership.statuses.join(", ") || "No membership found" : "Incomplete" : "Preview required"}</dd></div>
          <div><dt className="text-muted">Previous attempt</dt><dd className="mt-1 text-foreground">{controlledPilot?.lastAttemptAt ? new Date(controlledPilot.lastAttemptAt).toLocaleString() : "None"}</dd></div>
          <div><dt className="text-muted">Previous outcome</dt><dd className="mt-1 text-foreground">{controlledPilot?.lastOutcome ?? "None"}</dd></div>
          <div><dt className="text-muted">Last verification</dt><dd className="mt-1 text-foreground">{pilotPreview?.previewedAt ? new Date(pilotPreview.previewedAt).toLocaleString() : controlledPilot?.lastVerificationAt ? new Date(controlledPilot.lastVerificationAt).toLocaleString() : "Never"}</dd></div>
          <div><dt className="text-muted">Subscription authorization</dt><dd className="mt-1 text-foreground">{controlledPilot?.subscriptionConfirmation ? "Evidence recorded" : planSummary?.subscriptionStatus === "INELIGIBLE" ? "Suppressed / ineligible" : "Evidence required"}</dd></div>
          <div><dt className="text-muted">Downstream Zoho automation</dt><dd className="mt-1 text-foreground">{controlledPilot?.downstreamAutomationVerified ? "Reviewed" : "Manual review required"}</dd></div>
        </dl>
        {controlledPilot?.readiness.blockers.length ? (
          <ul className="mt-3 grid gap-1 border-t border-border pt-3 text-xs leading-5 text-secondary sm:grid-cols-2">
            {controlledPilot.readiness.blockers.map((code) => <li className="break-words" key={code}>• {blockerCopy[code]?.label ?? humanize(code)}</li>)}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="h-9" disabled={busy || !controlledPilot?.readiness.canPreview} onClick={() => void previewControlledPilot()} variant="outline">Preview Sync</Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted">Preview is read-only. Restricted execution controls are isolated under Advanced.</p>
        {pilotMessage ? <p className="mt-3 rounded-xl border border-success-border/50 bg-success-surface px-3 py-2 text-xs leading-5 text-success">{pilotMessage}</p> : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-input p-3"><p className="text-xs uppercase tracking-[0.12em] text-muted">Subscription</p><p className="mt-2 text-sm font-semibold text-foreground">{planSummary?.subscriptionStatus ? humanize(planSummary.subscriptionStatus) : "Unavailable"}</p></div>
        <div className="rounded-xl border border-border bg-input p-3"><p className="text-xs uppercase tracking-[0.12em] text-muted">Permission</p><p className="mt-2 text-sm font-semibold text-foreground">{planSummary?.enrollmentContactSync.permissionEvidencePresent ? "Evidence recorded" : "Evidence required"}</p></div>
        <div className="rounded-xl border border-border bg-input p-3"><p className="text-xs uppercase tracking-[0.12em] text-muted">Last sync</p><p className="mt-2 text-sm font-semibold text-foreground">{planSummary?.lastSuccessfulContactSync ? new Date(planSummary.lastSuccessfulContactSync.updatedAt).toLocaleString() : "Never"}</p></div>
        <div className="rounded-xl border border-border bg-input p-3"><p className="text-xs uppercase tracking-[0.12em] text-muted">Full-field event</p><p className="mt-2 text-sm font-semibold text-foreground">{fullFieldTestIntent?.status ? humanize(fullFieldTestIntent.status) : "Not prepared"}</p><p className="mt-1 text-xs text-secondary">Attempts: {fullFieldTestIntent?.attemptCount ?? 0}</p></div>
      </div>

      <details className="rounded-xl border border-border bg-input">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Detailed sync diagnostics</summary>
        <div className="grid gap-2 border-t border-border px-4 py-4 text-xs text-secondary sm:grid-cols-2">
          <p>Synchronization state: <span className="text-foreground">{planSummary?.enrollmentContactSync.synchronizationState ?? "Unavailable"}</span></p>
          <p>Eligibility: <span className="text-foreground">{readiness?.eligibleIfEnabled ? "Eligible if explicitly enabled" : "Blocked"}</span></p>
          <p>Suppression scan: <span className="text-foreground">{pilotPreview?.membership?.complete ? pilotPreview.membership.statuses.join(", ") || "Complete; no membership found" : "Fresh preview required"}</span></p>
          <p>Provider outcome: <span className="text-foreground">{fullFieldTestIntent?.lastProviderOutcome ? humanize(fullFieldTestIntent.lastProviderOutcome) : "None"}</span></p>
          {fullFieldTestIntent ? <p className="break-all sm:col-span-2">Event ID: <span className="text-foreground">{fullFieldTestIntent.id}</span></p> : null}
        </div>
      </details>

      <Link className="inline-flex h-10 w-full items-center justify-center rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-hover sm:w-fit" href={`/admin/zoho?tab=events&plan=${encodeURIComponent(planId)}`}>
        View Contact Sync History <ChevronRight className="ml-1 h-4 w-4" />
      </Link>
      </section>

      <section
        aria-labelledby="zoho-case-tab-journeys"
        className={activeSection === "journeys" ? "grid min-w-0 gap-4" : "hidden"}
        id="zoho-case-panel-journeys"
        role="tabpanel"
      >
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Recognized journeys</p>
          <h4 className="mt-1 text-lg font-semibold text-foreground">Configuration and freshness holds</h4>
          <p className="mt-1 text-sm leading-6 text-secondary">These cards report configuration and known template dependencies. Runtime eligibility is still rechecked before every trigger.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {journeyCatalog.map((journey) => {
            const configuration = status?.configuration.journeys[journey.id];
            const configured = Boolean(configuration?.journeyKeyPresent && configuration?.triggerKeyPresent);
            const enabled = Boolean(status?.configuration.journeyTriggeringEnabled);
            const hold = !configured ? "Journey or trigger key is missing" : !enabled ? "Journey triggering is disabled" : "Runtime eligibility and freshness validation required";
            return (
              <article className="rounded-xl border border-border bg-input p-4" key={journey.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{journey.id.replace("_", "-")}</p><h5 className="mt-1 font-semibold text-foreground">{journey.name}</h5></div>
                  <Badge status={enabled && configured ? "waiting_on_kzero" : "in_progress"}>{enabled && configured ? "Runtime check" : "Disabled"}</Badge>
                </div>
                <dl className="mt-3 grid gap-2 text-xs">
                  <div className="flex justify-between gap-4"><dt className="text-muted">Configuration</dt><dd className="text-right text-foreground">{configured ? "Keys present" : "Incomplete"}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-muted">Hold reason</dt><dd className="max-w-[70%] text-right text-foreground">{hold}</dd></div>
                </dl>
                <div className="mt-3 border-t border-border pt-3"><p className="text-xs font-medium text-foreground">Freshness dependencies</p><ul className="mt-2 grid gap-1 text-xs leading-5 text-secondary">{journey.dependencies.map((dependency) => <li key={dependency}>• {dependency}</li>)}</ul></div>
              </article>
            );
          })}
        </div>
        <p className="rounded-xl border border-warning-border/50 bg-warning-surface px-3 py-2 text-xs leading-5 text-warning">Configured API connectivity does not mean a journey is active, eligible, or safe to trigger.</p>
      </section>

      <section
        aria-labelledby="zoho-case-tab-advanced"
        className={activeSection === "advanced" ? "grid min-w-0 gap-4" : "hidden"}
        id="zoho-case-panel-advanced"
        role="tabpanel"
      >
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Restricted administration</p>
          <h4 className="mt-1 text-lg font-semibold text-foreground">Advanced tools and audited controls</h4>
          <p className="mt-1 text-sm leading-6 text-secondary">These operations retain their existing confirmations, authorization checks, and feature-flag gates.</p>
        </div>

        <section className="rounded-xl border border-warning-border/60 bg-warning-surface/40 p-4" aria-labelledby="restricted-sync-actions-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h5 className="text-sm font-semibold text-foreground" id="restricted-sync-actions-heading">Restricted synchronization actions</h5><p className="mt-1 text-xs leading-5 text-secondary">Potentially write-capable operations. Server-side safeguards remain authoritative.</p></div><Badge status="waiting_on_msp">Explicit confirmation</Badge></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Controlled single-contact pilot</p>
              <p className="mt-2 text-sm text-foreground">{controlledPilot?.executionAuthorized ? "Execution window authorized" : "Not authorized"}</p>
              <p className="mt-1 text-xs leading-5 text-secondary">Requires a fresh complete preview and the exact server-selected target.</p>
              <Button className="mt-3 h-9" disabled={busy || !controlledPilot?.executionAuthorized || !pilotPreview?.membership?.complete || Boolean(pilotPreview.membership.statuses.length) || pilotPreview.outcome !== null} onClick={() => void runControlledPilot()}>Run Single-Contact Pilot</Button>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Full-field lifecycle test</p>
              <p className="mt-2 text-sm text-foreground">{fullFieldTestIntent ? `${humanize(fullFieldTestIntent.status)} · attempts ${fullFieldTestIntent.attemptCount}` : "No intent recorded"}</p>
              <p className="mt-1 text-xs leading-5 text-secondary">Preparation records durable work only; it never sends, subscribes, or triggers a journey.</p>
              {fullFieldTestIntent ? <p className="mt-1 break-all text-xs text-secondary">{fullFieldTestIntent.id}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2"><Button className="h-9" disabled={busy || !planSummary?.administrativeControls.canManage || Boolean(fullFieldTestIntent)} onClick={() => void prepareFullFieldTestIntent()} variant="outline">Prepare Full-Field Intent</Button><Button className="h-9" disabled={busy || !exactDispatchWindow || !fullFieldTestIntent || !["PENDING", "RETRY"].includes(fullFieldTestIntent.status)} onClick={() => void dispatchFullFieldTestIntent()}>Dispatch Exact Test Event</Button></div>
            </div>
          </div>
          {testJ1LifecycleEvents.length > 0 ? (
            <details className="mt-3 rounded-xl border border-border bg-surface">
              <summary className="cursor-pointer px-3 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                Allowlisted TEST J1 lifecycle events ({testJ1LifecycleEvents.length})
              </summary>
              <div className="grid gap-3 border-t border-border p-3">
                {testJ1LifecycleEvents.map((event) => {
                  const isJourney = event.eventType === "TRIGGER_JOURNEY";
                  const canDispatch = isJourney ? exactJourneyDispatchWindow : exactDispatchWindow;
                  return (
                    <div className="rounded-xl border border-border bg-input p-3" key={event.id}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{isJourney ? "TEST J1 Welcome journey" : "Full-field contact synchronization"}</p>
                          <p className="mt-1 break-all text-xs text-secondary">{event.id}</p>
                          <p className="mt-1 text-xs text-secondary">{humanize(event.status)} · attempts {event.attemptCount}{event.lastProviderOutcome ? ` · ${humanize(event.lastProviderOutcome)}` : ""}</p>
                        </div>
                        <Button className="h-9 shrink-0" disabled={busy || !canDispatch || !["PENDING", "RETRY"].includes(event.status)} onClick={() => void dispatchTestJ1LifecycleEvent(event)}>
                          {isJourney ? "Dispatch Exact J1 Event" : "Dispatch Exact Contact Event"}
                        </Button>
                      </div>
                      {!isJourney && event.status === "SUCCEEDED" ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                          <input aria-label="Independent contact field verification evidence" className="h-10 min-w-0 rounded-xl border border-border bg-surface px-3 text-sm text-foreground" onChange={(input) => setContactVerificationEvidence(input.target.value)} placeholder="Zoho contact/timeline evidence reference" value={contactVerificationEvidence} />
                          <Button
                            className="h-10"
                            disabled={busy || !planSummary?.administrativeControls.canManage || contactVerificationEvidence.trim().length < 8}
                            onClick={() => void runReadinessControl(
                              "VERIFY_TEST_J1_CONTACT_VALUES",
                              "Record independent field verification for this exact contact event? This does not release or dispatch J1.",
                              {
                                confirmation: "VERIFY EXACT TEST J1 CONTACT VALUES",
                                eventId: event.id,
                                evidenceReference: contactVerificationEvidence
                              }
                            )}
                            variant="outline"
                          >Record Field Verification</Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {planSummary?.subscriptionStatus !== "CONFIRMED" ? (
                <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
                  <input aria-label="TEST J1 subscription verification reason" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={(event) => setSubscriptionVerificationReason(event.target.value)} placeholder="Independent authorization reason" value={subscriptionVerificationReason} />
                  <input aria-label="TEST J1 subscription evidence reference" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={(event) => setSubscriptionVerificationEvidence(event.target.value)} placeholder="Consent/evidence reference" value={subscriptionVerificationEvidence} />
                  <Button className="h-9 justify-self-start sm:col-span-2" disabled={busy || !planSummary?.administrativeControls.canManage || !subscriptionVerificationReason.trim() || !subscriptionVerificationEvidence.trim()} onClick={() => void verifyTestJ1Subscription()} variant="outline">Record TEST J1 Subscription Eligibility</Button>
                  <p className="text-xs leading-5 text-secondary sm:col-span-2">This records an existing plan-contact decision and releases only the exact allowlisted held J1 intent. Provider suppression checks still run before any contact write.</p>
                </div>
              ) : null}
            </details>
          ) : null}
          <p className="mt-3 text-xs leading-5 text-warning">Dispatch remains disabled unless the dedicated maintenance posture is active and every unrelated automatic or journey path is off.</p>
          {pilotMessage ? <p className="mt-3 rounded-xl border border-success-border/50 bg-success-surface px-3 py-2 text-xs leading-5 text-success">{pilotMessage}</p> : null}
          {fullFieldIntentMessage ? <p className="mt-3 rounded-xl border border-success-border/50 bg-success-surface px-3 py-2 text-xs leading-5 text-success">{fullFieldIntentMessage}</p> : null}
        </section>

      <section className="rounded-xl border border-border bg-input p-4" aria-labelledby="zoho-readiness-controls-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h5 className="text-sm font-semibold text-foreground" id="zoho-readiness-controls-heading">Administrative readiness controls</h5>
            <p className="mt-1 text-xs leading-5 text-secondary">
              These plan-scoped controls record approval or verify configuration. They cannot prepare events, contact Zoho with a write, or enable dispatch.
            </p>
          </div>
          <Badge status={planSummary?.administrativeControls.canManage ? "complete" : "waiting_on_kzero"}>
            {planSummary?.administrativeControls.canManage ? "Staff ADMIN verified" : "Staff ADMIN required"}
          </Badge>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="flex min-h-32 flex-col rounded-xl border border-border bg-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Plan and owner</p>
            <p className="mt-2 text-sm text-foreground">
              {planSummary?.administrativeControls.planAndOwnerApproved ? "Automation approval recorded" : "Approval required"}
            </p>
            <p className="mt-1 text-xs leading-5 text-secondary">Approves only this native pilot plan and its matching Onboarding Owner.</p>
            <Button
              className="mt-auto h-9 self-start"
              disabled={busy || !planSummary?.administrativeControls.canManage || planSummary.administrativeControls.planAndOwnerApproved}
              onClick={() => void runReadinessControl("APPROVE_AUTOMATION", "Approve this plan and its matching Onboarding Owner for controlled pilot readiness?")}
              variant="outline"
            >
              Approve Plan &amp; Owner
            </Button>
          </div>
          <div className="flex min-h-32 flex-col rounded-xl border border-border bg-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Communication context</p>
            <p className="mt-2 text-sm text-foreground">
              {planSummary?.administrativeControls.communicationContextAssigned ? "This plan owns the context" : "Assignment required"}
            </p>
            <p className="mt-1 text-xs leading-5 text-secondary">Assignment fails closed if another plan owns or competes for this email identity.</p>
            <Button
              className="mt-auto h-9 self-start"
              disabled={busy || !planSummary?.administrativeControls.canManage || !planSummary.administrativeControls.planAndOwnerApproved || planSummary.administrativeControls.communicationContextAssigned}
              onClick={() => void runReadinessControl("ASSIGN_CONTEXT", "Assign this plan as the active communication context for its Onboarding Owner?")}
              variant="outline"
            >
              Assign Context
            </Button>
            {planSummary?.administrativeControls.communicationContextAssigned ? (
              <div className="mt-3 grid gap-2 border-t border-border pt-3">
                <input aria-label="Successor plan ID" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={(event) => setSuccessorPlanId(event.target.value)} placeholder="Exact allowlisted successor plan ID" value={successorPlanId} />
                <textarea aria-label="Communication context retirement reason" className="min-h-20 resize-y rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground" onChange={(event) => setContextRetirementReason(event.target.value)} placeholder="Reason for retiring this plan's communication context" value={contextRetirementReason} />
                <Button
                  className="h-9 justify-self-start"
                  disabled={busy || !planSummary.administrativeControls.canManage || successorPlanId.trim().length < 3 || contextRetirementReason.trim().length < 12}
                  onClick={() => void runReadinessControl(
                    "RETIRE_CONTEXT_FOR_TEST_SUCCESSOR",
                    "Retire this plan's context for the exact allowlisted successor? Existing history and events are preserved.",
                    {
                      confirmation: "RETIRE CONTEXT FOR ALLOWLISTED TEST SUCCESSOR",
                      reason: contextRetirementReason,
                      successorPlanId
                    }
                  )}
                  variant="outline"
                >Retire Context for Successor</Button>
              </div>
            ) : planSummary?.communicationContext?.state === "UNASSIGNED" ? (
              <div className="mt-3 grid gap-2 border-t border-border pt-3">
                <input aria-label="Retired successor plan ID" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={(event) => setSuccessorPlanId(event.target.value)} placeholder="Successor plan ID used for retirement" value={successorPlanId} />
                <Button
                  className="h-9 justify-self-start"
                  disabled={busy || !planSummary.administrativeControls.canManage || successorPlanId.trim().length < 3}
                  onClick={() => void runReadinessControl(
                    "RESTORE_RETIRED_CONTEXT",
                    "Restore this plan's retired context only if the successor plan has not been created?",
                    { confirmation: "RESTORE RETIRED COMMUNICATION CONTEXT", successorPlanId }
                  )}
                  variant="outline"
                >Restore Retired Context</Button>
              </div>
            ) : null}
          </div>
          <div className="flex min-h-32 flex-col rounded-xl border border-border bg-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Mailing-list privacy</p>
            <p className="mt-2 text-sm text-foreground">
              {planSummary?.administrativeControls.listPrivacyVerified ? "Private list verified" : "Verification required"}
            </p>
            <p className="mt-1 text-xs leading-5 text-secondary">
              {planSummary?.administrativeControls.listPrivacyVerified
                ? `Evidence: ${humanize(planSummary.administrativeControls.listPrivacyEvidenceSource)}`
                : "Uses Zoho's read-only mailing-list discovery and requires is_public=false."}
            </p>
            <Button
              className="mt-auto h-9 self-start"
              disabled={busy || !planSummary?.administrativeControls.canManage || planSummary.administrativeControls.listPrivacyVerified}
              onClick={() => void runReadinessControl("VERIFY_LIST_PRIVACY", "Run the read-only Zoho mailing-list privacy verification now?")}
              variant="outline"
            >
              Verify List Privacy
            </Button>
          </div>
          <div className="flex min-h-32 flex-col rounded-xl border border-border bg-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Subscription authorization</p>
            <p className="mt-2 text-sm text-foreground">
              {controlledPilot?.subscriptionConfirmation ? "Exact list-add authorization recorded" : planSummary?.subscriptionStatus === "INELIGIBLE" ? "Contact is suppressed or ineligible" : "Independent evidence required"}
            </p>
            <p className="mt-1 text-xs leading-5 text-secondary">Permission to participate in onboarding is not, by itself, authorization for this Zoho list addition.</p>
            {!controlledPilot?.subscriptionConfirmation ? (
              <div className="mt-3 grid gap-2">
                <input
                  aria-label="Subscription authorization evidence reference"
                  className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground"
                  onChange={(event) => setSubscriptionEvidenceReference(event.target.value)}
                  placeholder="Consent record, ticket, or CRM reference"
                  value={subscriptionEvidenceReference}
                />
                <textarea
                  aria-label="Subscription authorization basis"
                  className="min-h-20 resize-y rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground"
                  onChange={(event) => setSubscriptionAuthorizationBasis(event.target.value)}
                  placeholder="Explain how the evidence independently authorizes this exact private-list addition"
                  value={subscriptionAuthorizationBasis}
                />
                <label className="flex items-start gap-2 text-xs leading-5 text-secondary">
                  <input checked={subscriptionEvidenceConfirmed} className="mt-1 h-4 w-4" onChange={(event) => setSubscriptionEvidenceConfirmed(event.target.checked)} type="checkbox" />
                  <span>I confirm this evidence independently supports adding the exact pilot contact to KZero Partner Onboarding and is not inferred from enrollment, an NFR agreement, or absence from the list.</span>
                </label>
                <Button
                  className="h-9 justify-self-start"
                  disabled={busy || !planSummary?.administrativeControls.canManage || !subscriptionEvidenceConfirmed || !subscriptionEvidenceReference.trim() || !subscriptionAuthorizationBasis.trim() || planSummary?.subscriptionStatus === "INELIGIBLE"}
                  onClick={() => void runReadinessControl(
                    "CONFIRM_SUBSCRIPTION",
                    "Record this independently supported subscription decision for the exact pilot contact and private list?",
                    {
                      authorizationBasis: subscriptionAuthorizationBasis,
                      authorizationEvidenceConfirmed: subscriptionEvidenceConfirmed,
                      confirmation: "CONFIRM PRIVATE LIST ADD AUTHORIZATION",
                      evidenceReference: subscriptionEvidenceReference
                    }
                  )}
                  variant="outline"
                >Record Subscription Decision</Button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-secondary">Recorded {new Date(controlledPilot.subscriptionConfirmation.recordedAt).toLocaleString()}{controlledPilot.subscriptionConfirmation.evidenceReference ? ` · ${controlledPilot.subscriptionConfirmation.evidenceReference}` : ""}</p>
            )}
          </div>
          <div className="flex min-h-32 flex-col rounded-xl border border-border bg-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Downstream Zoho automation</p>
            <p className="mt-2 text-sm text-foreground">{controlledPilot?.downstreamAutomationVerified ? "Review passed" : controlledPilot?.downstreamAutomationReview?.result === "ACTIVE_AUTOMATION_FOUND" ? "Active automation found" : "Complete Zoho UI review required"}</p>
            <p className="mt-1 text-xs leading-5 text-secondary">Review every possible list-entry email path for the exact KZero Partner Onboarding list.</p>
            {!controlledPilot?.downstreamAutomationVerified ? (
              <div className="mt-3 grid gap-2">
                {[
                  ["listJourneys", "List-associated journeys"],
                  ["campaigns", "Campaigns"],
                  ["accountWorkflows", "Account-level workflows"],
                  ["autoresponders", "Autoresponders"],
                  ["otherListEntryActions", "Other list-entry-triggered email actions"]
                ].map(([key, label]) => (
                  <label className="flex items-start gap-2 text-xs text-secondary" key={key}>
                    <input checked={downstreamReviewedItems[key] === true} className="mt-0.5 h-4 w-4" onChange={(event) => setDownstreamReviewedItems((current) => ({ ...current, [key]: event.target.checked }))} type="checkbox" />
                    <span>{label}</span>
                  </label>
                ))}
                <select aria-label="Downstream automation review result" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={(event) => setDownstreamReviewResult(event.target.value as typeof downstreamReviewResult)} value={downstreamReviewResult}>
                  <option value="">Select review result</option>
                  <option value="NO_UNINTENDED_AUTOMATION">No unintended automation found</option>
                  <option value="ACTIVE_AUTOMATION_FOUND">Active automation found — keep blocked</option>
                </select>
                <input aria-label="Downstream automation evidence reference" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={(event) => setDownstreamEvidenceReference(event.target.value)} placeholder="Zoho review, ticket, or change record" value={downstreamEvidenceReference} />
                <label className="flex items-start gap-2 text-xs leading-5 text-secondary">
                  <input checked={downstreamReviewComplete} className="mt-1 h-4 w-4" onChange={(event) => setDownstreamReviewComplete(event.target.checked)} type="checkbox" />
                  <span>I confirm the review is complete for the exact destination list.</span>
                </label>
                <Button
                  className="h-9 justify-self-start"
                  disabled={busy || !planSummary?.administrativeControls.canManage || !downstreamReviewComplete || !downstreamReviewResult || !downstreamEvidenceReference.trim() || Object.values(downstreamReviewedItems).filter(Boolean).length !== 5}
                  onClick={() => void runReadinessControl(
                    "VERIFY_DOWNSTREAM_AUTOMATION",
                    "Record this complete downstream-automation review for the exact pilot list?",
                    {
                      evidenceReference: downstreamEvidenceReference,
                      reviewComplete: downstreamReviewComplete,
                      reviewedItems: downstreamReviewedItems,
                      reviewResult: downstreamReviewResult
                    }
                  )}
                  variant="outline"
                >Record Complete Review</Button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-secondary">Recorded {controlledPilot.downstreamAutomationReview ? new Date(controlledPilot.downstreamAutomationReview.reviewedAt).toLocaleString() : "previously"}{controlledPilot.downstreamAutomationReview?.evidenceReference ? ` · ${controlledPilot.downstreamAutomationReview.evidenceReference}` : ""}</p>
            )}
          </div>
        </div>
        {readinessControlMessage ? <p className="mt-3 rounded-xl border border-success-border/50 bg-success-surface px-3 py-2 text-xs leading-5 text-success">{readinessControlMessage}</p> : null}
      </section>

      <div>
        <h5 className="text-sm font-semibold text-foreground">Items requiring attention</h5>
        {blockerGroups.length > 0 ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {blockerGroups.map(([category, rows]) => (
              <div className="rounded-xl border border-border bg-input p-3" key={category}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{categoryLabels[category]}</p>
                <ul className="mt-2 grid gap-2">
                  {rows.map((row) => (
                    <li className="flex items-start gap-2 text-sm leading-5 text-secondary" key={row.code}>
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span><span className="font-medium text-foreground">{kindLabel(row.kind)}:</span> {row.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-border bg-input p-3 text-sm text-secondary">
            No current readiness blockers were reported. Disabled operational controls still remain authoritative.
          </p>
        )}
      </div>

      <details className="rounded-xl border border-border bg-input">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Advanced Diagnostics
        </summary>
        <div className="grid gap-x-4 gap-y-2 border-t border-border px-4 py-4 text-xs text-secondary sm:grid-cols-2">
          <p>Raw classification: <span className="text-foreground">{readiness?.classification ?? "UNAVAILABLE"}</span></p>
          <p>Enrollment contact sync: <span className="text-foreground">{planSummary?.enrollmentContactSync.synchronizationState ?? "UNAVAILABLE"}</span></p>
          <p>MSP: <span className="text-foreground">{planSummary?.enrollmentContactSync.mspName ?? "Unavailable"}</span></p>
          <p>Primary contact: <span className="break-all text-foreground">{planSummary?.enrollmentContactSync.primaryContactEmail ?? "Unavailable"}</span></p>
          <p>Permission attestation: <span className="text-foreground">{planSummary?.enrollmentContactSync.permissionAttested ? "Recorded" : "Missing"}</span></p>
          <p>Enrollment contact permission: <span className="text-foreground">{planSummary?.enrollmentContactSync.permissionEvidencePresent ? "Evidence recorded" : "Missing"}</span></p>
          <p>Staff identity: <span className="text-foreground">{planSummary?.enrollmentContactSync.staffIdentityVerified ? "Individually verified" : "Required"}</span></p>
          <p>Contact / owner: <span className="text-foreground">{planSummary?.enrollmentContactSync.primaryContactMatchesOwner ? "Matched" : "Invalid or mismatched"}</span></p>
          <p>Eligible if explicitly enabled: <span className="text-foreground">{readiness?.eligibleIfEnabled ? "Yes" : "No"}</span></p>
          <p>Plan enrollment: <span className="text-foreground">{planSummary?.automationEnrollmentState ?? "Unavailable"}</span></p>
          <p>Subscription: <span className="text-foreground">{planSummary?.subscriptionStatus ?? "No owner"}</span></p>
          <p>Communication context: <span className="text-foreground">{planSummary?.communicationContext?.state ?? "Unassigned"}</span></p>
          <p>Plan contacts: <span className="text-foreground">{contacts.length}</span></p>
          <p>Held / failed events: <span className="text-foreground">{planSummary ? `${planSummary.heldEventCount} / ${planSummary.failedEventCount}` : "Unavailable"}</span></p>
          <p>Last contact sync: <span className="text-foreground">{planSummary?.lastSuccessfulContactSync ? new Date(planSummary.lastSuccessfulContactSync.updatedAt).toLocaleString() : "Never"}</span></p>
          <p>Last journey outcome: <span className="text-foreground">{planSummary?.lastJourneyOutcome ? `${planSummary.lastJourneyOutcome.journey} · ${planSummary.lastJourneyOutcome.providerResult}` : "None"}</span></p>
          <p>Nudge state: <span className="text-foreground">{planSummary?.nudge.status ?? "Unavailable"}</span></p>
          <p>OAuth / list configuration: <span className="text-foreground">{status?.configuration.oauthConfigured && status.configuration.listKeyPresent ? "Present" : "Incomplete"}</span></p>
          <p>Email-only list readiness: <span className="text-foreground">{status?.configuration.oauthConfigured && status.configuration.listKeyPresent ? "Configured" : "Incomplete"}</span></p>
          <p>Field / private-list verification: <span className="text-foreground">{status?.configuration.fieldMappingVerified && status.configuration.listPrivacyVerified ? "Verified" : "Unverified"}</span></p>
          <p>Single-contact pilot target: <span className="text-foreground">{status?.configuration.mspEnrollmentPilotTargetConfigured ? "Configured server-side" : "Not configured"}</span></p>
          <p>Configured journeys: <span className="text-foreground">{configuredJourneys} of 4</span></p>
          <p>Journey triggering: <span className="text-foreground">{status?.configuration.journeyTriggeringEnabled ? "Enabled" : "Disabled"}</span></p>
          {planSummary?.enrollmentContactSync.permissionEvidenceReference ? (
            <p className="sm:col-span-2">Permission evidence reference: <span className="break-words text-foreground">{planSummary.enrollmentContactSync.permissionEvidenceReference}</span></p>
          ) : null}
          {status ? Object.entries(status.configuration.journeys).map(([journey, configuration]) => (
            <p className="sm:col-span-2" key={journey}>{journey}: <span className="text-foreground">{configuration.journeyKeyPresent && configuration.triggerKeyPresent ? "Journey and trigger keys configured" : "Configuration incomplete"}</span></p>
          )) : null}
        </div>
      </details>

      <details className="rounded-xl border border-border bg-input">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Advanced test and discovery tools
        </summary>
        <div className="grid gap-3 border-t border-border p-4">
          <p className="text-xs leading-5 text-muted">Global diagnostics belong in the Zoho Automation Admin Center. These existing case-scoped controls remain available here for compatibility and are collapsed by default.</p>
          <div className="flex flex-wrap gap-2">
            <Button className="h-9" disabled={busy || !status?.configuration.oauthConfigured} onClick={() => void runDiscovery()} variant="outline">Run Read-only Discovery</Button>
            <Link className="inline-flex h-9 items-center justify-center rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-hover" href="/admin/zoho?tab=test-sync">Open global Test Contact Sync</Link>
          </div>
          {operationMessage ? <p className="rounded-xl border border-border bg-surface px-3 py-2 text-xs leading-5 text-secondary">{operationMessage}</p> : null}
          <label className="grid gap-1 text-xs text-secondary">
            <span>Allowlisted plan contact</span>
            <select
              className="h-10 rounded-xl border border-border bg-surface px-3 text-foreground outline-none"
              onChange={(event) => {
                setSelectedContactId(event.target.value);
                setPreview(null);
                setConfirmed(false);
              }}
              value={selectedContactId}
            >
              <option value="">Select a contact</option>
              {eligibleContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.firstName || "Name incomplete"} — {contact.email}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button className="h-9" disabled={busy || !selectedContactId} onClick={() => void createPreview()} variant="outline">Preview Test Sync</Button>
            <Button className="h-9" disabled={busy || !selectedContactId} onClick={() => void checkMembership()} variant="secondary">Check List Membership</Button>
          </div>
          {preview ? (
            <div className="grid gap-2 rounded-xl border border-warning-border bg-warning-surface p-3 text-xs text-warning">
              <p><span className="font-medium">Recipient:</span> {preview.recipient}</p>
              <p>Preview only: {preview.fieldCount} mapped fields for this plan; the bulk write sends only the email address.</p>
              {preview.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
              <label className="flex items-start gap-2">
                <input checked={confirmed} className="mt-0.5 h-4 w-4" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
                <span>I reviewed this allowlisted test preview and authorize one email-only bulk list-add request.</span>
              </label>
              <Button disabled={busy || !confirmed} onClick={() => void performTestSync()}>Add Allowlisted Test Email</Button>
            </div>
          ) : null}
        </div>
      </details>

      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap">
        <Link className="inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-hover" href={`/admin/zoho?tab=events&plan=${encodeURIComponent(planId)}`}>
          View Automation History <ChevronRight className="ml-1 h-4 w-4" />
        </Link>
        <Link className="inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-hover" href="/admin/zoho?tab=test-sync">
          Open Test Contact Sync
        </Link>
        <Link className="inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-hover" href="/admin/zoho?tab=configuration">
          View Global Configuration
        </Link>
      </div>
      <p className="text-xs leading-5 text-muted">Global discovery and allowlisted test-contact tools remain in the Zoho Automation Admin Center.</p>
      </section>
    </div>
  );
}
