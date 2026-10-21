import Link from "next/link";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { submitAdminLogin } from "@/app/admin-login/actions";
import { KzeroLogo } from "@/components/kzero-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isAdminAccessConfigured } from "@/lib/admin-auth";

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; setup?: string }>;
}) {
  const params = await searchParams;
  const isConfigured = isAdminAccessConfigured();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-10">
      <main className="w-full">
        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(145deg,#142443_0%,#0d1829_48%,#09111d_100%)] p-0 shadow-panel">
          <div className="border-b border-white/10 px-6 py-6 sm:px-8">
            <KzeroLogo
              className="w-fit"
              imageClassName="h-auto w-[180px]"
              priority
              surface="dark"
              variant="horizontal"
            />
          </div>

          <div className="px-6 py-8 sm:px-8 sm:py-9">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/15 bg-blue-400/[0.08] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-blue-100/85">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              KZero Internal
            </div>

            <div className="mt-5 flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <LockKeyhole className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white">Employee sign in</h1>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Sign in to manage MSP onboarding, tenant deployment, and customer rollout plans.
                </p>
              </div>
            </div>

            <form action={submitAdminLogin} className="mt-7 grid gap-4">
              <label className="grid gap-2 text-sm font-medium text-slate-200">
                <span>Admin password</span>
                <input
                  autoComplete="current-password"
                  autoFocus
                  className="h-12 rounded-2xl border border-white/10 bg-[#08111f] px-4 text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!isConfigured}
                  name="password"
                  placeholder="Enter your admin password"
                  required
                  type="password"
                />
              </label>

              {params.error ? (
                <p className="text-sm text-amber-200" role="alert">The password is incorrect. Please try again.</p>
              ) : null}

              {!isConfigured || params.setup ? (
                <p className="text-sm text-amber-200" role="alert">
                  Employee sign-in is currently unavailable. Contact the portal administrator for assistance.
                </p>
              ) : null}

              <Button className="h-12 w-full px-5" disabled={!isConfigured} type="submit">
                Sign in to Admin Portal
              </Button>
            </form>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5">
              <p className="text-sm font-medium text-white">Authorized KZero employees only</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                This workspace contains internal onboarding and customer deployment information.
              </p>
            </div>
          </div>
        </Card>

        <p className="mt-5 text-center text-sm text-slate-400">
          MSP partner?{" "}
          <Link className="font-medium text-blue-200 transition hover:text-blue-100" href="/start">
            Go to your onboarding portal
          </Link>
        </p>
      </main>
    </div>
  );
}
