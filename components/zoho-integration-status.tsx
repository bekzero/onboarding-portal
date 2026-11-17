"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleOff, RefreshCw } from "lucide-react";
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
    contactSynchronizationEnabled: boolean;
    fieldMappingVerified: boolean;
    journeyTriggeringEnabled: boolean;
    journeys: Record<string, { journeyKeyPresent: boolean; triggerKeyPresent: boolean }>;
    listKeyPresent: boolean;
    listPrivacyVerified: boolean;
    mspEnrollmentContactSyncEnabled: boolean;
    oauthConfigured: boolean;
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

const blockerCopy: Record<string, { category: BlockerCategory; kind: BlockerKind; label: string }> = {
  AUTOMATION_APPROVAL_REQUIRED: { category: "plan", kind: "action", label: "Approve automation for the plan and Onboarding Owner contact." },
  COMMUNICATION_CONTEXT_REQUIRED: { category: "context", kind: "action", label: "Assign this plan as the active communication context for the contact." },
  CONTACT_PERMISSION_NOT_DOCUMENTED: { category: "contact", kind: "action", label: "Record appropriate contact permission and its supporting evidence." },
  CONTACT_SYNCHRONIZATION_DISABLED: { category: "flags", kind: "intentional", label: "Contact synchronization is intentionally disabled." },
  EVENT_EMISSION_DISABLED: { category: "flags", kind: "intentional", label: "Zoho event preparation is intentionally disabled." },
  GLOBAL_KILL_SWITCH_ENABLED: { category: "flags", kind: "intentional", label: "The global Zoho kill switch is enabled." },
  INDIVIDUAL_STAFF_IDENTITY_REQUIRED: { category: "identity", kind: "action", label: "Sign in with an individually attributable staff identity." },
  INVALID_PRIMARY_CONTACT: { category: "contact", kind: "action", label: "Make the primary MSP contact match a valid Onboarding Owner email." },
  MSP_ENROLLMENT_SYNC_DISABLED: { category: "flags", kind: "intentional", label: "MSP enrollment contact-sync preparation is intentionally disabled." },
  PERMISSION_EVIDENCE_MISSING: { category: "contact", kind: "action", label: "Add a permission evidence reference for the primary contact." },
  PRODUCTION_DISPATCH_NOT_APPROVED: { category: "flags", kind: "intentional", label: "Production dispatch has not been approved." },
  PROVIDER_CONFIGURATION_INCOMPLETE: { category: "provider", kind: "unverified", label: "Complete and verify the required Zoho provider configuration." },
  RECIPIENT_INELIGIBLE: { category: "contact", kind: "action", label: "The contact is unsubscribed, bounced, suppressed, or otherwise ineligible." }
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
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [planSummary, setPlanSummary] = useState<PlanAutomationSummary | null>(null);
  const [selectedContactId, setSelectedContactId] = useState(eligibleContacts[0]?.id ?? "");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<string | null>(null);

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
  const primaryStatus = displayStatus(readiness?.classification ?? "UNABLE_TO_VERIFY");
  const PrimaryIcon = primaryStatus.icon;
  const configuredJourneys = status
    ? Object.values(status.configuration.journeys).filter((journey) => journey.journeyKeyPresent && journey.triggerKeyPresent).length
    : 0;

  return (
    <div className="grid gap-4">
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
      {error ? <p className="rounded-xl border border-danger-border/60 bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p> : null}

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
          <p>Field / private-list verification: <span className="text-foreground">{status?.configuration.fieldMappingVerified && status.configuration.listPrivacyVerified ? "Verified" : "Unverified"}</span></p>
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
    </div>
  );
}
