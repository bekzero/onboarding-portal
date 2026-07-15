"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { KzeroLogo } from "@/components/kzero-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const TENANT_STORAGE_KEY = "kzero-demo-tenant";

export default function StartPage() {
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const storedTenant = window.localStorage.getItem(TENANT_STORAGE_KEY);

    if (storedTenant) {
      setTenantName(storedTenant);
    }
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const errorCode = searchParams.get("error");

    if (!errorCode) {
      return;
    }

    const messages: Record<string, string> = {
      ambiguous: "We found more than one onboarding case for that lookup. Enter the customer name for Customer Plan access, or use the exact MSP or tenant name for the NFR Plan.",
      not_found: "We could not find that onboarding portal. Check the MSP or tenant name, or contact your KZero Sales Engineer.",
      oidc_not_configured: "KZero sign-in is not fully configured for this onboarding portal yet. Contact your KZero Sales Engineer for help.",
      plan_not_found: "We could not open that onboarding portal. Confirm the plan is enrolled and try again.",
      portal_unavailable: "The onboarding portal is temporarily unavailable. Check database migration and environment variables, then try again.",
      session_required: "Your sign-in session expired or could not be verified. Please start again from your onboarding portal lookup.",
      signin_failed: "We could not complete KZero sign-in. Please try again or contact your KZero Sales Engineer."
    };

    setError(messages[errorCode] ?? messages.not_found);
  }, []);

  async function handleContinue() {
    const lookupValue = tenantName.trim();

    window.localStorage.setItem(TENANT_STORAGE_KEY, lookupValue);

    try {
      const response = await fetch(`/api/tenant-lookup?lookup=${encodeURIComponent(lookupValue)}`, {
        cache: "no-store"
      });

      const payload = (await response.json()) as {
        ambiguous?: boolean;
        found: boolean;
        matches?: Array<{
          customerName?: string;
          displayName: string;
          mspName: string;
          planId: string;
          planType: "nfr" | "customer";
        }>;
        msp?: {
          accessMode: "temporary" | "oidc";
          destination?: "demo" | "portal";
          planId: string;
        };
      };

      if (response.status === 409 && payload.ambiguous) {
        const labels = payload.matches?.map((match) => {
          if (match.planType === "customer") {
            return `${match.displayName} (managed by ${match.mspName})`;
          }

          return `${match.mspName} (NFR Plan)`;
        }) ?? [];

        throw new Error(
          labels.length > 0
            ? `Multiple onboarding cases matched that lookup: ${labels.join(", ")}. Enter the customer name for Customer Plan access or the exact MSP name for the NFR Plan.`
            : "We found more than one onboarding case for that lookup. Enter the customer name for Customer Plan access, or use the exact MSP or tenant name for the NFR Plan."
        );
      }

      if (!response.ok) {
        throw new Error("lookup_failed");
      }

      if (!payload.found || !payload.msp) {
        throw new Error("not_found");
      }

      setError("");

      if (payload.msp.accessMode === "oidc") {
        window.location.assign(`/api/oidc/start?tenant=${encodeURIComponent(lookupValue)}`);
        return;
      }

      if (payload.msp.destination === "demo") {
        window.location.assign(`/demo/${payload.msp.planId}`);
        return;
      }

      window.location.assign(`/api/portal/temporary-start?lookup=${encodeURIComponent(lookupValue)}`);
    } catch (error) {
      setError(
        error instanceof Error && error.message && error.message !== "lookup_failed" && error.message !== "not_found"
          ? error.message
          : "We could not find that onboarding portal. Check the MSP or tenant name, or contact your KZero Sales Engineer."
      );
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 md:px-10 md:py-8">
      <header className="rounded-[1.6rem] border border-white/10 bg-[#101a2d] px-5 py-4 shadow-panel md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <KzeroLogo className="w-fit shrink-0" imageClassName="h-auto w-[210px]" priority surface="dark" />
          <div className="flex flex-wrap gap-3">
            <Link href="/">
              <Button className="h-10 px-4" variant="outline">
                Back to Home
              </Button>
            </Link>
            <Link href="/admin-login">
              <Button className="h-10 px-4" variant="outline">
                Admin Sign In
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mt-5 grid gap-6">
        <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(64,109,191,0.35),transparent_34%),linear-gradient(135deg,#1d376d_0%,#111d32_54%,#09111d_100%)] p-0">
          <div className="grid gap-8 px-6 py-8 md:px-8 md:py-10 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
            <div className="space-y-5">
              <div className="inline-flex rounded-full border border-blue-200/15 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-blue-100/80">
                Secure Portal Lookup
              </div>
              <div className="space-y-4">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-5xl xl:text-[3.35rem]">
                  Find Your KZero Passwordless Onboarding Portal
                </h1>
                <p className="max-w-3xl text-base leading-7 text-blue-100/78 md:text-lg">
                  Enter the MSP name for an NFR Plan, or the customer name for a Customer Plan, exactly as provided by your KZero Passwordless Sales Engineer.
                </p>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-[#0b1424]/88 p-6">
              <div className="space-y-4">
                <div>
                  <p className="text-lg font-semibold text-white">Continue To Your Workspace</p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    Use the exact MSP, customer, or tenant name shared with your team.
                  </p>
                </div>
                <div className="grid gap-3">
                  <label className="grid gap-2 text-sm text-blue-100/82">
                    <span>MSP, Customer, or Tenant Name</span>
                    <input
                      className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none placeholder:text-slate-500"
                      onChange={(event) => {
                        setTenantName(event.target.value);
                        setError("");
                      }}
                      placeholder="Enter your MSP, customer, or tenant name"
                      value={tenantName}
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Button className="h-11 px-5" onClick={handleContinue}>
                      Continue
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                  {error ? <p className="text-sm leading-6 text-amber-200">{error}</p> : null}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
