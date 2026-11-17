"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpDown, CheckCircle2, ChevronLeft, ChevronRight, Clock3, MailCheck, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { KzeroLogo } from "@/components/kzero-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { StaffIdentityControl, type StaffIdentityView } from "@/components/staff-identity-control";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Tab = "overview" | "events" | "reminders" | "contacts" | "test-sync" | "configuration";
type Overview = any;
type EventPayload = { events: any[]; page: number; pageSize: number; total: number };
type ReminderPayload = { decisions: any[]; evaluationAt: string; summary: any; timezone: string };
type ContactsPayload = { recipients: any[]; nextCursor: string | null };

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "events", label: "Event History" },
  { id: "reminders", label: "Reminders" },
  { id: "contacts", label: "Contacts & Conflicts" },
  { id: "test-sync", label: "Test Contact Sync" },
  { id: "configuration", label: "Configuration" }
];

const panelClass = "min-w-0 border-border bg-surface p-4 md:p-5";
const controlClass = "h-10 w-full min-w-0 rounded-xl border border-border bg-input px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary";
const tableWrapClass = "mt-4 max-w-full overflow-x-auto rounded-xl border border-border";
const tableClass = "w-full text-left text-sm";

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

function statusTone(status: string): "complete" | "in_progress" | "waiting_on_msp" | "waiting_on_kzero" {
  if (["SUCCEEDED", "TRIGGERED", "CONFIRMED", "ELIGIBLE", "ACTIVE"].includes(status)) return "complete";
  if (["DEAD", "UNKNOWN", "BLOCKED", "INELIGIBLE"].includes(status)) return "waiting_on_kzero";
  if (["HELD", "RETRY", "PENDING_CONFIRMATION", "MANUAL_REVIEW"].includes(status)) return "waiting_on_msp";
  return "in_progress";
}

function Status({ value }: { value: string }) {
  return <Badge status={statusTone(value)}>{value.replaceAll("_", " ")}</Badge>;
}

