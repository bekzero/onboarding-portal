"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpDown,
  Building2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Gauge,
  KeyRound,
  Pencil,
  PlusCircle,
  Search,
  TimerReset,
  Trash2,
  X
} from "lucide-react";
import { KzeroLogo } from "@/components/kzero-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FirstCustomerPilot, OnboardingCase, TenantType, User } from "@/lib/mock-data";
import {
  readAdminCaseOverridesFromStorage,
  saveAdminCaseOverridesToStorage,
  type AdminCaseOverride
} from "@/lib/admin-case-storage";
import {
  buildKzeroIssuerForTenant,
  normalizeTenantName,
} from "@/lib/tenant-routing";

const SALES_ENGINEER_NAME = "Ben Eakin";
const PRODUCTION_REDIRECT_URI = "https://onboarding-portal20.vercel.app/api/oidc/callback";
const LOCAL_REDIRECT_URI = "http://localhost:3000/api/oidc/callback";
const SERVER_API_UNAVAILABLE_MESSAGE = "Server API unavailable. Check database migration and environment variables.";

type PanelMode = "preview" | "edit" | "oidc" | "enroll" | "delete";
type DashboardQuickFilter = "all" | "waiting_on_msp" | "waiting_on_kzero" | "oidc_not_configured" | "completed";
type DashboardSortColumn = "msp" | "access" | "tenant" | "stage" | "progress" | "waiting_on" | "apps" | "last_activity";
type DashboardSortDirection = "asc" | "desc";
type DashboardCase = OnboardingCase & {
  activeTaskOwner?: string;
  activeTaskStatus?: string;
  activeTaskTitle?: string;
  firstCustomerPilot?: FirstCustomerPilot | null;
  mspId?: string;
};
type AdminApiCase = {
  accessMode: OnboardingCase["accessMode"];
  activeTaskOwner?: string;
  activeTaskStatus?: string;
  activeTaskTitle?: string;
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
  firstCustomerPilot?: FirstCustomerPilot | null;
};

