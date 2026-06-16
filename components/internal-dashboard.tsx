"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Clock3,
  Eye,
  Gauge,
  KeyRound,
  Pencil,
  PlusCircle,
  TimerReset
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { OnboardingCase, TenantType, User } from "@/lib/mock-data";
import {
  readAdminCaseOverridesFromStorage,
  saveAdminCaseOverridesToStorage,
  type AdminCaseOverride
} from "@/lib/admin-case-storage";
import {
  buildKzeroIssuerForTenant,
  DemoEnrollment,
  normalizeTenantName,
  readDemoEnrollmentsFromStorage,
  saveDemoEnrollmentsToStorage
} from "@/lib/tenant-routing";

const SALES_ENGINEER_NAME = "Ben Eakin";

type PanelMode = "preview" | "edit" | "oidc" | "enroll";

type EnrollmentFormState = {
  accessMode: OnboardingCase["accessMode"];
  clientId: string;
  clientSecret: string;
  currentStage: string;
  lastActivity: string;
  mspName: string;
  primaryContactEmail: string;
  progress: number;
  startingPlanType: TenantType;
  status: OnboardingCase["status"];
  submittedSaasAppCount: number;
  tenantName: string;
};

type EditFormState = {
  accessMode: OnboardingCase["accessMode"];
  currentStage: string;
  lastActivity: string;
  mspName: string;
  primaryContactEmail: string;
  progress: number;
  status: OnboardingCase["status"];
  submittedSaasAppCount: number;
  tenantName: string;
};

type OidcFormState = {
  clientId: string;
  clientSecret: string;
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
    assignedSalesEngineer: SALES_ENGINEER_NAME,
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
  return item.accessMode === "temporary" ? "Temporary access" : "KZero OIDC";
}

function getWaitingLabel(item: OnboardingCase) {
  if (item.progress >= 100 || item.status === "complete") {
    return "Complete";
  }

  if (item.status === "waiting_on_kzero") {
    return "Waiting on KZero";
  }

  if (item.status === "waiting_on_msp") {
    return "Waiting on MSP";
  }

  return "In progress";
}

function getStatusTone(item: OnboardingCase) {
  if (item.progress >= 100 || item.status === "complete") {
    return "complete" as const;
  }

  if (item.status === "waiting_on_kzero") {
    return "waiting_on_kzero" as const;
  }

  if (item.status === "waiting_on_msp") {
    return "waiting_on_msp" as const;
  }

  return "in_progress" as const;
}

function createEnrollmentState(): EnrollmentFormState {
  return {
    accessMode: "temporary",
    clientId: "",
    clientSecret: "",
    currentStage: "Kickoff",
    lastActivity: formatDateLabel(),
    mspName: "",
    primaryContactEmail: "",
    progress: 0,
    startingPlanType: "nfr",
    status: "waiting_on_msp",
    submittedSaasAppCount: 0,
    tenantName: ""
  };
}

function createEditState(item: OnboardingCase): EditFormState {
  return {
    accessMode: item.accessMode,
    currentStage: item.currentStage,
    lastActivity: item.lastActivity,
    mspName: item.mspName,
    primaryContactEmail: item.primaryContactEmail,
    progress: item.progress,
    status: item.status,
    submittedSaasAppCount: item.submittedSaasAppCount,
    tenantName: item.tenantName ?? ""
  };
}

function createOidcState(item: OnboardingCase): OidcFormState {
  return {
    clientId: item.oidcClientId ?? "",
    clientSecret: "",
    tenantName: item.tenantName ?? ""
  };
}