function Metric({ label, value, warning = false }: { label: string; value: string | number; warning?: boolean }) {
  return (
    <div className="flex min-h-24 flex-col justify-between rounded-xl border border-border bg-surface-secondary p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={`mt-3 text-3xl font-semibold leading-none ${warning ? "text-danger" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="rounded-xl border border-dashed border-border bg-surface-secondary/40 px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

function Loading() {
  return <p className="py-10 text-center text-sm text-muted">Loading automation data…</p>;
}

export function ZohoAutomationCenter({ initialPlanFilter = "", initialTab = "overview", staffIdentity }: { initialPlanFilter?: string; initialTab?: string; staffIdentity: StaffIdentityView | null }) {
  const [tab, setTab] = useState<Tab>(tabs.some((item) => item.id === initialTab) ? initialTab as Tab : "overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<EventPayload | null>(null);
  const [reminders, setReminders] = useState<ReminderPayload | null>(null);
  const [contacts, setContacts] = useState<ContactsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventFilters, setEventFilters] = useState({ plan: initialPlanFilter, query: "", recipient: "", journey: "", eventType: "", status: "", from: "", to: "", page: 1, sort: "createdAt", direction: "desc" });
  const [reminderFilter, setReminderFilter] = useState({ eligibility: "", phase: "" });
  const [contactQuery, setContactQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);

  const fetchJson = useCallback(async (path: string) => {
    const response = await fetch(path, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "Could not load automation data.");
    return payload;
  }, []);

  const loadOverview = useCallback(async () => setOverview(await fetchJson("/api/admin/zoho/automation/overview")), [fetchJson]);
  const loadEvents = useCallback(async () => {
    const params = new URLSearchParams();
    Object.entries(eventFilters).forEach(([key, value]) => value !== "" && params.set(key, String(value)));
    params.set("pageSize", "25");
    setEvents(await fetchJson(`/api/admin/zoho/automation/events?${params}`));
  }, [eventFilters, fetchJson]);
  const loadReminders = useCallback(async () => setReminders(await fetchJson("/api/admin/zoho/nudges/preview?take=100")), [fetchJson]);
  const loadContacts = useCallback(async () => {
    const params = new URLSearchParams({ take: "50" });
    if (contactQuery.trim()) params.set("query", contactQuery.trim());
    setContacts(await fetchJson(`/api/admin/zoho/automation/contacts?${params}`));
  }, [contactQuery, fetchJson]);

  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      await loadOverview();
      if (tab === "events") await loadEvents();
      if (tab === "reminders") await loadReminders();
      if (tab === "contacts") await loadContacts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load automation data.");
    } finally { setBusy(false); }
  }, [loadContacts, loadEvents, loadOverview, loadReminders, tab]);

  useEffect(() => { void refresh(); }, [refresh]);

  const visibleReminders = useMemo(() => (reminders?.decisions ?? []).filter((item) =>
    (!reminderFilter.eligibility || item.eligibility === reminderFilter.eligibility) &&
    (!reminderFilter.phase || item.currentPhase === reminderFilter.phase)
  ), [reminderFilter, reminders]);

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-7xl min-w-0 content-start gap-4 px-4 py-5 md:px-6 md:py-6">
      <Card className="overflow-visible border-[#20395f] bg-[#0b1730] p-0 text-white shadow-[0_18px_50px_rgba(2,8,23,0.24)]">
        <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <KzeroLogo className="shrink-0" imageClassName="!w-[148px] ![filter:brightness(0)_invert(1)] sm:!w-[164px]" />
            <div className="min-w-0 border-l border-white/15 pl-3 sm:pl-4">
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-blue-200">Sales Engineer Dashboard</p>
              <h1 className="truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">Zoho Automation</h1>
              <p className="mt-0.5 text-xs text-slate-300 sm:text-sm">Monitoring and launch readiness. External automation remains dormant.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <StaffIdentityControl identity={staffIdentity}/>
            <ThemeToggle className="border-white/15 bg-white/5 text-white hover:border-white/30 hover:bg-white/10" />
            <Button className="h-10 rounded-xl border-white/15 text-white hover:border-white/30 hover:bg-white/10" disabled={busy} onClick={() => void refresh()} variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
            <Link className="inline-flex h-10 items-center rounded-xl border border-white/15 px-3 text-sm font-medium text-slate-100 transition hover:border-white/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" href="/admin">Back to Dashboard</Link>
          </div>
        </div>
      </Card>

      <nav aria-label="Zoho Automation sections" className="flex h-14 max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border bg-surface px-1.5">
        {tabs.map((item) => <button aria-current={tab === item.id ? "page" : undefined} className={`h-10 shrink-0 rounded-lg px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tab === item.id ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30" : "text-secondary hover:bg-input hover:text-foreground"}`} key={item.id} onClick={() => setTab(item.id)} type="button">{item.label}</button>)}
      </nav>

      {error ? <Card className="border-danger-border bg-danger-surface p-4 text-sm text-danger">{error}</Card> : null}
      {busy && !overview && !events && !reminders && !contacts ? <Loading /> : null}

      <section className="min-w-0 [&_input]:min-w-0 [&_select]:min-w-0">
        {tab === "overview" && overview ? <OverviewView overview={overview} /> : null}
        {tab === "events" ? <EventHistory filters={eventFilters} onChange={setEventFilters} onSelect={setSelectedEvent} payload={events} /> : null}
        {tab === "reminders" ? <ReminderPreview filters={reminderFilter} onChange={setReminderFilter} payload={reminders} rows={visibleReminders} /> : null}
        {tab === "contacts" ? <ContactsView onQuery={setContactQuery} payload={contacts} query={contactQuery} sensitiveReason={overview?.sensitiveActions?.reason} /> : null}
        {tab === "test-sync" && overview ? <TestContactSync overview={overview} /> : null}
        {tab === "configuration" && overview ? <ConfigurationView overview={overview} /> : null}
      </section>

      {selectedEvent ? <EventDetails event={selectedEvent} onClose={() => setSelectedEvent(null)} /> : null}
    </main>
  );
}

