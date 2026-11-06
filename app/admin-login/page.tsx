import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { submitAdminLogin } from "@/app/admin-login/actions";
import { AdminLoginSubmit } from "@/components/admin-login-submit";
import { KzeroLogo } from "@/components/kzero-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { isStaffOidcConfigured } from "@/lib/staff-auth";

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; setup?: string; reason?: string; staff?: string }>;
}) {
  const params = await searchParams;
  const hasSignInError = Boolean(params.error || params.setup);
  const staffConfigured = isStaffOidcConfigured();

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[500px] items-center px-4 py-5 sm:px-6 sm:py-8">
      <main className="w-full">
        <Card className="border-border bg-surface p-6 shadow-panel sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <KzeroLogo priority />
            <ThemeToggle />
          </div>

          <div className="mt-7">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Admin Portal</h1>
            <p className="mt-2 text-sm leading-6 text-secondary">
              Sign in to manage MSP and customer onboarding.
            </p>

            {params.reason === "session_expired" ? <p className="mt-4 rounded-xl border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning" role="alert">Your administrative session is unavailable or has expired. Sign in again.</p> : null}
            {params.staff === "logged_out" ? <p className="mt-4 rounded-xl border border-border bg-input px-3 py-2 text-sm text-secondary">You have been signed out of the staff session.</p> : null}

            <a className={`${buttonVariants()} mt-6 flex h-12 w-full`} href="/admin/staff-login">
              {staffConfigured ? "Sign in with KZero Staff Identity" : "Staff identity setup required"}
            </a>

            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.16em] text-muted"><span className="h-px flex-1 bg-border"/><span>Transitional access</span><span className="h-px flex-1 bg-border"/></div>

            <form action={submitAdminLogin} className="grid gap-4">
              <label className="grid gap-2 text-sm font-medium text-secondary" htmlFor="admin-access-code">
                <span>Admin Access Code</span>
                <input
                  autoComplete="current-password"
                  autoFocus
                  className="h-12 w-full rounded-xl border border-border-strong bg-input px-4 text-base text-foreground outline-none transition placeholder:text-muted-subtle focus:border-primary focus:ring-2 focus:ring-primary/25"
                  id="admin-access-code"
                  name="password"
                  placeholder="Enter your access code"
                  required
                  type="password"
                />
              </label>

              {hasSignInError ? (
                <p className="text-sm leading-5 text-warning" role="alert">
                  We couldn&apos;t sign you in. Verify your access code or contact the portal administrator.
                </p>
              ) : null}

              <AdminLoginSubmit />
            </form>

            <div className="mt-6 flex items-center gap-2 border-t border-border pt-5 text-xs text-muted">
              <ShieldCheck className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
              <p>Authorized KZero Passwordless personnel only</p>
            </div>
          </div>
        </Card>

        <p className="mt-4 text-center text-sm text-muted">
          MSP partner?{" "}
          <Link className="font-medium text-info transition hover:text-info" href="/start">
            Go to your onboarding portal
          </Link>
        </p>
      </main>
    </div>
  );
}
