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
  TimerReset,
  X
} from "lucide-react";
import { KzeroLogo } from "@/components/kzero-logo";
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
const PRODUCTION_REDIRECT_URI = "https://onboarding-portal20.vercel.app/api/oidc/callback";
const LOCAL_REDIRECT_URI = "http://localhost:3000/api/oidc/callback";

type PanelMode = "preview" | "edit" | "oidc" | "enroll";
type DashboardCase = OnboardingCase & { mspId?: string };
type AdminApiCase = {
  accessMode: OnboardingCase["accessMode"];
  assignedSalesEngineer: string;
  currentStage: string;
  id: string;
  lastActivity: string;
  mspName: string;
  mspSlug: string;
  oidcClientId?: string;
  oidcConfigured: boolean;
  planId: string;
  primaryContactEmail: string;
  progress: number;
  status: OnboardingCase["status"];
  submittedSaasAppCount: number;
  tenantRealm?: string;
};

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
  return item.accessMode === "temporary" ? "Temporary Access" : "KZero OIDC";
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

  return "In Progress";
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

function adminApiCaseToDashboardCase(item: AdminApiCase): DashboardCase {
  return {
    accessMode: item.accessMode,
    actionHref: `/demo/${item.planId}`,
    assignedSalesEngineer: SALES_ENGINEER_NAME,
    currentStage: item.currentStage,
    lastActivity: item.lastActivity,
    mspId: item.id,
    mspName: item.mspName,
    mspSlug: item.mspSlug,
    oidcClientId: item.oidcClientId,
    oidcClientSecretConfigured: item.oidcConfigured,
    oidcStatus: item.oidcConfigured ? "configured" : "not_configured",
    onboardingPlanId: item.planId,
    primaryContactEmail: item.primaryContactEmail,
    progress: item.progress,
    status: item.status,
    startingPlanType: "nfr",
    submittedSaasAppCount: item.submittedSaasAppCount,
    tenantName: item.tenantRealm
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
  items: DashboardCase[];
  onConfigureOidc: (item: DashboardCase) => void;
  onEdit: (item: DashboardCase) => void;
  onView: (item: DashboardCase) => void;
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
        <div className="overflow-x-auto">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-400">{emptyLabel}</div>
          ) : (
            <table className="min-w-[1080px] w-full table-fixed">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[8%]" />
                <col className="w-[12%]" />
                <col className="w-[168px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  <th className="px-4 py-3 font-medium">MSP</th>
                  <th className="px-4 py-3 font-medium">Access</th>
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Waiting On</th>
                  <th className="px-4 py-3 font-medium">Apps</th>
                  <th className="px-4 py-3 font-medium">Last Activity</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.onboardingPlanId} className="border-b border-white/10 last:border-b-0">
                    <td className="px-4 py-3 align-middle">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{item.mspName}</p>
                        <p className="mt-1 truncate text-xs text-slate-400">{item.primaryContactEmail}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Badge status={getStatusTone(item)}>{getAccessLabel(item)}</Badge>
                    </td>
                    <td className="px-4 py-3 align-middle text-sm text-slate-300">
                      {item.tenantName ? item.tenantName : <span className="text-slate-500">Not configured</span>}
                    </td>
                    <td className="px-4 py-3 align-middle text-sm text-slate-300">{item.currentStage}</td>
                    <td className="px-4 py-3 align-middle">
                      <div className="min-w-[110px]">
                        <p className="text-sm font-medium text-white">{item.progress}%</p>
                        <div className="mt-2 h-1.5 rounded-full bg-white/10">
                          <div
                            className="h-1.5 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Badge status={getStatusTone(item)}>{getWaitingLabel(item)}</Badge>
                    </td>
                    <td className="px-4 py-3 align-middle text-sm text-slate-300">{item.submittedSaasAppCount}</td>
                    <td className="px-4 py-3 align-middle text-sm text-slate-300">{item.lastActivity}</td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        <Button
                          aria-label={`View ${item.mspName}`}
                          className="h-8 px-2.5"
                          onClick={() => onView(item)}
                          title="View case"
                          variant="outline"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          aria-label={`Edit ${item.mspName}`}
                          className="h-8 px-2.5"
                          onClick={() => onEdit(item)}
                          title="Edit MSP"
                          variant="outline"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          aria-label={`Configure OIDC for ${item.mspName}`}
                          className="h-8 px-2.5"
                          onClick={() => onConfigureOidc(item)}
                          title="Configure OIDC"
                          variant="outline"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
  const [apiCases, setApiCases] = useState<DashboardCase[]>([]);
  const [useServerData, setUseServerData] = useState(false);
  const [serverLoadState, setServerLoadState] = useState<"loading" | "server" | "fallback">("loading");
  const [serverErrorMessage, setServerErrorMessage] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("preview");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [enrollmentState, setEnrollmentState] = useState<EnrollmentFormState>(createEnrollmentState);
  const [editState, setEditState] = useState<EditFormState | null>(null);
  const [oidcState, setOidcState] = useState<OidcFormState | null>(null);

  async function loadDashboardCases() {
    try {
      setServerLoadState("loading");
      setServerErrorMessage(null);
      const response = await fetch("/api/admin/msps", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("api_unavailable");
      }

      const payload = (await response.json()) as { msps: AdminApiCase[] };
      setApiCases(payload.msps.map(adminApiCaseToDashboardCase));
      setUseServerData(true);
      setServerLoadState("server");
      return true;
    } catch (error) {
      console.error("Failed to load /api/admin/msps. Falling back to local data.", error);
      setUseServerData(false);
      setServerLoadState("fallback");
      setServerErrorMessage("Showing local fallback data because the server API is unavailable.");
      return false;
    }
  }

  useEffect(() => {
    setDemoEnrollments(readDemoEnrollmentsFromStorage());
    setCaseOverrides(readAdminCaseOverridesFromStorage());
    void loadDashboardCases();
  }, []);

  const fallbackCases = useMemo<DashboardCase[]>(() => {
    const enrolledCases = demoEnrollments.map(enrollmentToCase);
    return [...enrolledCases, ...baseCases].map((item) => ({
      ...item,
      ...caseOverrides[item.onboardingPlanId],
      assignedSalesEngineer: SALES_ENGINEER_NAME
    }));
  }, [baseCases, caseOverrides, demoEnrollments]);

  const isLoading = serverLoadState === "loading";
  const isUsingFallback = serverLoadState === "fallback";
  const onboardingCases: DashboardCase[] = isLoading ? [] : useServerData ? apiCases : fallbackCases;

  const selectedCase = selectedCaseId
    ? onboardingCases.find((item) => item.onboardingPlanId === selectedCaseId) ?? null
    : null;

  const inProgressCases = onboardingCases.filter((item) => item.progress < 100);
  const completedCases = onboardingCases.filter((item) => item.progress >= 100);
  const waitingOnMsp = inProgressCases.filter((item) => item.status === "waiting_on_msp").length;
  const waitingOnKZero = inProgressCases.filter((item) => item.status === "waiting_on_kzero").length;

  const issuerPreview = buildKzeroIssuerForTenant(
    panelMode === "enroll" ? enrollmentState.tenantName : oidcState?.tenantName ?? selectedCase?.tenantName ?? ""
  );
  const authUrlPreview = issuerPreview ? `${issuerPreview}/protocol/openid-connect/auth` : null;
  const tokenUrlPreview = issuerPreview ? `${issuerPreview}/protocol/openid-connect/token` : null;
  const userInfoUrlPreview = issuerPreview ? `${issuerPreview}/protocol/openid-connect/userinfo` : null;
  const logoutUrlPreview = issuerPreview ? `${issuerPreview}/protocol/openid-connect/logout` : null;

  function persistOverrides(nextOverrides: Record<string, AdminCaseOverride>) {
    setCaseOverrides(nextOverrides);
    saveAdminCaseOverridesToStorage(nextOverrides);
  }

  function closePanel() {
    setPanelMode("preview");
    setSelectedCaseId(null);
    setEditState(null);
    setOidcState(null);
  }

  function openPreview(item: DashboardCase) {
    setSelectedCaseId(item.onboardingPlanId);
    setPanelMode("preview");
  }

  function openEdit(item: DashboardCase) {
    setSelectedCaseId(item.onboardingPlanId);
    setEditState(createEditState(item));
    setPanelMode("edit");
  }

  function openOidc(item: DashboardCase) {
    setSelectedCaseId(item.onboardingPlanId);
    setOidcState(createOidcState(item));
    setPanelMode("oidc");
  }

  function openEnroll() {
    setSelectedCaseId(null);
    setEditState(null);
    setOidcState(null);
    setEnrollmentState(createEnrollmentState());
    setPanelMode("enroll");
  }

  async function handleEnroll() {
    const normalizedMspSlug = normalizeTenantName(enrollmentState.mspName);
    const exactTenantName = enrollmentState.tenantName.trim();
    const trimmedMspName = enrollmentState.mspName.trim();
    const trimmedPrimaryContactEmail = enrollmentState.primaryContactEmail.trim();
    const trimmedClientId = enrollmentState.clientId.trim();
    const hasFullOidcConfig = Boolean(exactTenantName && trimmedClientId && enrollmentState.clientSecret.trim());
    const accessMode: OnboardingCase["accessMode"] =
      hasFullOidcConfig || enrollmentState.accessMode === "oidc" ? "oidc" : "temporary";
    const nextOidcStatus: OnboardingCase["oidcStatus"] = hasFullOidcConfig ? "configured" : "not_configured";
    const progress = Math.max(0, Math.min(100, Number(enrollmentState.progress) || 0));

    if (!trimmedMspName || !trimmedPrimaryContactEmail || !normalizedMspSlug) {
      return;
    }

    if (useServerData) {
      try {
        const createResponse = await fetch("/api/admin/msps", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            accessMode,
            assignedSalesEngineer: SALES_ENGINEER_NAME,
            name: trimmedMspName,
            primaryContactEmail: trimmedPrimaryContactEmail,
            slug: normalizedMspSlug
          })
        });

        if (!createResponse.ok) {
          throw new Error("create_failed");
        }

        const createdPayload = (await createResponse.json()) as { msp: AdminApiCase };
        const createdMspId = createdPayload.msp.id;
        const createdPlanId = createdPayload.msp.planId;

        if (createdMspId) {
          const updateResponse = await fetch(`/api/admin/msps/${createdMspId}`, {
            method: "PATCH",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              accessMode,
              assignedSalesEngineer: SALES_ENGINEER_NAME,
              currentStage: enrollmentState.currentStage,
              lastActivity: enrollmentState.lastActivity,
              name: trimmedMspName,
              primaryContactEmail: trimmedPrimaryContactEmail,
              progress,
              slug: normalizedMspSlug,
              status: progress >= 100 ? "complete" : enrollmentState.status,
              submittedSaasAppCount: enrollmentState.submittedSaasAppCount,
              tenantRealm: exactTenantName || undefined
            })
          });

          if (!updateResponse.ok) {
            throw new Error("update_failed");
          }

          if (hasFullOidcConfig) {
            const oidcResponse = await fetch(`/api/admin/msps/${createdMspId}/oidc`, {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                clientId: trimmedClientId,
                clientSecret: enrollmentState.clientSecret,
                redirectUri: PRODUCTION_REDIRECT_URI,
                tenantRealm: exactTenantName
              })
            });

            if (!oidcResponse.ok) {
              throw new Error("oidc_failed");
            }
          }
        }

        await loadDashboardCases();
        setSelectedCaseId(createdPlanId);
        setPanelMode("preview");
        return;
      } catch {
        setUseServerData(false);
      }
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
      tenantName: exactTenantName || undefined
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

  async function handleSaveEdit() {
    if (!selectedCase || !editState) {
      return;
    }

    const nextProgress = Math.max(0, Math.min(100, Number(editState.progress) || 0));
    const exactTenantName = editState.tenantName.trim();
    const hasExistingOidcConfig = Boolean(
      selectedCase.oidcClientId && selectedCase.oidcClientSecretConfigured && (selectedCase.tenantName ?? exactTenantName)
    );
    const nextAccessMode: OnboardingCase["accessMode"] =
      editState.accessMode === "oidc" && hasExistingOidcConfig ? "oidc" : "temporary";
    const nextOidcStatus: OnboardingCase["oidcStatus"] =
      nextAccessMode === "oidc" ? "configured" : "not_configured";
    const waitingStatus: OnboardingCase["status"] = nextProgress >= 100 ? "complete" : editState.status;

    if (useServerData && selectedCase.mspId) {
      try {
        const response = await fetch(`/api/admin/msps/${selectedCase.mspId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            accessMode: nextAccessMode,
            assignedSalesEngineer: SALES_ENGINEER_NAME,
            currentStage: editState.currentStage,
            lastActivity: editState.lastActivity,
            name: editState.mspName,
            primaryContactEmail: editState.primaryContactEmail,
            progress: nextProgress,
            slug: selectedCase.mspSlug,
            status: waitingStatus,
            submittedSaasAppCount: Math.max(0, Number(editState.submittedSaasAppCount) || 0),
            tenantRealm: exactTenantName || undefined
          })
        });

        if (!response.ok) {
          throw new Error("update_failed");
        }

        await loadDashboardCases();
        setPanelMode("preview");
        return;
      } catch {
        setUseServerData(false);
      }
    }

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
        tenantName: exactTenantName || undefined
      }
    };

    persistOverrides(nextOverrides);
    setPanelMode("preview");
  }

  async function handleSaveOidc() {
    if (!selectedCase || !oidcState) {
      return;
    }

    const exactTenantName = oidcState.tenantName.trim();
    const trimmedClientId = oidcState.clientId.trim();
    const hasFullOidcConfig = Boolean(exactTenantName && trimmedClientId && oidcState.clientSecret.trim());
    const accessMode: OnboardingCase["accessMode"] = hasFullOidcConfig ? "oidc" : "temporary";
    const nextOidcStatus: OnboardingCase["oidcStatus"] = hasFullOidcConfig ? "configured" : "not_configured";
    const nextStatus: OnboardingCase["status"] =
      selectedCase.progress >= 100
        ? "complete"
        : hasFullOidcConfig
          ? "waiting_on_kzero"
          : "waiting_on_msp";
    if (useServerData && selectedCase.mspId) {
      try {
        if (!selectedCase.oidcClientSecretConfigured && !oidcState.clientSecret.trim()) {
          return;
        }

        const oidcResponse = await fetch(`/api/admin/msps/${selectedCase.mspId}/oidc`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            clientId: trimmedClientId,
            clientSecret: oidcState.clientSecret,
            redirectUri: PRODUCTION_REDIRECT_URI,
            tenantRealm: exactTenantName
          })
        });

        if (!oidcResponse.ok) {
          throw new Error("oidc_failed");
        }

        const updateResponse = await fetch(`/api/admin/msps/${selectedCase.mspId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            accessMode,
            assignedSalesEngineer: SALES_ENGINEER_NAME,
            currentStage: selectedCase.currentStage,
            lastActivity: formatDateLabel(),
            name: selectedCase.mspName,
            primaryContactEmail: selectedCase.primaryContactEmail,
            progress: selectedCase.progress,
            slug: selectedCase.mspSlug,
            status: nextStatus,
            submittedSaasAppCount: selectedCase.submittedSaasAppCount,
            tenantRealm: exactTenantName || undefined
          })
        });

        if (!updateResponse.ok) {
          throw new Error("update_failed");
        }

        await loadDashboardCases();
        setPanelMode("preview");
        return;
      } catch {
        setUseServerData(false);
      }
    }

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
        tenantName: exactTenantName || undefined
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
        tenantName: exactTenantName || undefined
      };
      saveDemoEnrollmentsToStorage(nextEnrollments);
      setDemoEnrollments(nextEnrollments);
    }

    setPanelMode("preview");
  }

  const isModalOpen =
    panelMode === "enroll" || ((panelMode === "preview" || panelMode === "edit" || panelMode === "oidc") && !!selectedCase);

  return (
    <main className="mx-auto grid w-full max-w-7xl min-w-0 gap-5">
      <section className="min-w-0 grid gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <KzeroLogo className="h-auto w-[220px]" />
            <div>
            <h2 className="text-2xl font-semibold text-white">MSP onboarding reporting</h2>
            <p className="mt-1 text-sm text-slate-300">
              Track live onboarding status, ownership, and OIDC readiness across MSP accounts.
            </p>
            </div>
          </div>
          <Button className="h-10 px-4" onClick={openEnroll}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Enroll MSP
          </Button>
        </div>

        {isLoading ? (
          <Card className="border-white/10 bg-[#101a2d] px-5 py-8">
            <p className="text-base font-medium text-white">Loading MSPs...</p>
            <p className="mt-2 text-sm text-slate-300">Pulling the latest enrolled MSP records from the server.</p>
          </Card>
        ) : (
          <>
            {isUsingFallback && serverErrorMessage ? (
              <Card className="border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
                <p className="text-sm text-amber-100">{serverErrorMessage}</p>
              </Card>
            ) : null}

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
                    <p className="text-sm text-slate-300">In Progress</p>
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

            {onboardingCases.length === 0 ? (
              <Card className="border-white/10 bg-[#101a2d] px-5 py-8">
                <h3 className="text-lg font-semibold text-white">No MSPs enrolled yet.</h3>
                <p className="mt-2 text-sm text-slate-300">
                  Add your first MSP onboarding case to start tracking rollout progress and OIDC readiness.
                </p>
                <div className="mt-4">
                  <Button className="h-10 px-4" onClick={openEnroll}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Enroll MSP
                  </Button>
                </div>
              </Card>
            ) : (
              <>
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
              </>
            )}
          </>
        )}
      </section>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 p-4 md:p-6">
          <Card className="max-h-[calc(100vh-2rem)] w-full max-w-[520px] overflow-y-auto border-white/10 bg-[#101a2d] md:max-h-[calc(100vh-3rem)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-blue-200">
                  {panelMode === "preview"
                    ? "Case preview"
                    : panelMode === "edit"
                      ? "Edit MSP"
                      : panelMode === "oidc"
                        ? "Configure OIDC"
                        : "Enroll MSP"}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {panelMode === "enroll" ? "New onboarding case" : selectedCase?.mspName}
                </h3>
                <p className="mt-1 text-sm text-slate-300">
                  {panelMode === "enroll"
                    ? `Sales Engineer: ${SALES_ENGINEER_NAME}`
                    : panelMode === "preview"
                      ? selectedCase?.primaryContactEmail
                      : panelMode === "edit"
                        ? "Update account details and case status."
                        : getAccessLabel(selectedCase!)}
                </p>
              </div>
              <Button aria-label="Close panel" className="h-9 px-2.5" onClick={closePanel} title="Close" variant="outline">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {panelMode === "preview" && selectedCase ? (
              <div className="grid gap-5">
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
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Access</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge status={getStatusTone(selectedCase)}>{getAccessLabel(selectedCase)}</Badge>
                        {selectedCase.oidcClientSecretConfigured ? (
                          <span className="text-sm text-slate-300">Secret: ********</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Sales Engineer</p>
                      <p className="mt-2 text-white">{SALES_ENGINEER_NAME}</p>
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
                    <span>Last Activity</span>
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
                    Save MSP Details
                  </Button>
                  <Button onClick={closePanel} variant="outline">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {panelMode === "oidc" && selectedCase && oidcState ? (
              <div className="grid gap-4">
                <label className="grid gap-2 text-sm text-slate-300">
                  <span>Tenant name / realm</span>
                  <span className="text-xs text-slate-400">
                    KZero tenant / realm names are case-sensitive. Enter the tenant exactly as it appears in KZero.
                  </span>
                  <input
                    className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3 text-white outline-none"
                    onChange={(event) => setOidcState((current) => (current ? { ...current, tenantName: event.target.value } : current))}
                    value={oidcState.tenantName}
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">App slug</p>
                    <p className="mt-2 text-sm text-white">{selectedCase.mspSlug}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">KZero realm</p>
                    <p className="mt-2 text-sm text-white">
                      {oidcState.tenantName.trim() || "Enter the tenant name exactly as it appears in KZero."}
                    </p>
                  </div>
                </div>
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
                <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Authorization URL preview</p>
                  <p className="mt-2 break-all text-sm text-white">
                    {authUrlPreview ?? "Enter the tenant name to preview the authorization endpoint."}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Token URL preview</p>
                  <p className="mt-2 break-all text-sm text-white">
                    {tokenUrlPreview ?? "Enter the tenant name to preview the token endpoint."}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">UserInfo URL preview</p>
                  <p className="mt-2 break-all text-sm text-white">
                    {userInfoUrlPreview ?? "Enter the tenant name to preview the user info endpoint."}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Logout URL preview</p>
                  <p className="mt-2 break-all text-sm text-white">
                    {logoutUrlPreview ?? "Enter the tenant name to preview the logout endpoint."}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Redirect URI</p>
                    <p className="mt-2 break-all text-sm text-white">{PRODUCTION_REDIRECT_URI}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Local redirect URI</p>
                    <p className="mt-2 break-all text-sm text-white">{LOCAL_REDIRECT_URI}</p>
                  </div>
                </div>
                {selectedCase.oidcClientSecretConfigured ? (
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Stored client secret</p>
                    <p className="mt-2 text-sm text-white">********</p>
                  </div>
                ) : null}
                <div className="flex gap-3">
                  <Button className="flex-1" onClick={handleSaveOidc}>
                    Save OIDC Config
                  </Button>
                  <Button onClick={closePanel} variant="outline">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {panelMode === "enroll" ? (
              <div className="grid gap-4">
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
                    <span>Last Activity</span>
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
                    Save MSP Case
                  </Button>
                  <Button onClick={closePanel} variant="outline">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}
    </main>
  );
}