function DashboardTable({
  emptyLabel,
  items,
  onConfigureOidc,
  onEdit,
  onView,
  title
}: {
  emptyLabel: string;
  items: OnboardingCase[];
  onConfigureOidc: (item: OnboardingCase) => void;
  onEdit: (item: OnboardingCase) => void;
  onView: (item: OnboardingCase) => void;
  title: string;
}) {
  return (
    <Card className="border-white/10 bg-[#101a2d]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-300">{items.length} MSPs</p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#0a1424]">
        <div className="hidden grid-cols-[1.3fr_0.9fr_0.9fr_1fr_0.7fr_0.9fr_0.6fr_0.9fr_0.9fr_1fr] gap-3 border-b border-white/10 px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-400 lg:grid">
          <span>MSP</span>
          <span>Access</span>
          <span>Tenant</span>
          <span>Current stage</span>
          <span>Progress</span>
          <span>Waiting on</span>
          <span>Apps</span>
          <span>Last activity</span>
          <span>Sales Engineer</span>
          <span>Actions</span>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-400">{emptyLabel}</div>
        ) : (
          <div className="grid">
            {items.map((item) => (
              <div
                key={item.onboardingPlanId}
                className="grid gap-3 border-b border-white/10 px-4 py-4 last:border-b-0 lg:grid-cols-[1.3fr_0.9fr_0.9fr_1fr_0.7fr_0.9fr_0.6fr_0.9fr_0.9fr_1fr] lg:items-center"
              >
                <div>
                  <p className="font-medium text-white">{item.mspName}</p>
                  <p className="mt-1 text-xs text-slate-400">{item.primaryContactEmail}</p>
                </div>
                <div>
                  <Badge status={getStatusTone(item)}>{getAccessLabel(item)}</Badge>
                </div>
                <div className="text-sm text-slate-300">{item.tenantName ?? "Not configured"}</div>
                <div className="text-sm text-slate-300">{item.currentStage}</div>
                <div>
                  <p className="text-sm font-medium text-white">{item.progress}%</p>
                  <div className="mt-2 h-1.5 rounded-full bg-white/10">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
                <div>
                  <Badge status={getStatusTone(item)}>{getWaitingLabel(item)}</Badge>
                </div>
                <div className="text-sm text-slate-300">{item.submittedSaasAppCount}</div>
                <div className="text-sm text-slate-300">{item.lastActivity}</div>
                <div className="text-sm text-slate-300">{SALES_ENGINEER_NAME}</div>
                <div className="flex flex-wrap gap-2">
                  <Button className="h-8 px-3" onClick={() => onView(item)} variant="outline">
                    <Eye className="mr-2 h-3.5 w-3.5" />
                    View case
                  </Button>
                  <Button className="h-8 px-3" onClick={() => onEdit(item)} variant="outline">
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Edit MSP
                  </Button>
                  <Button className="h-8 px-3" onClick={() => onConfigureOidc(item)} variant="outline">
                    <KeyRound className="mr-2 h-3.5 w-3.5" />
                    Configure OIDC
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function InternalDashboard({
  baseCases
}: {
  baseCases: OnboardingCase[];
  salesEngineers: User[];
}) {
  const [demoEnrollments, setDemoEnrollments] = useState<DemoEnrollment[]>([]);
  const [caseOverrides, setCaseOverrides] = useState<Record<string, AdminCaseOverride>>({});
  const [panelMode, setPanelMode] = useState<PanelMode>("preview");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [enrollmentState, setEnrollmentState] = useState<EnrollmentFormState>(createEnrollmentState);
  const [editState, setEditState] = useState<EditFormState | null>(null);
  const [oidcState, setOidcState] = useState<OidcFormState | null>(null);

  useEffect(() => {
    setDemoEnrollments(readDemoEnrollmentsFromStorage());
    setCaseOverrides(readAdminCaseOverridesFromStorage());
  }, []);

  const onboardingCases = useMemo(() => {
    const enrolledCases = demoEnrollments.map(enrollmentToCase);
    return [...enrolledCases, ...baseCases].map((item) => ({
      ...item,
      ...caseOverrides[item.onboardingPlanId],
      assignedSalesEngineer: SALES_ENGINEER_NAME
    }));
  }, [baseCases, caseOverrides, demoEnrollments]);

  const selectedCase =
    onboardingCases.find((item) => item.onboardingPlanId === selectedCaseId) ?? onboardingCases[0] ?? null;

  useEffect(() => {
    if (!selectedCaseId && onboardingCases[0]) {
      setSelectedCaseId(onboardingCases[0].onboardingPlanId);
    }
  }, [onboardingCases, selectedCaseId]);

  const inProgressCases = onboardingCases.filter((item) => item.progress < 100);
  const completedCases = onboardingCases.filter((item) => item.progress >= 100);
  const waitingOnMsp = inProgressCases.filter((item) => item.status === "waiting_on_msp").length;
  const waitingOnKZero = inProgressCases.filter((item) => item.status === "waiting_on_kzero").length;

  const issuerPreview = buildKzeroIssuerForTenant(
    panelMode === "enroll" ? enrollmentState.tenantName : oidcState?.tenantName ?? selectedCase?.tenantName ?? ""
  );

  function persistOverrides(nextOverrides: Record<string, AdminCaseOverride>) {
    setCaseOverrides(nextOverrides);
    saveAdminCaseOverridesToStorage(nextOverrides);
  }

  function openPreview(item: OnboardingCase) {
    setSelectedCaseId(item.onboardingPlanId);
    setPanelMode("preview");
  }

  function openEdit(item: OnboardingCase) {
    setSelectedCaseId(item.onboardingPlanId);
    setEditState(createEditState(item));
    setPanelMode("edit");
  }

  function openOidc(item: OnboardingCase) {
    setSelectedCaseId(item.onboardingPlanId);
    setOidcState(createOidcState(item));
    setPanelMode("oidc");
  }

  function openEnroll() {
    setEnrollmentState(createEnrollmentState());
    setPanelMode("enroll");
  }

  function handleEnroll() {
    const normalizedMspSlug = normalizeTenantName(enrollmentState.mspName);
    const normalizedTenant = normalizeTenantName(enrollmentState.tenantName);
    const trimmedMspName = enrollmentState.mspName.trim();
    const trimmedPrimaryContactEmail = enrollmentState.primaryContactEmail.trim();
    const trimmedClientId = enrollmentState.clientId.trim();
    const hasFullOidcConfig = Boolean(normalizedTenant && trimmedClientId && enrollmentState.clientSecret.trim());
    const accessMode: OnboardingCase["accessMode"] =
      hasFullOidcConfig || enrollmentState.accessMode === "oidc" ? "oidc" : "temporary";
    const nextOidcStatus: OnboardingCase["oidcStatus"] = hasFullOidcConfig ? "configured" : "not_configured";
    const progress = Math.max(0, Math.min(100, Number(enrollmentState.progress) || 0));

    if (!trimmedMspName || !trimmedPrimaryContactEmail || !normalizedMspSlug) {
      return;
    }

    const nextEnrollment: DemoEnrollment = {
      accessMode,
      assignedSalesEngineer: SALES_ENGINEER_NAME,
      enrolledAt: formatDateLabel(),
      mspName: trimmedMspName,
      mspSlug: normalizedMspSlug,
      oidcClientId: trimmedClientId || undefined,
      oidcClientSecretConfigured: Boolean(enrollmentState.clientSecret.trim()),
      oidcStatus: nextOidcStatus,
      planId: `${normalizedMspSlug}-nfr`,
      primaryContactEmail: trimmedPrimaryContactEmail,
      startingPlanType: enrollmentState.startingPlanType,
      tenantName: normalizedTenant || undefined
    };

    const nextEnrollments = [
      nextEnrollment,
      ...demoEnrollments.filter((item) => item.planId !== nextEnrollment.planId)
    ];

    saveDemoEnrollmentsToStorage(nextEnrollments);
    setDemoEnrollments(nextEnrollments);

    const nextStatus: OnboardingCase["status"] = progress >= 100 ? "complete" : enrollmentState.status;

    persistOverrides({
      ...caseOverrides,
      [nextEnrollment.planId]: {
        currentStage: enrollmentState.currentStage,
        lastActivity: enrollmentState.lastActivity,
        progress,
        accessMode,
        status: nextStatus,
        submittedSaasAppCount: enrollmentState.submittedSaasAppCount
      }
    });

    setSelectedCaseId(nextEnrollment.planId);
    setPanelMode("preview");
  }

  function handleSaveEdit() {
    if (!selectedCase || !editState) {
      return;
    }

    const nextProgress = Math.max(0, Math.min(100, Number(editState.progress) || 0));
    const normalizedTenantName = normalizeTenantName(editState.tenantName);
    const hasExistingOidcConfig = Boolean(
      selectedCase.oidcClientId && selectedCase.oidcClientSecretConfigured && (selectedCase.tenantName ?? normalizedTenantName)
    );
    const nextAccessMode: OnboardingCase["accessMode"] =
      editState.accessMode === "oidc" && hasExistingOidcConfig ? "oidc" : "temporary";
    const nextOidcStatus: OnboardingCase["oidcStatus"] =
      nextAccessMode === "oidc" ? "configured" : "not_configured";
    const waitingStatus: OnboardingCase["status"] = nextProgress >= 100 ? "complete" : editState.status;

    const nextOverrides = {
      ...caseOverrides,
      [selectedCase.onboardingPlanId]: {
        ...caseOverrides[selectedCase.onboardingPlanId],
        accessMode: nextAccessMode,
        currentStage: editState.currentStage.trim() || selectedCase.currentStage,
        lastActivity: editState.lastActivity.trim() || selectedCase.lastActivity,
        mspName: editState.mspName.trim() || selectedCase.mspName,
        oidcStatus: nextOidcStatus,
        primaryContactEmail: editState.primaryContactEmail.trim() || selectedCase.primaryContactEmail,
        progress: nextProgress,
        status: waitingStatus,
        submittedSaasAppCount: Math.max(0, Number(editState.submittedSaasAppCount) || 0),
        tenantName: normalizedTenantName || undefined
      }
    };

    persistOverrides(nextOverrides);
    setPanelMode("preview");
  }

  function handleSaveOidc() {
    if (!selectedCase || !oidcState) {
      return;
    }

    const normalizedTenant = normalizeTenantName(oidcState.tenantName);
    const trimmedClientId = oidcState.clientId.trim();
    const hasFullOidcConfig = Boolean(normalizedTenant && trimmedClientId && oidcState.clientSecret.trim());
    const accessMode: OnboardingCase["accessMode"] = hasFullOidcConfig ? "oidc" : "temporary";
    const nextOidcStatus: OnboardingCase["oidcStatus"] = hasFullOidcConfig ? "configured" : "not_configured";
    const nextStatus: OnboardingCase["status"] =
      selectedCase.progress >= 100
        ? "complete"
        : hasFullOidcConfig
          ? "waiting_on_kzero"
          : "waiting_on_msp";
    const nextOverrides = {
      ...caseOverrides,
      [selectedCase.onboardingPlanId]: {
        ...caseOverrides[selectedCase.onboardingPlanId],
        accessMode,
        lastActivity: formatDateLabel(),
        oidcClientId: trimmedClientId || undefined,
        oidcClientSecretConfigured: hasFullOidcConfig || selectedCase.oidcClientSecretConfigured,
        oidcStatus: nextOidcStatus,
        status: nextStatus,
        tenantName: normalizedTenant || undefined
      }
    };

    persistOverrides(nextOverrides);

    const enrollmentIndex = demoEnrollments.findIndex((item) => item.planId === selectedCase.onboardingPlanId);
    if (enrollmentIndex >= 0) {
      const nextEnrollments = [...demoEnrollments];
      nextEnrollments[enrollmentIndex] = {
        ...nextEnrollments[enrollmentIndex],
        accessMode,
        oidcClientId: trimmedClientId || undefined,
        oidcClientSecretConfigured: hasFullOidcConfig || nextEnrollments[enrollmentIndex].oidcClientSecretConfigured,
        oidcStatus: nextOidcStatus,
        tenantName: normalizedTenant || undefined
      };
      saveDemoEnrollmentsToStorage(nextEnrollments);
      setDemoEnrollments(nextEnrollments);
    }

    setPanelMode("preview");
  }

  return (
    <main className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="grid gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">MSP onboarding reporting</h2>
            <p className="mt-1 text-sm text-slate-300">
              Track live onboarding status, ownership, and OIDC readiness across MSP accounts.
            </p>
          </div>
          <Button className="h-10 px-4" onClick={openEnroll}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Enroll MSP
          </Button>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card className="border-white/10 bg-[#101a2d] px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Total MSPs</p>
                <p className="mt-1 text-3xl font-semibold text-white">{onboardingCases.length}</p>
              </div>
            </div>
          </Card>
          <Card className="border-white/10 bg-[#101a2d] px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-400/15 text-blue-200">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">In progress</p>
                <p className="mt-1 text-3xl font-semibold text-white">{inProgressCases.length}</p>
              </div>
            </div>
          </Card>
          <Card className="border-white/10 bg-[#101a2d] px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                <TimerReset className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Waiting on MSP</p>
                <p className="mt-1 text-3xl font-semibold text-white">{waitingOnMsp}</p>
              </div>
            </div>
          </Card>
          <Card className="border-white/10 bg-[#101a2d] px-4 py-4">
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
          <Card className="border-white/10 bg-[#101a2d] px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-200">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Completed</p>
                <p className="mt-1 text-3xl font-semibold text-white">{completedCases.length}</p>
              </div>
            </div>
          </Card>
        </section>

        <DashboardTable
          emptyLabel="No in-progress MSPs right now."
          items={inProgressCases}
          onConfigureOidc={openOidc}
          onEdit={openEdit}
          onView={openPreview}
          title="In Progress MSPs"
        />

        <DashboardTable
          emptyLabel="No completed MSPs yet."
          items={completedCases}
          onConfigureOidc={openOidc}
          onEdit={openEdit}
          onView={openPreview}
          title="Completed MSPs"
        />
      </section>

      <aside className="xl:sticky xl:top-6 xl:self-start">
        <Card className="border-white/10 bg-[#101a2d]">
          {panelMode === "preview" && selectedCase ? (
            <div className="grid gap-5">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-blue-200">Case preview</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{selectedCase.mspName}</h3>
                <p className="mt-1 text-sm text-slate-300">{selectedCase.primaryContactEmail}</p>
              </div>

              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Current stage</p>
                  <p className="mt-2 text-white">{selectedCase.currentStage}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Progress</p>
                    <p className="mt-2 text-white">{selectedCase.progress}%</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Waiting status</p>
                    <p className="mt-2 text-white">{getWaitingLabel(selectedCase)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Submitted apps</p>
                    <p className="mt-2 text-white">{selectedCase.submittedSaasAppCount}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Documents</p>
                    <p className="mt-2 text-white">2 planned</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Access</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge status={getStatusTone(selectedCase)}>{getAccessLabel(selectedCase)}</Badge>
                    {selectedCase.oidcClientSecretConfigured ? (
                      <span className="text-sm text-slate-300">Secret: ********</span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <Button className="justify-start" onClick={() => openEdit(selectedCase)} variant="outline">
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit MSP
                </Button>
                <Button className="justify-start" onClick={() => openOidc(selectedCase)} variant="outline">
                  <KeyRound className="mr-2 h-4 w-4" />
                  Configure OIDC
                </Button>
                <Link href={selectedCase.actionHref}>
                  <Button className="w-full">Open full onboarding plan</Button>
                </Link>
              </div>
            </div>
          ) : null}

          {panelMode === "edit" && selectedCase && editState ? (
            <div className="grid gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-blue-200">Edit MSP</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{selectedCase.mspName}</h3>
              </div>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>MSP name</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) => setEditState((current) => (current ? { ...current, mspName: event.target.value } : current))}
                  value={editState.mspName}
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Primary contact email</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) =>
                    setEditState((current) => (current ? { ...current, primaryContactEmail: event.target.value } : current))
                  }
                  type="email"
                  value={editState.primaryContactEmail}
                />
              </label>
              <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Assigned Sales Engineer</p>
                <p className="mt-2 text-white">{SALES_ENGINEER_NAME}</p>
              </div>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Tenant name</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) =>
                    setEditState((current) => (current ? { ...current, tenantName: event.target.value } : current))
                  }
                  value={editState.tenantName}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Access mode</span>
                  <select
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    onChange={(event) =>
                      setEditState((current) =>
                        current
                          ? { ...current, accessMode: event.target.value as OnboardingCase["accessMode"] }
                          : current
                      )
                    }
                    value={editState.accessMode}
                  >
                    <option value="temporary">temporary</option>
                    <option value="oidc">oidc</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Current stage</span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    onChange={(event) =>
                      setEditState((current) => (current ? { ...current, currentStage: event.target.value } : current))
                    }
                    value={editState.currentStage}
                  />
                </label>
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Progress %</span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    max={100}
                    min={0}
                    onChange={(event) =>
                      setEditState((current) =>
                        current ? { ...current, progress: Number(event.target.value) || 0 } : current
                      )
                    }
                    type="number"
                    value={editState.progress}
                  />
                </label>
              </div>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Submitted apps</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  min={0}
                  onChange={(event) =>
                    setEditState((current) =>
                      current ? { ...current, submittedSaasAppCount: Number(event.target.value) || 0 } : current
                    )
                  }
                  type="number"
                  value={editState.submittedSaasAppCount}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Status</span>
                  <select
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    onChange={(event) =>
                      setEditState((current) =>
                        current ? { ...current, status: event.target.value as OnboardingCase["status"] } : current
                      )
                    }
                    value={editState.status}
                  >
                    <option value="waiting_on_msp">waiting_on_msp</option>
                    <option value="waiting_on_kzero">waiting_on_kzero</option>
                    <option value="in_progress">in_progress</option>
                    <option value="complete">complete</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Last activity</span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    onChange={(event) =>
                      setEditState((current) => (current ? { ...current, lastActivity: event.target.value } : current))
                    }
                    value={editState.lastActivity}
                  />
                </label>
              </div>
              <div className="flex gap-3">
                <Button className="flex-1" onClick={handleSaveEdit}>
                  Save MSP details
                </Button>
                <Button onClick={() => setPanelMode("preview")} variant="outline">
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {panelMode === "oidc" && selectedCase && oidcState ? (
            <div className="grid gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-blue-200">Configure OIDC</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{selectedCase.mspName}</h3>
                <p className="mt-1 text-sm text-slate-300">{getAccessLabel(selectedCase)}</p>
              </div>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Tenant name / realm</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) => setOidcState((current) => (current ? { ...current, tenantName: event.target.value } : current))}
                  value={oidcState.tenantName}
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>OIDC client ID</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) => setOidcState((current) => (current ? { ...current, clientId: event.target.value } : current))}
                  value={oidcState.clientId}
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>OIDC client secret</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) =>
                    setOidcState((current) => (current ? { ...current, clientSecret: event.target.value } : current))
                  }
                  placeholder="Enter secret"
                  type="password"
                  value={oidcState.clientSecret}
                />
              </label>
              <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Issuer preview</p>
                <p className="mt-2 text-sm text-white">{issuerPreview ?? "Enter the tenant name to preview the issuer."}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Discovery preview</p>
                <p className="mt-2 break-all text-sm text-white">
                  {issuerPreview
                    ? `${issuerPreview}/.well-known/openid-configuration`
                    : "Enter the tenant name to preview the discovery endpoint."}
                </p>
              </div>
              {selectedCase.oidcClientSecretConfigured ? (
                <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Stored client secret</p>
                  <p className="mt-2 text-sm text-white">********</p>
                </div>
              ) : null}
              <div className="flex gap-3">
                <Button className="flex-1" onClick={handleSaveOidc}>
                  Save OIDC config
                </Button>
                <Button onClick={() => setPanelMode("preview")} variant="outline">
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {panelMode === "enroll" ? (
            <div className="grid gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-blue-200">Enroll MSP</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">New onboarding case</h3>
                <p className="mt-1 text-sm text-slate-300">Sales Engineer: {SALES_ENGINEER_NAME}</p>
              </div>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>MSP name</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) => setEnrollmentState((current) => ({ ...current, mspName: event.target.value }))}
                  value={enrollmentState.mspName}
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Primary contact email</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) =>
                    setEnrollmentState((current) => ({ ...current, primaryContactEmail: event.target.value }))
                  }
                  type="email"
                  value={enrollmentState.primaryContactEmail}
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Access mode</span>
                <select
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) =>
                    setEnrollmentState((current) => ({
                      ...current,
                      accessMode: event.target.value as OnboardingCase["accessMode"]
                    }))
                  }
                  value={enrollmentState.accessMode}
                >
                  <option value="temporary">temporary</option>
                  <option value="oidc">oidc</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Current stage</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) => setEnrollmentState((current) => ({ ...current, currentStage: event.target.value }))}
                  value={enrollmentState.currentStage}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Progress %</span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    max={100}
                    min={0}
                    onChange={(event) =>
                      setEnrollmentState((current) => ({ ...current, progress: Number(event.target.value) || 0 }))
                    }
                    type="number"
                    value={enrollmentState.progress}
                  />
                </label>
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Submitted apps</span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    min={0}
                    onChange={(event) =>
                      setEnrollmentState((current) => ({
                        ...current,
                        submittedSaasAppCount: Number(event.target.value) || 0
                      }))
                    }
                    type="number"
                    value={enrollmentState.submittedSaasAppCount}
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Status</span>
                  <select
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    onChange={(event) =>
                      setEnrollmentState((current) => ({
                        ...current,
                        status: event.target.value as OnboardingCase["status"]
                      }))
                    }
                    value={enrollmentState.status}
                  >
                    <option value="waiting_on_msp">waiting_on_msp</option>
                    <option value="waiting_on_kzero">waiting_on_kzero</option>
                    <option value="in_progress">in_progress</option>
                    <option value="complete">complete</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Last activity</span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    onChange={(event) =>
                      setEnrollmentState((current) => ({ ...current, lastActivity: event.target.value }))
                    }
                    value={enrollmentState.lastActivity}
                  />
                </label>
              </div>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Starting plan type</span>
                <select
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) =>
                    setEnrollmentState((current) => ({
                      ...current,
                      startingPlanType: event.target.value as TenantType
                    }))
                  }
                  value={enrollmentState.startingPlanType}
                >
                  <option value="nfr">NFR tenant</option>
                  <option value="customer">Customer tenant</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>Tenant name / realm</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) => setEnrollmentState((current) => ({ ...current, tenantName: event.target.value }))}
                  value={enrollmentState.tenantName}
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>OIDC client ID</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) => setEnrollmentState((current) => ({ ...current, clientId: event.target.value }))}
                  value={enrollmentState.clientId}
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>OIDC client secret</span>
                <input
                  className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                  onChange={(event) => setEnrollmentState((current) => ({ ...current, clientSecret: event.target.value }))}
                  placeholder="Enter secret"
                  type="password"
                  value={enrollmentState.clientSecret}
                />
              </label>
              <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Issuer preview</p>
                <p className="mt-2 text-sm text-white">{issuerPreview ?? "Optional until KZero OIDC is configured."}</p>
              </div>
              <div className="flex gap-3">
                <Button className="flex-1" onClick={handleEnroll}>
                  Save MSP case
                </Button>
                <Button onClick={() => setPanelMode(selectedCase ? "preview" : "enroll")} variant="outline">
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </aside>
    </main>
  );
}