type AdminApiResponse = {
  error?: string;
  msps?: AdminApiCase[];
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

function getAccessLabel(item: OnboardingCase) {
  return item.accessMode === "temporary" ? "Temporary Access" : "KZero OIDC";
}

function getWaitingLabel(item: OnboardingCase) {
  if (item.progress >= 100 || item.status === "complete") {
    return "Complete";
  }

  if (item.status === "waiting_on_kzero") {
    return "KZero Action Required";
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

function getActiveTaskOwnerLabel(item: DashboardCase) {
  if (item.status === "waiting_on_kzero") {
    return "KZero Sales Engineer";
  }

  if (item.activeTaskOwner === "kzero_se") {
    return "KZero Sales Engineer";
  }

  if (item.activeTaskOwner === "shared") {
    return "Joint Step";
  }

  if (item.activeTaskOwner === "msp") {
    return "MSP";
  }

  return item.progress >= 100 ? "Complete" : "MSP";
}

function getActiveTaskStatusLabel(item: DashboardCase) {
  if (item.progress >= 100 || item.status === "complete") {
    return "Complete";
  }

  if (item.activeTaskOwner === "kzero_se") {
    return item.activeTaskTitle?.toLowerCase().includes("investigate") || item.activeTaskTitle?.toLowerCase().includes("compatibility")
      ? "KZero Review In Progress"
      : "KZero Action Required";
  }

  if (item.status === "waiting_on_msp") {
    return "Waiting on MSP";
  }

  if (item.status === "waiting_on_kzero") {
    return "KZero Action Required";
  }

  return "In Progress";
}

function getKzeroActionLabel(item: DashboardCase) {
  const title = item.activeTaskTitle?.toLowerCase() ?? "";

  if (title.includes("investigate") || title.includes("compatibility")) {
    return "Complete App Review";
  }

  if (title.includes("upload onboarding plan")) {
    return "Mark Plan Uploaded";
  }

  return "Complete KZero Step";
}

function getOidcStatusLabel(item: DashboardCase) {
  return item.oidcClientSecretConfigured ? "Configured" : "Not Configured";
}

function getMspNeedsToDoLabel(item: DashboardCase) {
  const title = item.activeTaskTitle?.toLowerCase() ?? "";

  if (title.includes("book") || title.includes("meeting")) {
    return "The MSP needs to book the next session with the KZero Sales Engineer.";
  }

  if (title.includes("backup admin")) {
    return "The MSP needs to add backup admins and confirm a break-glass account.";
  }

  if (title.includes("employee") || title.includes("contractor")) {
    return "The MSP needs to add employees and contractors with company email addresses.";
  }

  if (title.includes("vault") || title.includes("browser extension")) {
    return "The MSP needs to share the Vault guide and have users import passwords and install the browser extension.";
  }

  if (title.includes("submit") || title.includes("saas") || title.includes("app")) {
    return "The MSP needs to submit its SaaS applications for compatibility review.";
  }

  if (title.includes("review")) {
    return "The MSP needs to review the onboarding plan and confirm the next rollout session.";
  }

  return "The MSP needs to complete the current onboarding step so KZero can continue.";
}

function getNextStepDescription(item: DashboardCase) {
  const title = item.activeTaskTitle?.toLowerCase() ?? "";

  if (isCompletedCase(item)) {
    return "This onboarding plan is complete. Use the full plan view for any follow-up rollout details.";
  }

  if (item.activeTaskOwner === "kzero_se") {
    if (title.includes("investigate") || title.includes("compatibility")) {
      return "KZero reviews the submitted SaaS applications, confirms compatibility, and prepares the implementation plan.";
    }

    if (title.includes("upload onboarding plan")) {
      return "KZero uploads the onboarding plan so the MSP can review it and schedule the implementation session.";
    }

    return "KZero is responsible for the next step and can advance this onboarding case from the admin dashboard.";
  }

  if (item.status === "waiting_on_kzero") {
    return "KZero is responsible for the next step and can advance this onboarding case from the admin dashboard.";
  }

  if (item.activeTaskOwner === "shared") {
    return "This step needs coordination between the MSP and KZero before the rollout can move forward.";
  }

  return getMspNeedsToDoLabel(item);
}

function getNextActionHeading(item: DashboardCase) {
  if (isCompletedCase(item)) {
    return "Onboarding complete";
  }

  if (item.activeTaskOwner === "kzero_se") {
    return "KZero action required";
  }

  if (item.status === "waiting_on_kzero") {
    return "KZero action required";
  }

  if (item.activeTaskOwner === "shared") {
    return "Joint next step";
  }

  return "Waiting on MSP";
}

function isCompletedCase(item: DashboardCase) {
  return item.progress >= 100 || item.status === "complete";
}

function isWaitingOnMspCase(item: DashboardCase) {
  return !isCompletedCase(item) && item.status === "waiting_on_msp";
}

function isKzeroActionRequiredCase(item: DashboardCase) {
  return !isCompletedCase(item) && (item.status === "waiting_on_kzero" || item.activeTaskOwner === "kzero_se");
}

function isOidcNotConfiguredCase(item: DashboardCase) {
  return !item.oidcClientSecretConfigured;
}

function getCaseLastActivityTimestamp(item: DashboardCase) {
  const timestamp = Date.parse(item.lastActivity);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function matchesQuickFilter(item: DashboardCase, filter: DashboardQuickFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "waiting_on_msp") {
    return isWaitingOnMspCase(item);
  }

  if (filter === "waiting_on_kzero") {
    return isKzeroActionRequiredCase(item);
  }

  if (filter === "oidc_not_configured") {
    return isOidcNotConfiguredCase(item);
  }

  return isCompletedCase(item);
}

function matchesSearchQuery(item: DashboardCase, searchQuery: string) {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableFields = [
    item.mspName,
    item.primaryContactEmail,
    item.tenantName ?? "",
    item.currentStage
  ];

  return searchableFields.some((field) => field.toLowerCase().includes(normalizedQuery));
}

function sortDashboardCases(items: DashboardCase[]) {
  return [...items].sort((left, right) => {
    const leftPriority = isKzeroActionRequiredCase(left) ? 0 : isWaitingOnMspCase(left) ? 1 : 2;
    const rightPriority = isKzeroActionRequiredCase(right) ? 0 : isWaitingOnMspCase(right) ? 1 : 2;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return getCaseLastActivityTimestamp(right) - getCaseLastActivityTimestamp(left);
  });
}

function getDefaultDashboardCaseRank(item: DashboardCase) {
  if (isKzeroActionRequiredCase(item)) {
    return 0;
  }

  if (isWaitingOnMspCase(item)) {
    return 1;
  }

  return 2;
}

function compareDashboardCasesByDefault(left: DashboardCase, right: DashboardCase) {
  const leftPriority = getDefaultDashboardCaseRank(left);
  const rightPriority = getDefaultDashboardCaseRank(right);

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return getCaseLastActivityTimestamp(right) - getCaseLastActivityTimestamp(left);
}

function getSortableValue(item: DashboardCase, column: DashboardSortColumn) {
  if (column === "msp") {
    return item.mspName.toLowerCase();
  }

  if (column === "access") {
    return getAccessLabel(item).toLowerCase();
  }

  if (column === "tenant") {
    return (item.tenantName ?? "").toLowerCase();
  }

  if (column === "stage") {
    return item.currentStage.toLowerCase();
  }

  if (column === "progress") {
    return item.progress;
  }

  if (column === "waiting_on") {
    return getWaitingLabel(item).toLowerCase();
  }

  if (column === "apps") {
    return item.submittedSaasAppCount;
  }

  return getCaseLastActivityTimestamp(item);
}

function sortDashboardCasesByColumn(
  items: DashboardCase[],
  column: DashboardSortColumn | null,
  direction: DashboardSortDirection | null
) {
  const defaultSorted = sortDashboardCases(items);

  if (!column || !direction) {
    return defaultSorted;
  }

  return [...defaultSorted].sort((left, right) => {
    const leftValue = getSortableValue(left, column);
    const rightValue = getSortableValue(right, column);

    let comparison = 0;

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      comparison = leftValue - rightValue;
    } else {
      comparison = String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: "base" });
    }

    if (comparison !== 0) {
      return direction === "asc" ? comparison : -comparison;
    }

    return compareDashboardCasesByDefault(left, right);
  });
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
    actionHref: `/portal/${item.planId}`,
    activeTaskOwner: item.activeTaskOwner,
    activeTaskStatus: item.activeTaskStatus,
    activeTaskTitle: item.activeTaskTitle,
    assignedSalesEngineer: SALES_ENGINEER_NAME,
    firstCustomerPilot: item.firstCustomerPilot ?? null,
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
  onSortChange,
  onView,
  sortColumn,
  sortDirection,
  title
}: {
  emptyLabel: string;
  items: DashboardCase[];
  onSortChange?: (column: DashboardSortColumn) => void;
  onView: (item: DashboardCase) => void;
  sortColumn?: DashboardSortColumn | null;
  sortDirection?: DashboardSortDirection | null;
  title: string;
}) {
  const sortableColumns: Array<{ key: DashboardSortColumn; label: string }> = [
    { key: "msp", label: "MSP" },
    { key: "access", label: "Access" },
    { key: "tenant", label: "Tenant" },
    { key: "stage", label: "Stage" },
    { key: "progress", label: "Progress" },
    { key: "waiting_on", label: "Waiting On" },
    { key: "apps", label: "Apps" },
    { key: "last_activity", label: "Last Activity" }
  ];

  function renderSortHeader(column: DashboardSortColumn, label: string) {
    const isActive = sortColumn === column && !!sortDirection;
    const ariaSort = isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

    return (
      <th aria-sort={ariaSort} className="px-4 py-3 font-medium" key={column}>
        {onSortChange ? (
          <button
            className={`inline-flex items-center gap-1.5 transition ${
              isActive ? "text-white" : "text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => onSortChange(column)}
            type="button"
          >
            <span>{label}</span>
            {isActive ? (
              sortDirection === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          label
        )}
      </th>
    );
  }

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
            <table className="min-w-[960px] w-full table-fixed">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[8%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  {sortableColumns.map((column) => renderSortHeader(column.key, column.label))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.onboardingPlanId} className="border-b border-white/10 last:border-b-0">
                    <td className="px-4 py-3 align-middle">
                      <div className="min-w-0">
                        <button
                          className="truncate text-left text-sm font-medium text-white underline decoration-white/20 underline-offset-4 transition hover:text-blue-200 hover:decoration-blue-200"
                          onClick={() => onView(item)}
                          type="button"
                        >
                          {item.mspName}
                        </button>
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
  const allowLocalFallback = process.env.NODE_ENV !== "production";
  const [caseOverrides, setCaseOverrides] = useState<Record<string, AdminCaseOverride>>({});
  const [apiCases, setApiCases] = useState<DashboardCase[]>([]);
  const [useServerData, setUseServerData] = useState(false);
  const [serverLoadState, setServerLoadState] = useState<"loading" | "server" | "fallback" | "error">("loading");
  const [serverErrorMessage, setServerErrorMessage] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("preview");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [enrollmentState, setEnrollmentState] = useState<EnrollmentFormState>(createEnrollmentState);
  const [editState, setEditState] = useState<EditFormState | null>(null);
  const [oidcState, setOidcState] = useState<OidcFormState | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCompletingKzeroStep, setIsCompletingKzeroStep] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<DashboardQuickFilter>("all");
  const [sortColumn, setSortColumn] = useState<DashboardSortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<DashboardSortDirection | null>(null);

  function getSafeApiErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return undefined;
  }

  function setServerUnavailableState(errorMessage?: string, options?: { preserveServerData?: boolean }) {
    const safeErrorMessage = errorMessage?.trim() || null;

    if (allowLocalFallback && !options?.preserveServerData) {
      setUseServerData(false);
      setApiCases([]);
      setServerLoadState("fallback");
      setServerErrorMessage(
        safeErrorMessage
          ? `Showing local fallback data because the server API is unavailable. ${safeErrorMessage}`
          : "Showing local fallback data because the server API is unavailable."
      );
      return;
    }

    if (!options?.preserveServerData) {
      setUseServerData(false);
      setApiCases([]);
    }

    setServerLoadState("error");
    setServerErrorMessage(safeErrorMessage);
  }

  async function loadDashboardCases() {
    try {
      setServerLoadState("loading");
      setServerErrorMessage(null);
      const response = await fetch("/api/admin/msps", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as AdminApiResponse | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
      }

      setApiCases((payload?.msps ?? []).map(adminApiCaseToDashboardCase));
      setUseServerData(true);
      setServerLoadState("server");
      return true;
    } catch (error) {
      console.error("Failed to load /api/admin/msps.", error);
      setServerUnavailableState(getSafeApiErrorMessage(error));
      return false;
    }
  }

  useEffect(() => {
    setCaseOverrides(readAdminCaseOverridesFromStorage());
    void loadDashboardCases();
  }, []);

  const fallbackCases = useMemo<DashboardCase[]>(() => {
    return baseCases
      .filter((item) => !caseOverrides[item.onboardingPlanId]?.deleted)
      .map((item) => ({
      ...item,
      ...caseOverrides[item.onboardingPlanId],
      actionHref: `/portal/${item.onboardingPlanId}`,
      assignedSalesEngineer: SALES_ENGINEER_NAME
    }));
  }, [baseCases, caseOverrides]);

  const isLoading = serverLoadState === "loading";
  const isUsingFallback = serverLoadState === "fallback";
  const hasServerError = serverLoadState === "error";
  const showBlockingServerError = hasServerError && !useServerData;
  const onboardingCases: DashboardCase[] = isLoading ? [] : isUsingFallback ? fallbackCases : useServerData ? apiCases : [];

  const selectedCase = selectedCaseId
    ? onboardingCases.find((item) => item.onboardingPlanId === selectedCaseId) ?? null
    : null;

  const filteredCases = useMemo(() => {
    return onboardingCases.filter((item) => matchesSearchQuery(item, searchQuery) && matchesQuickFilter(item, quickFilter));
  }, [onboardingCases, quickFilter, searchQuery]);

  const inProgressCases = useMemo(() => {
    return sortDashboardCasesByColumn(filteredCases.filter((item) => !isCompletedCase(item)), sortColumn, sortDirection);
  }, [filteredCases, sortColumn, sortDirection]);

  const completedCases = useMemo(() => {
    return [...filteredCases.filter((item) => isCompletedCase(item))].sort(
      (left, right) => getCaseLastActivityTimestamp(right) - getCaseLastActivityTimestamp(left)
    );
  }, [filteredCases]);

  const waitingOnMsp = inProgressCases.filter((item) => item.status === "waiting_on_msp").length;
  const waitingOnKZero = inProgressCases.filter((item) => item.status === "waiting_on_kzero").length;
  const quickFilters: Array<{ label: string; value: DashboardQuickFilter }> = [
    { label: "All", value: "all" },
    { label: "Waiting on MSP", value: "waiting_on_msp" },
    { label: "KZero Action Required", value: "waiting_on_kzero" },
    { label: "OIDC Not Configured", value: "oidc_not_configured" },
    { label: "Completed", value: "completed" }
  ];

  function handleSortChange(column: DashboardSortColumn) {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
      return;
    }

    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }

    if (sortDirection === "desc") {
      setSortColumn(null);
      setSortDirection(null);
      return;
    }

    setSortDirection("asc");
  }

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

  function openDelete(item: DashboardCase) {
    setSelectedCaseId(item.onboardingPlanId);
    setPanelMode("delete");
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
        setServerUnavailableState("Could not save the new MSP to the server.", {
          preserveServerData: useServerData
        });
        return;
      }
    }

    const nextPlanId = `${normalizedMspSlug}-nfr`;

    const nextStatus: OnboardingCase["status"] = progress >= 100 ? "complete" : enrollmentState.status;

    persistOverrides({
      ...caseOverrides,
      [nextPlanId]: {
        accessMode,
        currentStage: enrollmentState.currentStage,
        lastActivity: enrollmentState.lastActivity,
        mspName: trimmedMspName,
        oidcClientId: trimmedClientId || undefined,
        oidcClientSecretConfigured: Boolean(enrollmentState.clientSecret.trim()),
        oidcStatus: nextOidcStatus,
        primaryContactEmail: trimmedPrimaryContactEmail,
        progress,
        status: nextStatus,
        submittedSaasAppCount: enrollmentState.submittedSaasAppCount,
        tenantName: exactTenantName || undefined
      }
    });

    setSelectedCaseId(nextPlanId);
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
        setServerUnavailableState("Could not save MSP changes to the server.", {
          preserveServerData: useServerData
        });
        return;
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
    const nextStatus: OnboardingCase["status"] = selectedCase.status;
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
        setServerUnavailableState("Could not save OIDC configuration to the server.", {
          preserveServerData: useServerData
        });
        return;
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

    setPanelMode("preview");
  }

  async function handleDeleteMsp() {
    if (!selectedCase) {
      return;
    }

    setIsDeleting(true);

    try {
      if (useServerData && selectedCase.mspId) {
        const response = await fetch(`/api/admin/msps/${selectedCase.mspId}`, {
          method: "DELETE"
        });

        if (!response.ok) {
          throw new Error("delete_failed");
        }

        await loadDashboardCases();
        closePanel();
        return;
      }

      if (!allowLocalFallback) {
        setServerUnavailableState("Could not delete the MSP because the server API is unavailable.");
        return;
      }

      setUseServerData(false);
      setServerLoadState("fallback");
      setServerErrorMessage("Showing local fallback data because the server API is unavailable.");

      const nextOverrides = {
        ...caseOverrides,
        [selectedCase.onboardingPlanId]: {
          ...caseOverrides[selectedCase.onboardingPlanId],
          deleted: true
        }
      };

      persistOverrides(nextOverrides);
      closePanel();
    } catch {
      if (!allowLocalFallback || useServerData) {
        setServerUnavailableState("Could not delete the MSP from the server.", {
          preserveServerData: useServerData
        });
        return;
      }

      setUseServerData(false);
      setServerLoadState("fallback");
      setServerErrorMessage("Showing local fallback data because the server API is unavailable.");

      const nextOverrides = {
        ...caseOverrides,
        [selectedCase.onboardingPlanId]: {
          ...caseOverrides[selectedCase.onboardingPlanId],
          deleted: true
        }
      };

      persistOverrides(nextOverrides);
      closePanel();
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleCompleteKzeroStep() {
    if (!selectedCase?.mspId) {
      return;
    }

    setIsCompletingKzeroStep(true);

    try {
      const response = await fetch(`/api/admin/msps/${selectedCase.mspId}/complete-kzero-step`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error("complete_kzero_failed");
      }

      await loadDashboardCases();
      setPanelMode("preview");
    } finally {
      setIsCompletingKzeroStep(false);
    }
  }

  const isModalOpen =
    panelMode === "enroll" || ((panelMode === "preview" || panelMode === "edit" || panelMode === "oidc" || panelMode === "delete") && !!selectedCase);

  return (
    <main className="mx-auto grid w-full max-w-7xl min-w-0 gap-5">
      <section className="min-w-0 grid gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">MSP Onboarding Reporting</h2>
            <p className="mt-1 text-sm text-slate-300">
              Track live onboarding status, ownership, and OIDC readiness across MSP accounts.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/">
              <Button className="h-10 px-4" variant="outline">
                Back to Main Page
              </Button>
            </Link>
            <Button className="h-10 px-4" onClick={openEnroll}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Enroll MSP
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Card className="border-white/10 bg-[#101a2d] px-5 py-8">
            <p className="text-base font-medium text-white">Loading MSPs...</p>
            <p className="mt-2 text-sm text-slate-300">Pulling the latest enrolled MSP records from the server.</p>
          </Card>
        ) : (
          <>
            {showBlockingServerError ? (
              <Card className="border-red-400/20 bg-red-400/[0.06] px-5 py-6">
                <p className="text-base font-medium text-white">{SERVER_API_UNAVAILABLE_MESSAGE}</p>
                {serverErrorMessage ? (
                  <p className="mt-2 text-sm text-red-100/90">Error: {serverErrorMessage}</p>
                ) : null}
              </Card>
            ) : null}

            {isUsingFallback && serverErrorMessage ? (
              <Card className="border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
                <p className="text-sm text-amber-100">{serverErrorMessage}</p>
              </Card>
            ) : null}

            {hasServerError && useServerData ? (
              <Card className="border-red-400/20 bg-red-400/[0.06] px-4 py-3">
                <p className="text-sm text-red-100">{SERVER_API_UNAVAILABLE_MESSAGE}</p>
                {serverErrorMessage ? (
                  <p className="mt-1 text-xs text-red-100/80">Error: {serverErrorMessage}</p>
                ) : null}
              </Card>
            ) : null}

            {!showBlockingServerError ? (
              <>
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
                <Card className="border-white/10 bg-[#101a2d]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="w-full max-w-xl">
                      <label className="block text-xs uppercase tracking-[0.22em] text-slate-400" htmlFor="msp-search">
                        Search MSPs
                      </label>
                      <div className="relative mt-2">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                          className="h-11 w-full rounded-2xl border border-white/10 bg-[#0a1424] pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400/60"
                          id="msp-search"
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Search MSP name, email, tenant, or stage"
                          type="search"
                          value={searchQuery}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {quickFilters.map((filterOption) => (
                        <Button
                          className="h-10"
                          key={filterOption.value}
                          onClick={() => setQuickFilter(filterOption.value)}
                          variant={quickFilter === filterOption.value ? "default" : "outline"}
                        >
                          {filterOption.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </Card>

                <DashboardTable
                  emptyLabel={
                    searchQuery || quickFilter !== "all"
                      ? "No in-progress MSPs match the current search and filters."
                      : "No in-progress MSPs right now."
                  }
                  items={inProgressCases}
                  onSortChange={handleSortChange}
                  onView={openPreview}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  title="In Progress MSPs"
                />

                <DashboardTable
                  emptyLabel={
                    searchQuery || quickFilter !== "all"
                      ? "No completed MSPs match the current search and filters."
                      : "No completed MSPs yet."
                  }
                  items={completedCases}
                  onView={openPreview}
                  title="Completed MSPs"
                />
              </>
                )}
              </>
            ) : null}
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
                      : panelMode === "delete"
                        ? "Delete MSP"
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
                      : panelMode === "delete"
                        ? "This action permanently removes the MSP and related onboarding records."
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
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">MSP account</p>
                        <p className="mt-2 text-lg font-semibold text-white">{selectedCase.mspName}</p>
                        <p className="mt-1 text-sm text-slate-300">{selectedCase.primaryContactEmail}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge status={getStatusTone(selectedCase)}>{getWaitingLabel(selectedCase)}</Badge>
                        <Badge status={selectedCase.oidcClientSecretConfigured ? "complete" : "waiting_on_msp"}>
                          OIDC {getOidcStatusLabel(selectedCase)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Current stage</p>
                    <p className="mt-2 text-white">{selectedCase.currentStage}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Next action</p>
                    <p className="mt-2 text-lg font-semibold text-white">{getNextActionHeading(selectedCase)}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{getNextStepDescription(selectedCase)}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Who owns the next action</p>
                        <p className="mt-1 text-sm text-slate-200">{getActiveTaskOwnerLabel(selectedCase)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">What happens next</p>
                        <p className="mt-1 text-sm text-slate-200">
                          {selectedCase.activeTaskOwner === "msp" || selectedCase.status === "waiting_on_msp"
                            ? "Admin is waiting on the MSP to respond."
                            : "This case can move forward once the current step is completed."}
                        </p>
                      </div>
                    </div>
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
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">OIDC status</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge status={selectedCase.oidcClientSecretConfigured ? "complete" : "waiting_on_msp"}>
                          {getOidcStatusLabel(selectedCase)}
                        </Badge>
                        <span className="text-sm text-slate-300">{getAccessLabel(selectedCase)}</span>
                        {selectedCase.oidcClientSecretConfigured ? (
                          <span className="text-sm text-slate-300">Secret: ********</span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-slate-400">
                        {selectedCase.tenantName ? `Tenant: ${selectedCase.tenantName}` : "Tenant realm has not been configured yet."}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Sales Engineer</p>
                      <p className="mt-2 text-white">{SALES_ENGINEER_NAME}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Current active task</p>
                    <p className="mt-2 text-white">{selectedCase.activeTaskTitle ?? "No active task"}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Owner</p>
                        <p className="mt-1 text-sm text-slate-200">{getActiveTaskOwnerLabel(selectedCase)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Status</p>
                        <p className="mt-1 text-sm text-slate-200">{getActiveTaskStatusLabel(selectedCase)}</p>
                      </div>
                    </div>
                    {selectedCase.activeTaskOwner === "msp" || selectedCase.status === "waiting_on_msp" ? (
                      <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.08] px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-cyan-100">Waiting on MSP</p>
                        <p className="mt-2 text-sm leading-6 text-cyan-50">{getMspNeedsToDoLabel(selectedCase)}</p>
                      </div>
                    ) : null}
                  </div>
                  {selectedCase.firstCustomerPilot ? (
                    <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">First Customer Pilot</p>
                      <p className="mt-2 text-white">{selectedCase.firstCustomerPilot.customerAlias}</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Target timing</p>
                          <p className="mt-1 text-sm text-slate-200">{selectedCase.firstCustomerPilot.targetRolloutTiming}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Estimated users</p>
                          <p className="mt-1 text-sm text-slate-200">{selectedCase.firstCustomerPilot.estimatedUserCount ?? "Not provided"}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Customer admin</p>
                          <p className="mt-1 text-sm text-slate-200">
                            {selectedCase.firstCustomerPilot.adminContactName ?? selectedCase.firstCustomerPilot.adminContactEmail ?? "Not provided"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Notes</p>
                          <p className="mt-1 text-sm text-slate-200">{selectedCase.firstCustomerPilot.notes ?? "No notes yet"}</p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-3">
                  {selectedCase.activeTaskOwner === "kzero_se" || selectedCase.status === "waiting_on_kzero" ? (
                    <Button className="justify-start" onClick={handleCompleteKzeroStep}>
                      <Clock3 className="mr-2 h-4 w-4" />
                      {isCompletingKzeroStep ? "Saving..." : getKzeroActionLabel(selectedCase)}
                    </Button>
                  ) : null}
                  <Button className="justify-start" onClick={() => openEdit(selectedCase)} variant="outline">
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit MSP
                  </Button>
                  <Button className="justify-start" onClick={() => openOidc(selectedCase)} variant="outline">
                    <KeyRound className="mr-2 h-4 w-4" />
                    Configure OIDC
                  </Button>
                  <Button className="justify-start" onClick={() => openDelete(selectedCase)} variant="outline">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete MSP
                  </Button>
                  <Link href={selectedCase.actionHref}>
                    <Button className="w-full">Open full onboarding plan</Button>
                  </Link>
                </div>
              </div>
            ) : null}

            {panelMode === "delete" && selectedCase ? (
              <div className="grid gap-4">
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-400/12 text-amber-200">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-white">Delete this MSP?</h4>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        This removes the MSP record, onboarding plan, progress, and OIDC config.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">MSP</p>
                  <p className="mt-2 text-white">{selectedCase.mspName}</p>
                  <p className="mt-1 text-sm text-slate-300">{selectedCase.primaryContactEmail}</p>
                </div>
                <div className="flex gap-3">
                  <Button className="flex-1" disabled={isDeleting} onClick={handleDeleteMsp}>
                    {isDeleting ? "Deleting..." : "Delete MSP"}
                  </Button>
                  <Button disabled={isDeleting} onClick={closePanel} variant="outline">
                    Cancel
                  </Button>
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
