"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Identity = { id: string; issuer: string; subject: string; email: string | null; displayName: string | null; role: "ADMIN" | "SALES_ENGINEER" | "VIEWER"; active: boolean; verifiedAt: string | null; lastAuthenticatedAt: string | null };
export type StaffSsoView = { realmName: string; clientId: string; issuerUrl: string; applicationOrigin: string; redirectUri: string; postLogoutRedirectUri: string; adminRoleClaim: string | null; salesEngineerRoleClaim: string | null; viewerRoleClaim: string | null; approvedGroupClaim: string | null; status: string; secretConfigured: boolean; discoveryValidatedAt: string | null; authenticationTestedAt: string | null; enabledAt: string | null; bootstrapRetiredAt: string | null; identities: Identity[] } | null;

const inputClass = "mt-1 h-11 w-full rounded-xl border border-border bg-input px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

export function StaffSsoSettings({ initial, canConfigure }: { initial: StaffSsoView; canConfigure: boolean }) {
  const origin = initial?.applicationOrigin || "";
  const [form, setForm] = useState({ realmName: initial?.realmName || "", clientId: initial?.clientId || "", clientSecret: "", issuerUrl: initial?.issuerUrl || "", applicationOrigin: origin, postLogoutRedirectUri: initial?.postLogoutRedirectUri || `${origin}/admin-login`, adminRoleClaim: initial?.adminRoleClaim || "", salesEngineerRoleClaim: initial?.salesEngineerRoleClaim || "", viewerRoleClaim: initial?.viewerRoleClaim || "", approvedGroupClaim: initial?.approvedGroupClaim || "" });
  const [configuration, setConfiguration] = useState(initial);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const redirectUri = `${form.applicationOrigin.replace(/\/$/, "")}/api/auth/callback/kzero-staff`;
  const issuer = form.realmName ? `https://ca.auth.kzero.com/realms/${form.realmName}` : "";
  useEffect(() => {
    if (!form.applicationOrigin) setForm((current) => ({ ...current, applicationOrigin: window.location.origin, postLogoutRedirectUri: `${window.location.origin}/admin-login` }));
  }, [form.applicationOrigin]);

  async function save() {
    setBusy("save"); setMessage(null);
    try {
      const response = await fetch("/api/admin/settings/sso", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, issuerUrl: issuer }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      setConfiguration(payload.configuration); setForm((old) => ({ ...old, clientSecret: "" })); setMessage({ type: "ok", text: "Draft saved. The stored client secret will not be shown again." });
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Save failed." }); } finally { setBusy(""); }
  }
  async function action(name: string, extra: Record<string, unknown> = {}) {
    setBusy(name); setMessage(null);
    try {
      const response = await fetch("/api/admin/settings/sso/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: name, ...extra }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      const current = await fetch("/api/admin/settings/sso", { cache: "no-store" }).then((item) => item.json()); setConfiguration(current.configuration);
      setMessage({ type: "ok", text: name === "test-discovery" ? "Connection validation passed. This does not prove a user can sign in." : "Action completed." });
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Action failed." }); } finally { setBusy(""); }
  }
  async function addIdentity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await action("upsert-identity", { issuer: configuration?.issuerUrl || issuer, subject: data.get("subject"), email: data.get("email"), displayName: data.get("displayName"), role: data.get("role") });
    event.currentTarget.reset();
  }
  const label = (title: string, name: keyof typeof form, type = "text") => <label className="text-sm font-medium text-foreground">{title}<input className={inputClass} disabled={!canConfigure} type={type} value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })}/></label>;
  return <div className="grid gap-4">
    {message ? <div className={`rounded-xl border px-4 py-3 text-sm ${message.type === "ok" ? "border-success-border bg-success-surface text-success" : "border-danger-border bg-danger-surface text-danger"}`} role="status">{message.text}</div> : null}
    <Card className="border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-foreground">OIDC configuration</h2><p className="mt-1 text-sm text-secondary">KZero Passwordless employee identity only. Customer tenant realms are rejected.</p></div><span className="rounded-full border border-border bg-input px-3 py-1 text-xs font-semibold text-secondary">{configuration?.status || "NOT CONFIGURED"}</span></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">{label("Realm / Tenant Name", "realmName")}{label("Client ID", "clientId")}<label className="text-sm font-medium text-foreground">Client Secret <span className="text-xs font-normal text-muted">{configuration?.secretConfigured ? "Stored securely •••••••• — enter only to rotate" : "Required"}</span><input className={inputClass} disabled={!canConfigure} type="password" autoComplete="new-password" value={form.clientSecret} onChange={(event) => setForm({ ...form, clientSecret: event.target.value })}/></label>{label("Application Origin", "applicationOrigin")}</div>
      <div className="mt-4 grid gap-4"> <label className="text-sm font-medium text-foreground">OIDC Issuer URL<input className={inputClass} readOnly value={issuer}/></label><label className="text-sm font-medium text-foreground">Redirect URI<div className="mt-1 flex gap-2"><input className={`${inputClass} mt-0`} readOnly value={redirectUri}/><Button aria-label="Copy redirect URI" onClick={() => navigator.clipboard.writeText(redirectUri)} type="button" variant="outline"><Copy className="h-4 w-4"/></Button></div></label>{label("Post-logout redirect", "postLogoutRedirectUri")}</div>
      <details className="mt-5 rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium text-foreground">Optional approved role/group claim mapping</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{label("ADMIN claim", "adminRoleClaim")}{label("SALES_ENGINEER claim", "salesEngineerRoleClaim")}{label("VIEWER claim", "viewerRoleClaim")}{label("Required group claim", "approvedGroupClaim")}</div></details>
      <div className="mt-5 flex flex-wrap gap-2"><Button disabled={!canConfigure || !!busy} onClick={save}>{busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}Save Draft</Button><Button disabled={!canConfigure || !configuration || !!busy} onClick={() => action("validate")} variant="outline">Validate Configuration</Button><Button disabled={!canConfigure || !configuration || !!busy} onClick={() => action("test-discovery")} variant="outline">Test Discovery</Button><Button disabled={!canConfigure || !configuration || !!busy} onClick={() => configuration?.status === "ENABLED" ? action("disable") : (window.confirm("Enable Staff SSO for approved identities? The transitional recovery path remains available but cannot authorize sensitive operations.") && action("enable"))} variant="outline">{configuration?.status === "ENABLED" ? "Disable Staff SSO" : "Enable Staff SSO"}</Button></div>
    </Card>
    <Card className="border-border bg-surface p-5"><h2 className="text-lg font-semibold text-foreground">Configuration status</h2><div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><Status label="Secret encrypted" good={Boolean(configuration?.secretConfigured)}/><Status label="Discovery validated" good={Boolean(configuration?.discoveryValidatedAt)}/><Status label="Actual sign-in tested" good={Boolean(configuration?.authenticationTestedAt)}/><Status label="Staff SSO enabled" good={configuration?.status === "ENABLED"}/></div></Card>
    <Card className="border-border bg-surface p-5"><div><h2 className="text-lg font-semibold text-foreground">Authorized staff identities</h2><p className="mt-1 text-sm text-secondary">Access is keyed by trusted issuer and immutable subject. Email never grants access by itself.</p></div>
      <form className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-5" onSubmit={addIdentity}><input className={inputClass} disabled={!canConfigure} name="subject" placeholder="Subject ID" required/><input className={inputClass} disabled={!canConfigure} name="email" placeholder="Email (display only)" type="email"/><input className={inputClass} disabled={!canConfigure} name="displayName" placeholder="Display name"/><select className={inputClass} disabled={!canConfigure} name="role"><option>ADMIN</option><option>SALES_ENGINEER</option><option>VIEWER</option></select><Button className="mt-1 h-11" disabled={!canConfigure || !configuration} type="submit">Approve Identity</Button></form>
      <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">{configuration?.identities.length ? configuration.identities.map((identity) => <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" key={identity.id}><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{identity.displayName || identity.email || identity.subject}</p><p className="truncate text-xs text-muted">{identity.role} · subject {identity.subject} · {identity.verifiedAt ? "sign-in verified" : "awaiting test sign-in"}</p></div><Button aria-label={`Remove ${identity.email || identity.subject}`} className="h-9 px-3" disabled={!canConfigure} onClick={() => action("remove-identity", { id: identity.id })} type="button" variant="outline"><Trash2 className="h-4 w-4"/></Button></div>) : <p className="px-4 py-6 text-sm text-muted">No approved staff identities. Add the exact subject of the initial administrator before testing sign-in.</p>}</div>
    </Card>
  </div>;
}

function Status({ label, good }: { label: string; good: boolean }) { return <div className="flex items-center gap-2 rounded-xl border border-border bg-input px-3 py-2 text-secondary">{good ? <CheckCircle2 className="h-4 w-4 text-success"/> : <ShieldAlert className="h-4 w-4 text-warning"/>}<span>{label}</span></div>; }
