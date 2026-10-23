"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { KzeroLogo } from "@/components/kzero-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const TENANT_STORAGE_KEY = "kzero-demo-tenant";

export default function StartPage() {
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
      not_found: "We could not find that onboarding portal. Check the MSP or tenant name, or contact your KZero Passwordless Sales Engineer.",
      oidc_not_configured: "KZero Passwordless sign-in is not fully configured for this onboarding portal yet. Contact your KZero Passwordless Sales Engineer for help.",
      plan_not_found: "We could not open that onboarding portal. Confirm the plan is enrolled and try again.",
      portal_unavailable: "The onboarding portal is temporarily unavailable. Check database migration and environment variables, then try again.",
      session_required: "Your sign-in session expired or could not be verified. Please start again from your onboarding portal lookup.",
      signin_failed: "We could not complete KZero Passwordless sign-in. Please try again or contact your KZero Passwordless Sales Engineer."
    };

    setError(messages[errorCode] ?? messages.not_found);
  }, []);

  async function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    const lookupValue = tenantName.trim();

    window.localStorage.setItem(TENANT_STORAGE_KEY, lookupValue);
    setIsLoading(true);

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
          : "We could not find that onboarding portal. Check the MSP or tenant name, or contact your KZero Passwordless Sales Engineer."
      );
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface/90">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 md:px-10">
          <KzeroLogo className="shrink-0" imageClassName="w-[168px] sm:w-[180px]" priority />
          <nav className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:justify-end" aria-label="Portal navigation">
            <Link
              className="inline-flex items-center rounded-lg py-2 text-sm font-medium text-secondary transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              href="/"
            >
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to Home
            </Link>
            <Link
              className="ml-auto rounded-lg py-2 text-sm font-medium text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:ml-0"
              href="/admin-login"
            >
              Admin Sign In
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
        <Card className="w-full max-w-[540px] border-border bg-surface p-6 shadow-panel sm:p-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Find Your Onboarding Plan</h1>
            <p className="mt-2 text-sm leading-6 text-secondary">
              Enter the name provided by your KZero Passwordless Sales Engineer to continue.
            </p>
          </div>

          <form className="mt-6" onSubmit={handleContinue}>
            <label className="block text-sm font-medium text-secondary" htmlFor="tenant-name">
              MSP, Customer, or Tenant Name
            </label>
            <input
              aria-describedby={error ? "tenant-name-error tenant-name-help" : "tenant-name-help"}
              aria-invalid={Boolean(error)}
              autoComplete="organization"
              className="mt-2 h-12 w-full rounded-xl border border-border-strong bg-input px-4 text-sm text-foreground outline-none transition placeholder:text-muted-subtle focus:border-primary focus:ring-2 focus:ring-primary/25 sm:text-base"
              id="tenant-name"
              name="tenantName"
              onChange={(event) => {
                setTenantName(event.target.value);
                setError("");
              }}
              placeholder="Enter your organization or tenant name"
              required
              value={tenantName}
            />

            {error ? (
              <p className="mt-2 text-sm leading-5 text-warning" id="tenant-name-error" role="alert">
                {error}
              </p>
            ) : null}

            <p className="mt-2 text-xs leading-5 text-muted" id="tenant-name-help">
              For an MSP NFR Plan, enter your MSP name. For a Customer Plan, enter the customer name.
            </p>

            <Button
              className="mt-5 h-12 w-full whitespace-nowrap rounded-xl px-5"
              disabled={isLoading}
              type="submit"
            >
              {isLoading ? "Continuing..." : "Continue"}
              {!isLoading ? <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /> : null}
            </Button>
          </form>

          <p className="mt-6 border-t border-border pt-5 text-sm leading-6 text-muted">
            Not sure which name to enter? Contact your KZero Passwordless Sales Engineer.
          </p>
        </Card>
      </main>
    </div>
  );
}
