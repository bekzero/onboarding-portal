"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildKzeroIssuerForTenant, findTenantByInput, getDemoPlanUrlForTenant } from "@/lib/tenant-routing";

const TENANT_STORAGE_KEY = "kzero-demo-tenant";

export default function StartPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const storedTenant = window.localStorage.getItem(TENANT_STORAGE_KEY);
    if (storedTenant) {
      setTenantName(storedTenant);
    }
  }, []);

  function handleContinue() {
    const tenant = findTenantByInput(tenantName);

    window.localStorage.setItem(TENANT_STORAGE_KEY, tenantName);

    if (!tenant) {
      setError(
        "We could not find that onboarding portal. Check the tenant name or contact your KZero Sales Engineer."
      );
      return;
    }

    setError("");

    // Future production redirect:
    // /api/auth/signin/keycloak?callbackUrl=/portal/resolve
    // or a tenant-aware OIDC start route built from the allowlisted KZero issuer.
    const demoUrl = getDemoPlanUrlForTenant(tenantName);
    if (demoUrl) {
      router.push(demoUrl);
    }
  }

  const tenant = findTenantByInput(tenantName);
  const issuerPreview = tenant ? buildKzeroIssuerForTenant(tenant.tenantSlug) : null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 md:px-10">
      <div className="mb-4 flex justify-between gap-3">
        <Link href="/" className="text-sm text-slate-400 transition-colors hover:text-blue-200">
          Back
        </Link>
        <Link href="/internal" className="text-sm text-slate-400 transition-colors hover:text-blue-200">
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
                  Find your KZero onboarding portal
                </h1>
                <p className="max-w-2xl text-base leading-7 text-blue-100/78">
                  Enter the KZero tenant name provided by your KZero Sales Engineer to continue to your onboarding login flow.
                </p>
              </div>
              <div className="grid max-w-xl gap-3">
                <label className="grid gap-2 text-sm text-blue-100/82">
                  <span>Tenant name</span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#0b1424]/90 px-4 py-3 text-white outline-none placeholder:text-slate-500"
                    onChange={(event) => setTenantName(event.target.value)}
                    placeholder="your-tenant-name"
                    value={tenantName}
                  />
                </label>
                <p className="text-sm text-slate-300">
                  Enter the KZero tenant name provided by your KZero Sales Engineer.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button className="h-11 px-5" onClick={handleContinue}>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Link href="/demo/abcmsp-nfr">
                    <Button className="h-11 px-5" variant="outline">
                      View demo checklist
                    </Button>
                  </Link>
                </div>
                <p className="text-sm text-blue-100/78">Testing? Use ABCMSP.</p>
                {error ? <p className="text-sm text-amber-200">{error}</p> : null}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-[#0b1424]/80 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Tenant discovery</p>
                  <p className="text-sm text-slate-300">Demo allowlist before tenant-specific OIDC routing</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  Known demo tenants are validated against an allowlisted tenant registry.
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  Future production flow will redirect into the tenant-specific KZero OIDC sign-in experience.
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  {issuerPreview
                    ? `Issuer preview: ${issuerPreview}`
                    : "Issuer preview appears here once a known tenant is entered."}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
