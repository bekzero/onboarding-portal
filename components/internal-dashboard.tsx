"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Clock3,
  Copy,
  Filter,
  Gauge,
  PlusCircle,
  TimerReset
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { OnboardingCase, TenantType, User } from "@/lib/mock-data";
import {
  buildKzeroIssuerForTenant,
  DemoEnrollment,
  normalizeTenantName,
  readDemoEnrollmentsFromStorage,
  saveDemoEnrollmentsToStorage
} from "@/lib/tenant-routing";

const filterChips = [
  "All",
  "Waiting on MSP",
  "Waiting on KZero",
  "In progress",
  "Complete"
];

type EnrollmentFormState = {
  assignedSalesEngineer: string;
  clientId: string;
  clientSecret: string;
  mspName: string;
  primaryContactEmail: string;
  startingPlanType: TenantType;
  tenantName: string;
};

function formatDateLabel() {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function enrollmentToCase(enrollment: DemoEnrollment): OnboardingCase {
  return {
    accessMode: enrollment.accessMode,
    actionHref: `/demo/${enrollment.planId}`,
    assignedSalesEngineer: enrollment.assignedSalesEngineer,
    currentStage: "Kickoff",
    lastActivity: enrollment.enrolledAt,
    mspName: enrollment.mspName,
    mspSlug: enrollment.mspSlug,
    oidcClientId: enrollment.oidcClientId,
    oidcClientSecretConfigured: enrollment.oidcClientSecretConfigured,
    oidcStatus: enrollment.oidcStatus,
    onboardingPlanId: enrollment.planId,
    primaryContactEmail: enrollment.primaryContactEmail,
    progress: 0,
    status: "waiting_on_msp",
    startingPlanType: enrollment.startingPlanType,
    submittedSaasAppCount: 0,
    tenantName: enrollment.tenantName
  };
}

function getAccessLabel(item: OnboardingCase) {
  if (item.accessMode === "temporary") {
    return "Temporary access";
  }

  return item.oidcStatus === "configured" ? "OIDC configured" : "OIDC missing";
}

export function InternalDashboard({
  baseCases,
  salesEngineers
}: {
  baseCases: OnboardingCase[];
  salesEngineers: User[];
}) {
  const [demoEnrollments, setDemoEnrollments] = useState<DemoEnrollment[]>([]);
  const [copiedIssuer, setCopiedIssuer] = useState(false);
  const [formState, setFormState] = useState<EnrollmentFormState>({
    assignedSalesEngineer: salesEngineers[0]?.name ?? "Morgan Lee",
    clientId: "",
    clientSecret: "",
    mspName: "",
    primaryContactEmail: "",
    startingPlanType: "nfr",
    tenantName: ""
  });

  useEffect(() => {
    setDemoEnrollments(readDemoEnrollmentsFromStorage());
  }, []);

  const issuerPreview = buildKzeroIssuerForTenant(formState.tenantName);

  const onboardingCases = useMemo(() => {
    const enrolledCases = demoEnrollments.map(enrollmentToCase);
    return [...enrolledCases, ...baseCases];
  }, [baseCases, demoEnrollments]);

  const waitingOnMsp = onboardingCases.filter((item) => item.status === "waiting_on_msp").length;
  const waitingOnKZero = onboardingCases.filter((item) => item.status === "waiting_on_kzero").length;
  const averageProgress =
    onboardingCases.length === 0
      ? 0
      : Math.round(onboardingCases.reduce((total, item) => total + item.progress, 0) / onboardingCases.length);

  function handleSubmit() {
    const normalizedMspSlug = normalizeTenantName(formState.mspName);
    const normalizedTenant = normalizeTenantName(formState.tenantName);
    const trimmedMspName = formState.mspName.trim();
    const trimmedPrimaryContactEmail = formState.primaryContactEmail.trim();
    const trimmedClientId = formState.clientId.trim();
    const hasAnyOidcConfig = Boolean(normalizedTenant || trimmedClientId || formState.clientSecret.trim());
    const hasFullOidcConfig = Boolean(normalizedTenant && trimmedClientId && formState.clientSecret.trim());

    if (!trimmedMspName || !trimmedPrimaryContactEmail || !normalizedMspSlug) {
      return;
    }

    const newEnrollment: DemoEnrollment = {
      accessMode: hasAnyOidcConfig ? "oidc" : "temporary",
      assignedSalesEngineer: formState.assignedSalesEngineer,
      enrolledAt: formatDateLabel(),
      mspName: trimmedMspName,
      mspSlug: normalizedMspSlug,
      oidcClientId: trimmedClientId || undefined,
      oidcClientSecretConfigured: Boolean(formState.clientSecret.trim()),
      oidcStatus: hasFullOidcConfig ? "configured" : "not_configured",
      planId: `${normalizedMspSlug}-nfr`,
      primaryContactEmail: trimmedPrimaryContactEmail,
      startingPlanType: formState.startingPlanType,
      tenantName: normalizedTenant || undefined
    };

    const nextEnrollments = [
      newEnrollment,
      ...demoEnrollments.filter((item) => item.mspSlug !== normalizedMspSlug)
    ];

    // TODO: production must send this configuration to a secure backend.
    // Never persist real client secrets in frontend state, localStorage, or source files.
    saveDemoEnrollmentsToStorage(nextEnrollments);
    setDemoEnrollments(nextEnrollments);
    setFormState({
      assignedSalesEngineer: salesEngineers[0]?.name ?? "Morgan Lee",
      clientId: "",
      clientSecret: "",
      mspName: "",
      primaryContactEmail: "",
      startingPlanType: "nfr",
      tenantName: ""
    });
  }

  async function handleCopyIssuer() {
    if (!issuerPreview) {
      return;
    }

    try {
      await navigator.clipboard.writeText(issuerPreview);
      setCopiedIssuer(true);
      window.setTimeout(() => setCopiedIssuer(false), 1500);
    } catch {
      setCopiedIssuer(false);
    }
  }

  return (
    <main className="grid gap-6">
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-white/10 bg-[#101a2d]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <PlusCircle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white">Enroll MSP</h2>
              <p className="mt-1 text-sm text-slate-300">
                Add a temporary MSP onboarding portal now, then configure tenant-based OIDC later when the realm is ready.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm text-slate-300">
              <span>MSP name</span>
              <input
                className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none placeholder:text-slate-500"
                onChange={(event) => setFormState((current) => ({ ...current, mspName: event.target.value }))}
                placeholder="ABCMSP"
                value={formState.mspName}
              />
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>Primary contact email</span>
              <input
                className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none placeholder:text-slate-500"
                onChange={(event) =>
                  setFormState((current) => ({ ...current, primaryContactEmail: event.target.value }))
                }
                placeholder="contact@abcmsp.com"
                type="email"
                value={formState.primaryContactEmail}
              />
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>Assigned Sales Engineer</span>
              <select
                className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                onChange={(event) =>
                  setFormState((current) => ({ ...current, assignedSalesEngineer: event.target.value }))
                }
                value={formState.assignedSalesEngineer}
              >
                {salesEngineers.map((engineer) => (
                  <option key={engineer.id} value={engineer.name}>
                    {engineer.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>Starting plan type</span>
              <select
                className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    startingPlanType: event.target.value as TenantType
                  }))
                }
                value={formState.startingPlanType}
              >
                <option value="nfr">NFR tenant</option>
                <option value="customer">Customer tenant</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>Tenant name / realm</span>
              <input
                className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none placeholder:text-slate-500"
                onChange={(event) => setFormState((current) => ({ ...current, tenantName: event.target.value }))}
                placeholder="abcmsp"
                value={formState.tenantName}
              />
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>OIDC client ID</span>
              <input
                className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none placeholder:text-slate-500"
                onChange={(event) => setFormState((current) => ({ ...current, clientId: event.target.value }))}
                placeholder="portal-onboarding-client"
                value={formState.clientId}
              />
            </label>
            <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
              <span>OIDC client secret</span>
              <input
                className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none placeholder:text-slate-500"
                onChange={(event) => setFormState((current) => ({ ...current, clientSecret: event.target.value }))}
                placeholder="Enter secret"
                type="password"
                value={formState.clientSecret}
              />
            </label>
          </div>

          <div className="mt-6 rounded-[1.3rem] border border-white/10 bg-[#0a1424] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-white">Issuer preview</p>
                <p className="mt-1 text-sm text-slate-300">
                  {issuerPreview ?? "Optional until the MSP has a KZero tenant and OIDC is configured."}
                </p>
              </div>
              <Button onClick={handleCopyIssuer} variant="outline">
                <Copy className="mr-2 h-4 w-4" />
                {copiedIssuer ? "Copied" : "Copy issuer URL"}
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={handleSubmit}>Enroll MSP</Button>
            {normalizeTenantName(formState.mspName) ? (
              <Link href={`/demo/${normalizeTenantName(formState.mspName)}-nfr`}>
                <Button variant="outline">Test login</Button>
              </Link>
            ) : null}
          </div>
        </Card>

        <section className="grid gap-6 md:grid-cols-3 xl:grid-cols-1">
          <Card className="border-white/10 bg-[#101a2d]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Total onboarding cases</p>
                <p className="mt-1 text-3xl font-semibold text-white">{onboardingCases.length}</p>
              </div>
            </div>
          </Card>
          <Card className="border-white/10 bg-[#101a2d]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-400/15 text-blue-200">
                <TimerReset className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Waiting on MSP</p>
                <p className="mt-1 text-3xl font-semibold text-white">{waitingOnMsp}</p>
              </div>
            </div>
          </Card>
          <Card className="border-white/10 bg-[#101a2d]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-200">
                <Clock3 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Waiting on KZero</p>
                <p className="mt-1 text-3xl font-semibold text-white">{waitingOnKZero}</p>
              </div>
            </div>
          </Card>
          <Card className="border-white/10 bg-[#101a2d] md:col-span-3 xl:col-span-1">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-200">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Average progress</p>
                <p className="mt-1 text-3xl font-semibold text-white">{averageProgress}%</p>
              </div>
            </div>
          </Card>
        </section>
      </section>

      <Card className="border-white/10 bg-[#101a2d]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">MSP onboarding cases</h2>
            <p className="mt-1 text-sm text-slate-300">Monitor onboarding progress, owner state, and tenant enrollment status.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <Badge key={chip}>{chip}</Badge>
            ))}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0a1424]">
          <div className="hidden grid-cols-[1.3fr_0.9fr_1fr_0.9fr_1fr_0.8fr_1fr_1fr_0.9fr_0.8fr] gap-3 border-b border-white/10 px-5 py-4 text-xs uppercase tracking-[0.22em] text-slate-400 lg:grid">
            <span>MSP</span>
            <span>Tenant</span>
            <span>Current stage</span>
            <span>Progress</span>
            <span>Owner / waiting on</span>
            <span>OIDC</span>
            <span>Submitted apps</span>
            <span>Sales Engineer</span>
            <span>Last activity</span>
            <span>Action</span>
          </div>

          <div className="grid">
            {onboardingCases.map((item) => (
              <div
                key={item.onboardingPlanId}
                className="grid gap-4 border-b border-white/10 px-5 py-4 last:border-b-0 lg:grid-cols-[1.3fr_0.9fr_1fr_0.9fr_1fr_0.8fr_1fr_1fr_0.9fr_0.8fr] lg:items-center"
              >
                <div>
                  <p className="font-medium text-white">{item.mspName}</p>
                  <p className="mt-1 text-sm text-slate-400 lg:hidden">MSP slug: {item.mspSlug}</p>
                </div>
                <div>
                  <p className="hidden text-sm text-slate-300 lg:block">{item.tenantName ?? item.mspSlug}</p>
                  <p className="mt-1 text-xs text-slate-500 lg:mt-0">{item.startingPlanType.toUpperCase()}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-300">{item.currentStage}</p>
                  <p className="mt-1 text-sm text-slate-400 lg:hidden">Last activity: {item.lastActivity}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{item.progress}%</p>
                  <div className="mt-2 h-2 rounded-full bg-white/10">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge status={item.status}>{getAccessLabel(item)}</Badge>
                </div>
                <div>
                  <p className="text-sm text-white">
                    {item.oidcStatus === "configured"
                      ? "Configured"
                      : item.accessMode === "temporary"
                        ? "Temporary access"
                        : "OIDC missing"}
                  </p>
                  {item.oidcClientSecretConfigured ? (
                    <p className="mt-1 text-xs text-slate-400">Secret: ********</p>
                  ) : null}
                </div>
                <p className="text-sm text-slate-300">{item.submittedSaasAppCount}</p>
                <p className="text-sm text-slate-300">{item.assignedSalesEngineer}</p>
                <p className="hidden text-sm text-slate-300 lg:block">{item.lastActivity}</p>
                <div className="flex flex-col gap-2">
                  <Link
                    href={item.actionHref}
                    className="inline-flex items-center gap-2 text-sm font-medium text-blue-200 transition-colors hover:text-blue-100"
                  >
                    Test login
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <span className="text-xs text-slate-400">
                    {item.oidcStatus === "configured" ? "Edit OIDC config" : "Configure OIDC"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="border-white/10 bg-[#101a2d]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Filter className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Security note</h3>
            <p className="mt-1 text-sm text-slate-300">
              Demo enrollment stores only whether a client secret is configured. Production must store OIDC client secrets server-side using encrypted storage or a secrets manager.
            </p>
          </div>
        </div>
      </Card>
    </main>
  );
}
