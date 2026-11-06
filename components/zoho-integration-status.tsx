"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type ContactOption = {
  automationEnabled: boolean;
  email: string;
  firstName: string | null;
  id: string;
};

type StatusPayload = {
  configuration: {
    contactSynchronizationEnabled: boolean;
    journeyTriggeringEnabled: boolean;
    fieldMappingVerified: boolean;
    journeys: Record<string, { journeyKeyPresent: boolean; triggerKeyPresent: boolean }>;
    listKeyPresent: boolean;
    listPrivacyVerified: boolean;
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
  snapshot: Record<string, string | number | null>;
  warnings: string[];
};

type PlanAutomationSummary = {
  automationEnrollmentState: string;
  communicationContext: { activePlanId: string | null; state: string } | null;
  failedEventCount: number;
  heldEventCount: number;
  lastJourneyOutcome: { journey: string; providerResult: string } | null;
  lastSuccessfulContactSync: { updatedAt: string } | null;
  nudge: { status: string; taskKey: string | null };
  readiness: { status: string; readyForDataSync: boolean; readyForJourneyEnrollment: boolean } | null;
  subscriptionStatus: string | null;
};

function yesNo(value: boolean) {
  return value ? "Present" : "Missing";
}

export function ZohoIntegrationStatus({ contacts, planId }: { contacts: ContactOption[]; planId: string }) {
  const eligibleContacts = contacts.filter((contact) => contact.automationEnabled);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [planSummary, setPlanSummary] = useState<PlanAutomationSummary | null>(null);
  const [selectedContactId, setSelectedContactId] = useState(eligibleContacts[0]?.id ?? "");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const response = await fetch(`/api/admin/zoho/status?planId=${encodeURIComponent(planId)}`, {
      cache: "no-store"
    });
    const payload = (await response.json().catch(() => null)) as (StatusPayload & { error?: string }) | null;
    if (!response.ok || !payload) throw new Error(payload?.error ?? "Could not load Zoho status.");
    setStatus(payload);
  }, [planId]);

  useEffect(() => {
    void loadStatus().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load Zoho status."));
    void fetch(`/api/admin/zoho/automation/plans/${encodeURIComponent(planId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<PlanAutomationSummary> : null)
      .then(setPlanSummary)
      .catch(() => setPlanSummary(null));
  }, [loadStatus]);

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
    setMessage(null);
    try {
      await post("/api/admin/zoho/discover", { operation: "all" });
      setMessage("Read-only field and journey discovery completed.");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Discovery failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createPreview() {
    if (!selectedContactId) return;
    setBusy(true);
    setMessage(null);
    setPreview(null);
    setConfirmed(false);
    try {
      const payload = await post("/api/admin/zoho/test-sync/preview", {
        contactId: selectedContactId,
        planId
      });
      setPreview(payload as PreviewPayload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function performTestSync() {
    if (!preview || !confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await post("/api/admin/zoho/test-sync", {
        confirmation: "UPSERT ALLOWLISTED TEST CONTACT",
        contactId: selectedContactId,
        planId,
        previewFingerprint: preview.previewFingerprint
      });
      setMessage(
        `Zoho test request: ${String(result.classification ?? "accepted")}. This does not confirm delivery or journey eligibility.`
      );
      setPreview(null);
      setConfirmed(false);
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test synchronization failed.");
    } finally {
      setBusy(false);
    }
  }

  async function checkMembership() {
    const contact = eligibleContacts.find((item) => item.id === selectedContactId);
    if (!contact) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await post("/api/admin/zoho/subscription-check", { email: contact.email });
      const statuses = Array.isArray(result.listStatuses) ? result.listStatuses.join(", ") || "not found" : "unknown";
      setMessage(`List membership: ${statuses}. Topic and Marketing eligibility still require manual ZMA verification.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Membership check failed.");
    } finally {
      setBusy(false);
    }
  }

  const configuredJourneys = status
    ? Object.values(status.configuration.journeys).filter(
        (journey) => journey.journeyKeyPresent && journey.triggerKeyPresent
      ).length
    : 0;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Zoho integration status</p>
          <p className="mt-1 text-xs leading-5 text-muted">Server-side diagnostics and allowlisted test contacts only.</p>
        </div>
        <Badge status={status?.configuration.contactSynchronizationEnabled ? "complete" : "in_progress"}>
          Sync {status?.configuration.contactSynchronizationEnabled ? "enabled" : "disabled"}
        </Badge>
      </div>

      {status ? (
        <div className="mt-3 grid gap-x-4 gap-y-2 text-xs text-secondary sm:grid-cols-2">
          <p>OAuth configuration: <span className="text-foreground">{yesNo(status.configuration.oauthConfigured)}</span></p>
          <p>OAuth connection: <span className="text-foreground">{status.lastFieldDiscovery || status.lastJourneyDiscovery ? "Last read succeeded" : "Not tested"}</span></p>
          <p>List / topic: <span className="text-foreground">{yesNo(status.configuration.listKeyPresent && status.configuration.topicIdPresent)}</span></p>
          <p>Field discovery: <span className="text-foreground">{status.lastFieldDiscovery ? "Previously tested" : "Not tested"}</span></p>
          <p>Field write mapping: <span className="text-foreground">{status.configuration.fieldMappingVerified ? "Verified" : "Unverified"}</span></p>
          <p>Private list: <span className="text-foreground">{status.configuration.listPrivacyVerified ? "Verified" : "Unverified"}</span></p>
          <p>Journeys configured: <span className="text-foreground">{configuredJourneys} of 4</span></p>
          <p>Journey triggering: <span className="text-foreground">{status.configuration.journeyTriggeringEnabled ? "Enabled" : "Disabled"}</span></p>
          <p>Journey discovery: <span className="text-foreground">{status.lastJourneyDiscovery ? "Previously tested" : "Not tested"}</span></p>
          <p>Test mode: <span className="text-foreground">{status.configuration.testMode.enabled ? "Enabled" : "Disabled"}</span></p>
        </div>
      ) : null}

      {planSummary ? (
        <div className="mt-3 grid gap-x-4 gap-y-2 rounded-xl border border-border bg-input p-3 text-xs text-secondary sm:grid-cols-2">
          <p>Enrollment: <span className="text-foreground">{planSummary.automationEnrollmentState}</span></p>
          <p>Readiness: <span className="text-foreground">{planSummary.readiness?.status ?? "Unavailable"}</span></p>
          <p>Subscription: <span className="text-foreground">{planSummary.subscriptionStatus ?? "No owner"}</span></p>
          <p>Communication context: <span className="text-foreground">{planSummary.communicationContext?.state ?? "Unassigned"}</span></p>
          <p>Last contact sync: <span className="text-foreground">{planSummary.lastSuccessfulContactSync ? new Date(planSummary.lastSuccessfulContactSync.updatedAt).toLocaleString() : "Never"}</span></p>
          <p>Last journey outcome: <span className="text-foreground">{planSummary.lastJourneyOutcome ? `${planSummary.lastJourneyOutcome.journey} · ${planSummary.lastJourneyOutcome.providerResult}` : "None"}</span></p>
          <p>Nudge: <span className="text-foreground">{planSummary.nudge.status}</span></p>
          <p>Held / failed events: <span className="text-foreground">{planSummary.heldEventCount} / {planSummary.failedEventCount}</span></p>
        </div>
      ) : null}

      <Link
        className="mt-3 inline-flex text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        href={`/admin/zoho?tab=events&plan=${encodeURIComponent(planId)}`}
      >
        View Automation History
      </Link>

      {status?.lastTestResult ? (
        <p className="mt-3 rounded-xl border border-border bg-input px-3 py-2 text-xs leading-5 text-secondary">
          Last approved test: {status.lastTestResult.reason} ({new Date(status.lastTestResult.createdAt).toLocaleString()})
        </p>
      ) : null}

      {message ? <p className="mt-3 rounded-xl border border-border bg-input px-3 py-2 text-xs leading-5 text-secondary">{message}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="h-9" disabled={busy || !status?.configuration.oauthConfigured} onClick={() => void runDiscovery()} variant="outline">
          Run Read-only Discovery
        </Button>
      </div>

      <div className="mt-3 grid gap-2 rounded-xl border border-border bg-input p-3">
        <label className="grid gap-1 text-xs text-secondary">
          <span>Allowlisted test contact</span>
          <select
            className="rounded-xl border border-border bg-surface px-3 py-2 text-foreground outline-none"
            onChange={(event) => {
              setSelectedContactId(event.target.value);
              setPreview(null);
              setConfirmed(false);
            }}
            value={selectedContactId}
          >
            <option value="">Select a contact</option>
            {eligibleContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.firstName || "Name incomplete"} — {contact.email}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button className="h-9" disabled={busy || !selectedContactId} onClick={() => void createPreview()} variant="outline">
            Preview Test Sync
          </Button>
          <Button className="h-9" disabled={busy || !selectedContactId} onClick={() => void checkMembership()} variant="secondary">
            Check List Membership
          </Button>
        </div>

        {preview ? (
          <div className="mt-1 grid gap-2 border-t border-border pt-3 text-xs text-secondary">
            <p><span className="font-medium text-foreground">Recipient:</span> {preview.recipient}</p>
            <p><span className="font-medium text-foreground">Snapshot:</span> {preview.fieldCount} complete mapped fields for {preview.planId}</p>
            <ul className="grid gap-1 text-muted">
              {preview.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
            </ul>
            <label className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-warning">
              <input checked={confirmed} className="mt-0.5 h-4 w-4" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
              <span>I reviewed this allowlisted test preview and authorize one listsubscribe call, which may send a confirmation email.</span>
            </label>
            <Button disabled={busy || !confirmed} onClick={() => void performTestSync()}>
              Upsert Allowlisted Test Contact
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
