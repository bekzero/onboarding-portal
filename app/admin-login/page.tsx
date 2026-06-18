import Link from "next/link";
import { LockKeyhole } from "lucide-react";
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
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 md:px-10">
      <div className="mb-4 flex justify-between gap-3">
        <Link href="/" className="text-sm text-slate-400 transition-colors hover:text-blue-200">
          Back
        </Link>
      </div>

      <main className="grid gap-6">
        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(135deg,#1e3a75_0%,#111d32_52%,#09111d_100%)] p-0">
          <div className="grid gap-8 px-6 py-8 md:px-8 md:py-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="space-y-5">
              <div className="flex justify-start lg:justify-center">
                <KzeroLogo
                  className="w-fit"
                  imageClassName="h-auto w-[160px] sm:w-[190px] lg:w-[220px]"
                  priority
                  surface="dark"
                  variant="horizontal"
                />
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
                  Admin Access
                </h1>
                <p className="max-w-2xl text-base leading-7 text-blue-100/78">
                  Enter the temporary access code provided by KZero to open the onboarding dashboard.
                </p>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-[#0b1424]/80 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <LockKeyhole className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Secure Entry</p>
                  <p className="text-sm text-slate-300">Validated on the server before dashboard access is granted.</p>
                </div>
              </div>

              <form action={submitAdminLogin} className="mt-5 grid gap-3">
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Access code</span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!isConfigured}
                    name="accessCode"
                    placeholder="Enter access code"
                    type="password"
                  />
                </label>

                {params.error ? (
                  <p className="text-sm text-amber-200">That access code was not recognized. Please try again.</p>
                ) : null}

                {!isConfigured || params.setup ? (
                  <p className="text-sm text-amber-200">
                    Admin access is not configured yet. Set `ADMIN_ACCESS_CODE` and `ADMIN_SESSION_COOKIE` in your environment to enable sign-in.
                  </p>
                ) : null}

                <Button className="h-11 px-5" disabled={!isConfigured} type="submit">
                  Sign In
                </Button>
              </form>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