function TestContactSync({ overview }: { overview: any }) {
  const [email, setEmail] = useState("");
  const [check, setCheck] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = overview.configuration;
  const test = config.testContactSync;
  const writeReady = Boolean(
    config.oauthConfigured && config.listKeyPresent && test?.enabled &&
    !config.globalKillSwitch && overview.sensitiveActions?.identityAuthorized
  );

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error(payload?.error ?? "The Zoho test operation failed.");
    return payload;
  }

  async function checkContact() {
    setBusy(true); setError(null); setResult(null); setCheck(null); setConfirmed(false); setRequestId("");
    try {
      const payload = await post("/api/admin/zoho/test-contact/check", { email });
      setCheck(payload);
      if (payload.classification === "NOT_FOUND") setRequestId(crypto.randomUUID());
    } catch (cause) {
      setCheck({ classification: "UNABLE_TO_VERIFY", reason: "REQUEST_FAILED" });
      setError(cause instanceof Error ? cause.message : "Unable to verify this contact.");
    } finally { setBusy(false); }
  }

  async function syncContact() {
    if (!confirmed || !requestId || check?.classification !== "NOT_FOUND") return;
    setBusy(true); setError(null); setResult(null);
    try {
      const payload = await post("/api/admin/zoho/test-contact/sync", {
        confirmation: "SYNC ALLOWLISTED TEST CONTACT",
        email,
        requestId
      });
      setResult(payload);
      setConfirmed(false);
      setRequestId("");
    } catch (cause) {
      setResult({ classification: "FAILED" });
      setError(cause instanceof Error ? cause.message : "The test contact sync failed.");
    } finally { setBusy(false); }
  }

  const checkLabel = check?.classification === "EXISTING"
    ? "Already Exists"
    : check?.classification === "NOT_FOUND"
      ? "Not Found"
      : check?.classification === "UNABLE_TO_VERIFY"
        ? "Unable to Verify"
        : null;
  const resultLabel = result?.classification?.replaceAll("_", " ") ?? null;

  return <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
    <Card className={panelClass}>
      <div className="flex items-start gap-3"><MailCheck className="mt-0.5 h-5 w-5 text-primary"/><div><h2 className="text-lg font-semibold text-foreground">Test Contact Sync</h2><p className="mt-1 text-sm text-secondary">Check or add one approved internal test email to the configured mailing list. Names and custom fields are not synchronized.</p></div></div>
      <label className="mt-5 block text-sm font-medium text-foreground" htmlFor="zoho-test-contact-email">Test email address</label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row"><input autoComplete="email" className={`${controlClass} flex-1`} id="zoho-test-contact-email" onChange={(event)=>{setEmail(event.target.value);setCheck(null);setResult(null);setConfirmed(false);setRequestId("");}} placeholder="approved.internal@kzero.com" type="email" value={email}/><Button className="h-10 shrink-0 rounded-xl" disabled={busy||!email.trim()} onClick={()=>void checkContact()} variant="outline">Check Contact</Button></div>
      {checkLabel ? <div className="mt-3 flex items-center gap-2 text-sm"><Status value={check.classification}/><span className="text-secondary">{checkLabel}{check.listStatuses?.length ? ` · ${check.listStatuses.join(", ")}` : ""}</span></div> : null}
      {check?.classification === "NOT_FOUND" ? <div className="mt-4 rounded-xl border border-warning-border bg-warning-surface p-4 text-sm text-warning"><label className="flex items-start gap-2"><input checked={confirmed} className="mt-0.5 h-4 w-4" onChange={(event)=>setConfirmed(event.target.checked)} type="checkbox"/><span>I confirm this is an approved internal test address and authorize one email-only list-add request. This does not create marketing consent.</span></label><Button className="mt-3" disabled={busy||!confirmed||!writeReady} onClick={()=>void syncContact()}>Sync Test Contact</Button>{!writeReady?<p className="mt-2 text-xs">Test writes require an individually authenticated ADMIN, configured OAuth/list access, the test-only flag, and release of the global kill switch.</p>:null}</div> : null}
      {resultLabel ? <div className="mt-4 rounded-xl border border-border bg-surface-secondary p-4"><div className="flex items-center gap-2"><Status value={result.classification}/><p className="font-medium text-foreground">{resultLabel}</p></div><p className="mt-2 text-xs text-secondary">{result.reason?.replaceAll("_"," ")}. Provider acceptance alone is not verification, consent, journey enrollment, or email delivery.</p></div> : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </Card>
    <Card className={panelClass}><h2 className="font-semibold text-foreground">Connection status</h2><div className="mt-4 grid gap-3 text-sm"><div className="flex justify-between gap-3"><span className="text-secondary">OAuth</span><Status value={config.oauthConfigured?"CONFIGURED":"MISSING"}/></div><div className="flex justify-between gap-3"><span className="text-secondary">Mailing list</span><Status value={config.listKeyPresent?"CONFIGURED":"MISSING"}/></div><div><p className="text-xs uppercase tracking-[0.14em] text-muted">Configured list</p><p className="mt-1 font-medium text-foreground">{test?.listName??"KZero Partner Onboarding"}</p></div><div className="flex justify-between gap-3"><span className="text-secondary">Test-only write</span><Status value={test?.enabled?"ENABLED":"DISABLED"}/></div><div className="flex justify-between gap-3"><span className="text-secondary">Global kill switch</span><Status value={config.globalKillSwitch?"ENABLED":"DISABLED"}/></div><p className="rounded-xl border border-border bg-surface-secondary px-3 py-2 text-xs text-muted">The ListKey and OAuth credentials remain server-side and are never returned to this page.</p></div></Card>
  </div>;
}

