import Link from "next/link";
import { KeyRound } from "lucide-react";
import { signInStaff } from "@/app/admin/staff/actions";
import { authorizeStaffSsoBootstrap } from "@/app/admin/settings/sso/actions";
import { AdminSessionUnavailable } from "@/components/admin-session-unavailable";
import { KzeroLogo } from "@/components/kzero-logo";
import { StaffSsoSettings } from "@/components/staff-sso-settings";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCurrentStaffIdentity, hasAnyAdminAccess, hasAdminSession } from "@/lib/admin-auth";
import { hasStaffSsoBootstrapAuthorization } from "@/lib/staff-sso-bootstrap";
import { getStoredStaffSsoConfiguration, serializeStaffSsoConfiguration } from "@/lib/staff-sso-config";

export const dynamic = "force-dynamic";

export default async function StaffSsoPage({ searchParams }: { searchParams: Promise<{ bootstrap?: string }> }) {
  if (!(await hasAnyAdminAccess())) return <AdminSessionUnavailable/>;
  const identity = await getCurrentStaffIdentity(); const shared = await hasAdminSession(); const bootstrap = await hasStaffSsoBootstrapAuthorization();
  const configuration = serializeStaffSsoConfiguration(await getStoredStaffSsoConfiguration());
  const canConfigure = identity?.role === "ADMIN" || (shared && bootstrap && (!configuration?.bootstrapRetiredAt || process.env.STAFF_SSO_EMERGENCY_RECOVERY_ENABLED === "true"));
  const params = await searchParams;
  return <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-5 md:px-6 md:py-6">
    <header className="mb-4 flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><KzeroLogo/><div><p className="text-xs uppercase tracking-[0.18em] text-muted">Settings</p><h1 className="text-2xl font-semibold text-foreground">Staff SSO</h1></div></div><div className="flex items-center gap-2"><ThemeToggle/><Link className="text-sm font-medium text-primary hover:underline" href="/admin">Back to dashboard</Link></div></header>
    {!canConfigure ? <Card className="mb-4 border-warning-border bg-warning-surface p-4"><div className="flex gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-warning"/><div><p className="font-medium text-foreground">Sensitive configuration is locked</p><p className="mt-1 text-sm text-secondary">An individually authenticated ADMIN is required. During initial setup only, a shared dashboard session plus the separate deployment-owner bootstrap secret unlocks a short, audited setup window.</p>{shared && !configuration?.bootstrapRetiredAt ? <form action={authorizeStaffSsoBootstrap} className="mt-3 flex max-w-lg flex-col gap-2 sm:flex-row"><input className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-input px-3 text-sm" name="bootstrapSecret" placeholder="Deployment-owner bootstrap secret" type="password" autoComplete="off" required/><Button type="submit" variant="outline">Authorize setup</Button></form> : null}{params.bootstrap === "denied" ? <p className="mt-2 text-sm text-danger">Bootstrap authorization was rejected.</p> : null}</div></div></Card> : null}
    {configuration && configuration.status !== "ENABLED" ? <Card className="mb-4 border-border bg-surface p-4"><p className="font-medium text-foreground">Test actual staff authentication</p><p className="mt-1 text-sm text-secondary">First approve the administrator's exact issuer subject below, then launch the real Authorization Code + PKCE flow. Passing discovery alone is insufficient.</p><form action={signInStaff} className="mt-3"><input name="returnTo" type="hidden" value="/admin/settings/sso?signin=tested"/><Button type="submit" variant="outline">Test Staff Sign-In</Button></form></Card> : null}
    <StaffSsoSettings initial={configuration} canConfigure={canConfigure}/>
  </main>;
}
