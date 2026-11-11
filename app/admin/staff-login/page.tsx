import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { signInStaff } from "@/app/admin/staff/actions";
import { KzeroLogo } from "@/components/kzero-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isStaffOidcConfigured } from "@/lib/staff-auth";

export default async function StaffLoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string }> }) {
  const params = await searchParams;
  const configured = await isStaffOidcConfigured();
  const returnTo = params.returnTo?.startsWith("/admin") ? params.returnTo : "/admin";
  return <main className="mx-auto flex min-h-[100dvh] w-full max-w-[520px] items-center px-4 py-6 sm:px-6">
    <Card className="w-full border-border bg-surface p-6 shadow-panel sm:p-8">
      <div className="flex items-start justify-between gap-4"><KzeroLogo priority/><ThemeToggle/></div>
      <p className="mt-7 text-xs uppercase tracking-[0.2em] text-muted">KZero Passwordless</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Staff sign in</h1>
      <p className="mt-2 text-sm leading-6 text-secondary">Use your approved KZero employee identity. Customer and partner tenant identities cannot authorize this area.</p>
      {params.error ? <p className="mt-4 rounded-xl border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger" role="alert">Staff sign-in failed or the identity is not authorized.</p> : null}
      {configured ? <form action={signInStaff} className="mt-6"><input name="returnTo" type="hidden" value={returnTo}/><Button className="h-12 w-full" type="submit"><ShieldCheck className="mr-2 h-4 w-4"/>Continue with KZero Staff Identity</Button></form> : <div className="mt-6 rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning"><p className="font-medium">Staff identity provider not configured</p><p className="mt-1 text-xs leading-5">An approved issuer, client and application-role mapping must be configured before individual sign-in is available. Sensitive actions remain disabled.</p></div>}
      <div className="mt-6 border-t border-border pt-5 text-sm"><Link className="font-medium text-primary hover:underline" href="/admin-login">Use transitional admin access</Link><p className="mt-2 text-xs text-muted">Shared access supports existing dashboard work but never sensitive Zoho operations.</p></div>
    </Card>
  </main>;
}