function OverviewView({ overview }: { overview: any }) {
  const c = overview.counts;
  return <div className="grid gap-4">
    <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr))]"><Metric label="Pending" value={c.pending}/><Metric label="Held" value={c.held} warning={c.held > 0}/><Metric label="Retrying" value={c.retrying}/><Metric label="Failed" value={c.failed} warning={c.failed > 0}/><Metric label="Processing" value={c.processing}/><Metric label="Uncertain" value={c.uncertain} warning={c.uncertain > 0}/><Metric label="Active nudges" value={overview.nudgeSummary.activeNudgeCount}/></section>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className={panelClass}><h2 className="text-lg font-semibold text-foreground">Operational health</h2><div className="mt-4 grid gap-3 text-sm text-secondary sm:grid-cols-2"><p>Last successful contact sync<br/><span className="text-foreground">{formatDate(overview.lastSuccessfulSynchronization)}</span></p><p>Last nudge evaluation<br/><span className="text-foreground">{formatDate(overview.nudgeSummary.lastEvaluationTimestamp)} · {overview.nudgeSummary.lastEvaluationOutcome ?? "Never run"}</span></p><p>Pending nudges<br/><span className="text-foreground">{overview.nudgeSummary.preparedWaitingNudgeCount}</span></p><p>Urgent stop failures<br/><span className="text-foreground">{overview.nudgeSummary.urgentStopSyncFailureCount}</span></p></div><p className="mt-4 rounded-xl border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning">Queued or provider-accepted events are not proof that an email was delivered.</p></Card>
      <Card className={panelClass}><h2 className="text-lg font-semibold text-foreground">Journey readiness</h2><div className="mt-4 grid gap-3">{overview.journeys.map((journey: any) => <div className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0" key={journey.id}><div><p className="font-medium text-foreground">{journey.id.replace("_", "-")} · {journey.name}</p><p className="text-xs text-muted">Configuration only; membership and completion are not inferred.</p></div><Status value={journey.configured ? "CONFIGURED" : "UNVERIFIED"}/></div>)}</div></Card>
    </div>
      <Card className={panelClass}><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 text-warning"/><div><h2 className="font-semibold text-foreground">Urgent stop-state monitoring</h2><p className="mt-1 text-sm text-secondary">A local task change does not prove Zoho received the update that stops a wait or reminder.</p></div></div>{overview.stopEvents.length ? <div className={tableWrapClass}><table className={`${tableClass} min-w-[820px]`}><thead className="bg-surface-secondary text-xs uppercase text-muted"><tr><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Journey</th><th className="px-3 py-2">Required stop condition</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Last attempt</th><th className="px-3 py-2">Age</th></tr></thead><tbody>{overview.stopEvents.map((event:any)=><tr className="border-t border-border" key={event.id}><td className="px-3 py-3"><span className="font-medium text-foreground">{event.onboardingPlan.msp.name}</span><br/><span className="text-xs text-muted">{event.onboardingPlan.customerName ?? event.planId}</span></td><td className="px-3 py-3">{event.recipientEmailNormalized}</td><td className="px-3 py-3">{event.journey?.replace("_","-") ?? "Contact state"}</td><td className="px-3 py-3">{event.holdReason ?? event.lastSanitizedError ?? "Synchronize the current stop state"}</td><td className="px-3 py-3"><Status value={event.status}/></td><td className="px-3 py-3">{formatDate(event.lastAttemptAt)}</td><td className="px-3 py-3">{Math.max(0, Math.floor((Date.now()-new Date(event.createdAt).getTime())/3600000))}h</td></tr>)}</tbody></table></div>:<div className="mt-4"><Empty>No unresolved stop-state updates.</Empty></div>}</Card>
  </div>;
}

function EventHistory({ filters, onChange, onSelect, payload }: any) {
  const update = (key:string,value:any) => onChange((current:any)=>({...current,[key]:value,page:key==="page"?value:1}));
  return <Card className="min-w-0 border-border bg-surface p-4 md:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-foreground">Event history</h2><p className="mt-1 text-sm text-secondary">Durable outbox activity and journey outcomes. No row represents confirmed email delivery.</p></div><span className="text-sm text-muted">{payload?.total ?? 0} events</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted"/><input aria-label="Search events" className="h-10 w-full rounded-xl border border-border bg-input pl-9 pr-3 text-sm text-foreground" onChange={e=>update("query",e.target.value)} placeholder="Search plan, MSP, recipient" value={filters.query}/></label><input aria-label="Plan filter" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={e=>update("plan",e.target.value)} placeholder="Plan / MSP / customer" value={filters.plan}/><input aria-label="Recipient filter" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={e=>update("recipient",e.target.value)} placeholder="Recipient" value={filters.recipient}/><select aria-label="Journey filter" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={e=>update("journey",e.target.value)} value={filters.journey}><option value="">All journeys</option><option value="J1">J1</option><option value="J3_R1">J3-R1</option><option value="J5">J5</option><option value="J8">J8</option></select><select aria-label="Event type filter" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={e=>update("eventType",e.target.value)} value={filters.eventType}><option value="">All event types</option><option value="UPSERT_CONTACT">Contact sync</option><option value="TRIGGER_JOURNEY">Journey trigger</option></select><select aria-label="Status filter" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={e=>update("status",e.target.value)} value={filters.status}><option value="">All statuses</option>{["PENDING","PROCESSING","SUCCEEDED","HELD","RETRY","DEAD","CANCELLED"].map(v=><option key={v}>{v}</option>)}</select><input aria-label="From date" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={e=>update("from",e.target.value)} type="date" value={filters.from}/><input aria-label="To date" className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={e=>update("to",e.target.value)} type="date" value={filters.to}/></div>{payload?.events.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="text-xs uppercase text-muted"><tr><th className="pb-3"><button className="inline-flex items-center" onClick={()=>{update("sort","createdAt");update("direction",filters.direction==="desc"?"asc":"desc")}}>Date/time <ArrowUpDown className="ml-1 h-3 w-3"/></button></th><th>MSP / customer</th><th>Type</th><th>Recipient</th><th>Event</th><th>Journey</th><th>Status</th><th>Attempts</th><th>Last attempt</th><th>Next retry</th><th>Details</th></tr></thead><tbody>{payload.events.map((event:any)=><tr className="border-t border-border" key={event.id}><td className="py-3 whitespace-nowrap">{formatDate(event.createdAt)}</td><td><span className="font-medium text-foreground">{event.onboardingPlan.msp.name}</span><br/><span className="text-xs text-muted">{event.onboardingPlan.customerName ?? event.planId} · {event.onboardingPlan.tenantType ?? "Plan"}</span></td><td>{event.isStopState?"Stop update":"Standard"}</td><td>{event.recipientEmailNormalized}</td><td>{event.eventType.replaceAll("_"," ")}</td><td>{event.journey?.replace("_","-")??"—"}</td><td><Status value={event.journeyOutcome==="UNKNOWN"?"UNKNOWN":event.status}/></td><td>{event.attemptCount}</td><td>{formatDate(event.lastAttemptAt)}</td><td>{formatDate(event.nextAttemptAt)}</td><td><button className="font-medium text-primary hover:underline" onClick={()=>onSelect(event)}>View</button></td></tr>)}</tbody></table></div>:<div className="mt-4"><Empty>No automation events match these filters.</Empty></div>}<div className="mt-4 flex items-center justify-between"><Button disabled={!payload||payload.page<=1} onClick={()=>update("page",payload.page-1)} variant="outline"><ChevronLeft className="mr-1 h-4 w-4"/>Previous</Button><span className="text-sm text-muted">Page {payload?.page??1} of {Math.max(1,Math.ceil((payload?.total??0)/(payload?.pageSize??25)))}</span><Button disabled={!payload||payload.page*payload.pageSize>=payload.total} onClick={()=>update("page",payload.page+1)} variant="outline">Next<ChevronRight className="ml-1 h-4 w-4"/></Button></div></Card>;
}

function ReminderPreview({ filters, onChange, payload, rows }: any) {
  return <div className="grid gap-4"><Card className="border-border bg-surface p-5"><h2 className="text-lg font-semibold text-foreground">Reminder eligibility preview</h2><p className="mt-1 text-sm text-secondary">This preview shows which cases would qualify for reminders. Viewing it does not send emails or change onboarding state.</p><div className="mt-4 flex flex-wrap gap-2"><select className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={e=>onChange({...filters,eligibility:e.target.value})} value={filters.eligibility}><option value="">All decisions</option><option>Eligible</option><option>Not Eligible</option><option>Blocked</option></select><select className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground" onChange={e=>onChange({...filters,phase:e.target.value})} value={filters.phase}><option value="">All phases</option>{["Kickoff","Tenant Setup","App Review","SSO Rollout","First Customer Pilot"].map(v=><option key={v}>{v}</option>)}</select></div>{rows.length?<div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="text-xs uppercase text-muted"><tr><th className="pb-3">MSP / customer</th><th>Phase</th><th>Active task</th><th>Owner / status</th><th>Waiting</th><th>Threshold</th><th>Next eligible</th><th>Recipient</th><th>Decision</th><th>Reason</th></tr></thead><tbody>{rows.map((row:any)=><tr className="border-t border-border" key={row.planId}><td className="py-3"><span className="font-medium text-foreground">{row.mspName}</span><br/><span className="text-xs text-muted">{row.customerName??row.planId}</span></td><td>{row.currentPhase}</td><td>{row.currentTask??"—"}</td><td>{row.taskOwner??"—"}<br/><span className="text-xs text-muted">{row.taskStatus??"—"}</span></td><td>{row.elapsedBusinessDays==null?"—":`${row.elapsedBusinessDays} business days`}</td><td>{row.thresholdBusinessDays??"—"}</td><td>{formatDate(row.nextEligibleAt)}</td><td>{row.recipient??"—"}</td><td><Status value={row.eligibility.toUpperCase().replaceAll(" ","_")}/></td><td>{row.reason.replaceAll("_"," ")}</td></tr>)}</tbody></table></div>:<div className="mt-4"><Empty>No cases match this preview filter.</Empty></div>}</Card><Card className="border-border bg-surface p-5"><h2 className="font-semibold text-foreground">Last actual evaluation</h2><p className="mt-2 text-sm text-secondary">{payload?.summary?.lastEvaluationTimestamp?`${formatDate(payload.summary.lastEvaluationTimestamp)} · ${payload.summary.lastEvaluationOutcome}`:"No persisted daily evaluation has run."}</p></Card></div>;
}

function ContactsView({ onQuery, payload, query, sensitiveReason }: any) {
  return <Card className="border-border bg-surface p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-semibold text-foreground">Contacts & communication conflicts</h2><p className="mt-1 text-sm text-secondary">One normalized email may have only one active plan communication context.</p></div><label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted"/><input className="h-10 rounded-xl border border-border bg-input pl-9 pr-3 text-sm text-foreground" onChange={e=>onQuery(e.target.value)} placeholder="Search recipient" value={query}/></label></div><div className="mt-4 rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning"><p className="font-medium">Sensitive actions are disabled</p><p className="mt-1 text-xs">{sensitiveReason??"An individually attributable administrator session is required."}</p></div>{payload?.recipients.length?<div className="mt-4 grid gap-3">{payload.recipients.map((item:any)=><div className="rounded-xl border border-border bg-surface-secondary p-4" key={item.recipient}><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><p className="font-medium text-foreground">{item.recipient}</p><p className="mt-1 text-xs text-muted">Owner: {item.context?.owningPlan ? `${item.context.owningPlan.msp.name} · ${item.context.owningPlan.customerName ?? item.context.owningPlan.planId}` : "No assigned plan"}</p><p className="mt-1 text-xs text-muted">{item.plans.length} plan reference(s) · {item.heldEventCount} held event(s) · last sync {formatDate(item.lastSuccessfulSync)}</p></div><div className="flex flex-wrap gap-2"><Status value={item.context?.state??"UNASSIGNED"}/>{item.outstandingJourneyUncertainty.length?<Status value="UNKNOWN"/>:null}</div></div><div className="mt-3 grid gap-2 md:grid-cols-2">{item.plans.map((plan:any)=><div className="rounded-lg border border-border bg-input px-3 py-2 text-sm" key={`${plan.planId}-${plan.contactId}`}><p className="font-medium text-foreground">{plan.msp.name} · {plan.customerName??plan.planId}</p><p className="mt-1 text-xs text-muted">{plan.tenantType??"Plan"} · {plan.role.replaceAll("_"," ")} · enrollment {plan.automationEnrollmentState}</p><div className="mt-2 flex flex-wrap gap-2"><Status value={plan.subscriptionStatus}/>{plan.automationEnabled?<Status value="ACTIVE"/>:null}</div>{plan.subscriptionVerificationSource?<p className="mt-2 text-xs text-secondary">Evidence: {plan.subscriptionVerificationSource} · {formatDate(plan.subscriptionVerifiedAt)}</p>:null}</div>)}</div>{item.holdReason?<p className="mt-3 text-xs text-danger">Hold reason: {item.holdReason}</p>:null}<div className="mt-3 flex flex-wrap gap-2">{["Assign Context","Request Release","Confirm ZMA Clear and Release","Requeue Held Events","Cancel Event","Verify Subscription","Enroll Historical Plan"].map(label=><Button disabled key={label} title={sensitiveReason} variant="outline">{label}</Button>)}</div></div>)}</div>:<div className="mt-4"><Empty>No plan contacts match this search.</Empty></div>}</Card>;
}

function ConfigurationView({ overview }: { overview: any }) {
  const c=overview.configuration;
  const rows=[
    ["Staff identity provider",c.staffIdentityConfigured],
    ["OAuth configuration",c.oauthConfigured],["Field mapping verified",c.fieldMappingVerified],["Private list verified",c.listPrivacyVerified],["List key present",c.listKeyPresent],["Topic configured",c.topicIdPresent],["Portal base URL",c.portalBaseUrlPresent],["Event emission",c.eventEmissionEnabled],["Contact synchronization",c.contactSynchronizationEnabled],["Journey triggering",c.journeyTriggeringEnabled],["Automatic dispatch",c.automaticDispatchEnabled],["Nudge evaluation",c.nudgeEvaluationEnabled],["Global kill switch",c.globalKillSwitch],["CRON_SECRET present",c.cronSecretPresent],["Production dispatch approved",c.productionDispatchApproved]
  ];
  return <div className="grid gap-4 lg:grid-cols-2"><Card className="border-border bg-surface p-5"><h2 className="text-lg font-semibold text-foreground">Configuration & health</h2><p className="mt-1 text-sm text-secondary">Values show presence or enablement only. Secrets are never returned.</p><div className="mt-4 grid gap-2">{rows.map(([label,value])=><div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0" key={String(label)}><span className="text-sm text-secondary">{String(label)}</span><Status value={value?"ENABLED":"DISABLED"}/></div>)}</div></Card><Card className="border-border bg-surface p-5"><h2 className="text-lg font-semibold text-foreground">Execution posture</h2><div className="mt-4 space-y-3 text-sm text-secondary"><p>Dispatch mode: <span className="font-medium text-foreground">{c.dispatchMode}</span></p><p>Test mode: <span className="font-medium text-foreground">{c.testMode.enabled?"Enabled":"Disabled"}</span></p><p>Approved test recipients: <span className="font-medium text-foreground">{c.testMode.allowlistedEmailCount}</span></p><p>Approved test plans: <span className="font-medium text-foreground">{c.testMode.allowlistedPlanCount}</span></p><div className="grid gap-2">{overview.journeys.map((journey:any)=><div className="flex items-center justify-between gap-3" key={journey.id}><span>{journey.id.replace("_","-")} · {journey.name}</span><Status value={journey.configured?"CONFIGURED":"UNVERIFIED"}/></div>)}</div><p className="rounded-xl border border-warning-border bg-warning-surface px-3 py-2 text-warning">Production controls are intentionally read-only. This page cannot activate dispatch, journeys, nudges, or cron.</p></div></Card></div>;
}

function EventDetails({ event, onClose }: { event:any; onClose:()=>void }) {
  return <div aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" role="dialog"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.18em] text-muted">Sanitized event details</p><h2 className="mt-1 text-lg font-semibold text-foreground">{event.eventType.replaceAll("_"," ")}</h2></div><Button onClick={onClose} variant="outline">Close</Button></div><dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">Plan</dt><dd className="mt-1 text-foreground">{event.planId}</dd></div><div><dt className="text-muted">Recipient</dt><dd className="mt-1 break-all text-foreground">{event.recipientEmailNormalized}</dd></div><div><dt className="text-muted">Status</dt><dd className="mt-1"><Status value={event.status}/></dd></div><div><dt className="text-muted">Journey outcome</dt><dd className="mt-1 text-foreground">{event.journeyOutcome??"No journey result"}</dd></div><div><dt className="text-muted">Task / handoff</dt><dd className="mt-1 text-foreground">{event.taskKey??event.handoffKey??"—"}</dd></div><div><dt className="text-muted">Provider outcome</dt><dd className="mt-1 text-foreground">{event.lastProviderOutcome??"—"}</dd></div><div className="sm:col-span-2"><dt className="text-muted">Hold / error</dt><dd className="mt-1 rounded-lg border border-border bg-input p-3 text-foreground">{event.holdReason??event.lastSanitizedError??"No sanitized error recorded."}</dd></div></dl><div className="mt-5 rounded-xl border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning">Retry, cancellation, reconciliation, and context controls require an individually attributable administrator identity and are disabled for the shared session.</div></div></div>;
}
