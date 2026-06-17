"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { readAdminCaseOverridesFromStorage } from "@/lib/admin-case-storage";
import { buildTenantRegistry, readDemoEnrollmentsFromStorage, tenantRegistry, type TenantRegistryEntry } from "@/lib/tenant-routing";

const TENANT_STORAGE_KEY = "kzero-demo-tenant";

export default function StartPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState("");
  const [registry, setRegistry] = useState<TenantRegistryEntry[]>(tenantRegistry);

  useEffect(() => {
    const storedTenant = window.localStorage.getItem(TENANT_STORAGE_KEY);
    const enrollments = readDemoEnrollmentsFromStorage();
    const overrides = readAdminCaseOverridesFromStorage();

    if (storedTenant) {
      setTenantName(storedTenant);
    }

    setRegistry(buildTenantRegistry(enrollments, overrides));
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

      router.push(`/demo/${payload.msp.planId}`);
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
          <div className="grid gap-8 px-6 py-8 md:px-8 md:py-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-blue-100">
                  <Search className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-100/80">
                  KZero Passwordless
                </p>
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
                  Enter your MSP name or the KZero tenant name provided by your KZero Sales Engineer.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button className="h-11 px-5" onClick={handleContinue}>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Link href="/demo/abcmsp-nfr">
                    <Button className="h-11 px-5" variant="outline">
                      View Setup Checklist
                    </Button>
                  </Link>
                </div>
                <p className="text-sm text-blue-100/78">If KZero shared an ABCMSP workspace with you, enter ABCMSP.</p>
                {error ? <p className="text-sm text-amber-200">{error}</p> : null}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-[#0b1424]/80 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Access Options</p>
                  <p className="text-sm text-slate-300">Flexible onboarding access for every stage of rollout.</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  We match your MSP or tenant name to the onboarding workspace shared by KZero.
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  Temporary MSP access can open your onboarding workspace before the tenant is deployed.
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  Organizations with KZero sign-in enabled will continue through their secure sign-in experience.
                </div>
              </div>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
