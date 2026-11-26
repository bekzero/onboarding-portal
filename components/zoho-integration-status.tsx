"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleOff, Clock3, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ContactOption = { automationEnabled: boolean; email: string; firstName: string | null; id: string };
type AutomationStatus = {
  activity: Array<{ at: string; detail: string | null; label: string; state: string }>;
  automation: { enabled: boolean; systemSendingActive: boolean; systemState: "ACTIVE" | "PAUSED_BY_SYSTEM" };
  blockers: Array<{ action: string; code: string; message: string }>;
  canManage: boolean;
  contact: { attempts: number; email: string; lastStatus: string };
  currentStage: string;
  lastEmail: { at: string | null; journey: "J1" | "J3_R1" | "J5" | "J8"; status: string; verifiedDelivered: false } | null;
  mspName: string;
  nextEmail: { journey: "J1" | "J3_R1" | "J5" | "J8" | null; state: string; timing: string } | null;
  planId: string;
  warning: string | null;
};

const journeyNames: Record<string, string> = {
  J1: "Welcome and kickoff booking",
  J3_R1: "Next action reminder",
  J5: "Your next step is ready",
  J8: "Completion and expansion"
};

function friendlyState(value: string) {
  const labels: Record<string, string> = {
    CANCELLED: "Cancelled", DEAD: "Needs attention", DISABLED: "Disabled", ENABLED: "Enabled",
    HELD: "Waiting", NOT_STARTED: "Not started", PENDING: "Pending", PROCESSING: "In progress",
    RETRY: "Retry scheduled", SUCCEEDED: "Succeeded", TRIGGERED: "Accepted"
  };
  return labels[value] ?? value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

export function ZohoIntegrationStatus({ planId }: { contacts: ContactOption[]; planId: string }) {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/admin/zoho/automation/plans/${encodeURIComponent(planId)}/email-automation`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as AutomationStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Automated email status is temporarily unavailable.");
      setStatus(payload);
    } catch {
      setError("Automated email status is temporarily unavailable. Reload the case or contact KZero support.");
    }
  }, [planId]);

  useEffect(() => { void load(); }, [load]);

  async function changeAutomation(action: "ENABLE" | "DISABLE") {
    const enabling = action === "ENABLE";
    const confirmed = window.confirm(enabling
      ? "Enable automated onboarding emails for this MSP? KZero will validate eligibility and prepare contact-first email work for this case only."
      : "Disable automated onboarding emails for this MSP? Unsent queued work will be cancelled. Already active Zoho journeys may require separate exit verification."
    );
    if (!confirmed) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/admin/zoho/automation/plans/${encodeURIComponent(planId)}/email-automation`, {
        body: JSON.stringify({ action, confirmed: true }), headers: { "Content-Type": "application/json" }, method: "POST"
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; status?: AutomationStatus };
      if (!response.ok || !payload.status) throw new Error(payload.error || "The automated-email setting could not be changed.");
      setStatus(payload.status);
      setMessage(enabling
        ? "Automated emails are enabled for this MSP. Contact synchronization will always complete before the Welcome journey can start."
        : "Automated emails are disabled. Unsent KZero email work for this MSP has been cancelled."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The automated-email setting could not be changed.");
    } finally { setBusy(false); }
  }

  if (!status && !error) return (
    <div className="flex min-h-48 items-center justify-center rounded-2xl border border-border bg-surface-secondary">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin text-primary" /><span className="text-sm text-secondary">Loading automated email status...</span>
    </div>
  );

  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="automated-emails-heading">
      <div className="rounded-2xl border border-border bg-gradient-to-br from-surface-secondary to-input p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground" id="automated-emails-heading">Automated Emails</h3>
              <Badge status={status?.automation.enabled ? "complete" : "not_started"}>{status?.automation.enabled ? "Enabled" : "Disabled"}</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary">KZero keeps the onboarding contact and email journey aligned with this MSP's current plan.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button className="h-10" disabled={busy || !status?.canManage || status?.automation.enabled === true} onClick={() => void changeAutomation("ENABLE")}>
              {busy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Enable Automated Emails
            </Button>
            {status?.automation.enabled ? <Button className="h-10" disabled={busy || !status.canManage} onClick={() => void changeAutomation("DISABLE")} variant="outline">Disable Automated Emails</Button> : null}
          </div>
        </div>
        {!status?.canManage ? <p className="mt-4 rounded-xl border border-warning-border/60 bg-warning-surface px-3 py-2 text-sm text-warning">An individually signed-in Staff ADMIN is required to change automated emails.</p> : null}
        {status?.warning ? <p className="mt-4 flex items-start gap-2 rounded-xl border border-warning-border/60 bg-warning-surface px-3 py-2 text-sm leading-5 text-warning"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{status.warning}</p> : null}
        {message ? <p className="mt-4 rounded-xl border border-success-border/60 bg-success-surface px-3 py-2 text-sm text-success">{message}</p> : null}
        {error ? <p className="mt-4 break-words rounded-xl border border-danger-border/60 bg-danger-surface px-3 py-2 text-sm text-danger" role="alert">{error}</p> : null}
      </div>

      {status ? <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="min-w-0 rounded-xl border border-border bg-input p-4"><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Email recipient</p><p className="mt-2 break-all text-sm font-semibold text-foreground">{status.contact.email}</p><p className="mt-1 text-xs text-secondary">Onboarding Owner</p></article>
          <article className="min-w-0 rounded-xl border border-border bg-input p-4"><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Current stage</p><p className="mt-2 text-sm font-semibold text-foreground">{status.currentStage}</p><p className="mt-1 text-xs text-secondary">Current portal state</p></article>
          <article className="min-w-0 rounded-xl border border-border bg-input p-4"><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Next scheduled email</p><p className="mt-2 text-sm font-semibold text-foreground">{status.nextEmail?.journey ? journeyNames[status.nextEmail.journey] : "None scheduled"}</p><p className="mt-1 text-xs leading-5 text-secondary">{status.nextEmail?.timing ?? "No queued KZero email work"}</p></article>
          <article className="min-w-0 rounded-xl border border-border bg-input p-4"><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Last email</p><p className="mt-2 text-sm font-semibold text-foreground">{status.lastEmail ? journeyNames[status.lastEmail.journey] : "No email recorded"}</p><p className="mt-1 text-xs leading-5 text-secondary">{status.lastEmail ? `${dateTime(status.lastEmail.at)} | provider accepted; delivery not independently confirmed` : "No journey has been accepted"}</p></article>
        </div>

        {status.blockers.length ? <section className="rounded-xl border border-warning-border/60 bg-warning-surface/40 p-4" aria-labelledby="email-attention-heading">
          <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" /><div className="min-w-0"><h4 className="font-semibold text-foreground" id="email-attention-heading">Email automation needs attention</h4><p className="mt-1 text-sm text-secondary">Resolve these items before automated emails can be enabled.</p></div></div>
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">{status.blockers.map((blocker) => <li className="min-w-0 rounded-xl border border-border bg-surface px-3 py-3" key={blocker.code}><p className="text-sm font-medium text-foreground">{blocker.message}</p><p className="mt-1 text-xs leading-5 text-secondary">{blocker.action}</p></li>)}</ul>
        </section> : null}

        <section className="rounded-xl border border-border bg-input p-4" aria-labelledby="email-activity-heading">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold text-foreground" id="email-activity-heading">Email activity</h4><p className="mt-1 text-xs text-secondary">A simple history of KZero email automation for this MSP.</p></div><Button className="h-9" disabled={busy} onClick={() => void load()} variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
          {status.activity.length ? <ol className="mt-4 grid gap-2">{status.activity.map((item, index) => {
            const successful = ["SUCCEEDED", "ENABLED", "TRIGGERED"].includes(item.state);
            const attention = ["DEAD", "RETRY", "HELD"].includes(item.state);
            const Icon = successful ? CheckCircle2 : attention ? Clock3 : CircleOff;
            return <li className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3" key={`${item.at}-${index}`}><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${successful ? "text-success" : attention ? "text-warning" : "text-muted"}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-foreground">{item.label}</p><span className="text-xs text-muted">{dateTime(item.at)}</span></div>{item.detail ? <p className="mt-1 text-xs leading-5 text-secondary">{item.detail}</p> : null}</div></li>;
          })}</ol> : <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-5 text-sm text-secondary"><CalendarClock className="h-4 w-4" />No automated email activity yet.</div>}
        </section>

        <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between"><p>Contact sync: {friendlyState(status.contact.lastStatus)} | Attempts: {status.contact.attempts}</p>{status.canManage ? <Link className="font-medium text-primary hover:underline" href={`/admin/zoho?tab=events&plan=${encodeURIComponent(planId)}`}>Open Support Diagnostics</Link> : null}</div>
      </> : null}
    </section>
  );
}
