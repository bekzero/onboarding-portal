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

      if (!response.ok) {
        throw new Error("lookup_failed");
      }

      const payload = (await response.json()) as {
        found: boolean;
        msp?: {
          accessMode: "temporary" | "oidc";
          destination?: "demo" | "portal";
          planId: string;
        };
      };

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
    } catch {
      setError(
        "We could not find that onboarding portal. Check the MSP or tenant name, or contact your KZero Sales Engineer."
      );
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 md:px-10">
      <div className="mb-4 flex justify-between gap-3">
        <Link href="/" className="text-sm text-slate-400 transition-colors hover:text-blue-200">
          Back
        </Link>
        <Link href="/admin-login" className="text-sm text-slate-400 transition-colors hover:text-blue-200">
          Admin
        </Link>
      </div>

      <main className="grid gap-6">
        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(135deg,#1e3a75_0%,#111d32_52%,#09111d_100%)] p-0">
          <div className="px-6 py-8 md:px-8 md:py-10">
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <KzeroLogo className="w-fit" imageClassName="h-auto w-[220px]" priority surface="dark" />
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
                  Find Your KZero Onboarding Portal
                </h1>
                <p className="max-w-2xl text-base leading-7 text-blue-100/78">
                  Enter your MSP name or KZero tenant name to continue into your onboarding plan.
                </p>
              </div>
              <div className="grid max-w-xl gap-3">
                <label className="grid gap-2 text-sm text-blue-100/82">
                  <span>MSP or tenant name</span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#0b1424]/90 px-4 py-3 text-white outline-none placeholder:text-slate-500"
                    onChange={(event) => {
                      setTenantName(event.target.value);
                      setError("");
                    }}
                    placeholder="your-tenant-name"
                    value={tenantName}
                  />
                </label>
                <p className="text-sm text-slate-300">
                  Enter the MSP or tenant name provided by your KZero Sales Engineer.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button className="h-11 px-5" onClick={handleContinue}>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                {error ? <p className="text-sm text-amber-200">{error}</p> : null}
              </div>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
