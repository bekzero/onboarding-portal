"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpDown,
  Bell,
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
import { getPlanBundle, phases, type FirstCustomerPilot, type OnboardingCase, type TenantType, type User } from "@/lib/mock-data";
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

type PanelMode = "preview" | "edit" | "oidc" | "enroll" | "delete" | "rollback";
type DashboardQuickFilter = "all" | "waiting_on_msp" | "waiting_on_kzero" | "oidc_not_configured" | "completed";
type DashboardSortColumn = "msp" | "stage" | "progress" | "waiting_on" | "apps" | "last_activity";
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

type AdminNotification = {
  createdAt: string;
  id: string;
  isRead: boolean;
  mspId: string;
  mspName: string;
  planId: string;
  readAt: string | null;
  stage: string;
  taskId: string;
  taskTitle: string;
  type: "task_completed";
};

type AdminNotificationsApiResponse = {
  error?: string;
  notifications?: AdminNotification[];
  unreadCount?: number;
};

type FlowReferenceStage = {
  id: string;
  kzeroActionRequired?: string;
  movesForwardWhenShort: string;
  movesForwardWhen: string;
  ownerLabels: string[];
  ownerSummary: string;
  purpose: string;
  tasks: Array<{
    description?: string;
    title: string;
  }>;
  title: string;
};

type RollbackStageOption = {
  id: string;
  tasks: Array<{
    description: string;
    id: string;
    title: string;
  }>;
  title: string;
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

const ONBOARDING_STAGE_OPTIONS = [
  "Kickoff",
  "Tenant Setup",
  "App Review",
  "SSO Rollout",
  "First Customer Pilot",
  "Repeatable Rollout Ready"
] as const;

const STATUS_OPTIONS: Array<{ label: string; value: OnboardingCase["status"] }> = [
  { label: "Waiting on MSP", value: "waiting_on_msp" },
  { label: "KZero Action Required", value: "waiting_on_kzero" },
  { label: "In Progress", value: "in_progress" },
  { label: "Complete", value: "complete" }
];

const ACCESS_MODE_OPTIONS: Array<{ label: string; value: OnboardingCase["accessMode"] }> = [
  { label: "Temporary Access", value: "temporary" },
  { label: "KZero OIDC", value: "oidc" }
];

const PLAN_TYPE_OPTIONS: Array<{ label: string; value: TenantType }> = [
  { label: "NFR Tenant", value: "nfr" },
  { label: "Customer Tenant", value: "customer" }
];

const REFERENCE_PLAN_ID = "abcmsp-nfr";

function formatDateLabel() {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function formatDateInputValue(value: string) {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return value;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "";
  }

  const date = new Date(parsed);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateDisplayValue(value: string) {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) {
    return value.trim();
  }

  const [, year, month, day] = isoMatch;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${year}-${month}-${day}T00:00:00Z`));
}

function getTodayDateInputValue() {
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getAccessLabel(item: OnboardingCase) {
  return item.accessMode === "temporary" ? "Temporary Access" : "KZero OIDC";
}

function formatNotificationTimestamp(value: string) {
  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(parsed));
}

function getOwnerBadgeTone(ownerLabel: string) {
  if (ownerLabel === "KZero Passwordless") {
    return "waiting_on_kzero" as const;
  }

  if (ownerLabel === "Joint Step") {
    return "in_progress" as const;
  }

  return "waiting_on_msp" as const;
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

function getPreviewTaskStatusLabel(item: DashboardCase) {
  if (item.progress >= 100 || item.status === "complete") {
    return "Complete";
  }

  if (item.activeTaskOwner === "kzero_se" || item.status === "waiting_on_kzero") {
    return "KZero Action Required";
  }

  if (item.activeTaskOwner === "msp" || item.status === "waiting_on_msp") {
    return "Waiting on MSP";
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

function isMeaningfulAdminComment(body: string) {
  const normalizedBody = body.toLowerCase();
  return !normalizedBody.includes("placeholder") &&
    !normalizedBody.includes("kickoff booking link is ready when abcmsp is ready to schedule") &&
    !normalizedBody.includes("demo-generated onboarding case");
}

function createEnrollmentState(): EnrollmentFormState {
  return {
    accessMode: "temporary",
    clientId: "",
    clientSecret: "",
    currentStage: "Kickoff",
    lastActivity: getTodayDateInputValue(),
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
    lastActivity: formatDateInputValue(item.lastActivity),
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
                <col className="w-[31%]" />
                <col className="w-[16%]" />
                <col className="w-[17%]" />
                <col className="w-[16%]" />
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
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isNotificationDrawerOpen, setIsNotificationDrawerOpen] = useState(false);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [notificationErrorMessage, setNotificationErrorMessage] = useState<string | null>(null);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<NotificationPermission>("default");
  const [isFlowReferenceOpen, setIsFlowReferenceOpen] = useState(false);
  const [expandedFlowStageId, setExpandedFlowStageId] = useState<string | null>(null);
  const [enrollmentState, setEnrollmentState] = useState<EnrollmentFormState>(createEnrollmentState);
  const [editState, setEditState] = useState<EditFormState | null>(null);
  const [oidcState, setOidcState] = useState<OidcFormState | null>(null);
  const [rollbackTaskId, setRollbackTaskId] = useState("");
  const [rollbackErrorMessage, setRollbackErrorMessage] = useState<string | null>(null);
  const [isApplyingRollback, setIsApplyingRollback] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCompletingKzeroStep, setIsCompletingKzeroStep] = useState(false);
  const [isCaseActionsMenuOpen, setIsCaseActionsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<DashboardQuickFilter>("all");
  const [sortColumn, setSortColumn] = useState<DashboardSortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<DashboardSortDirection | null>(null);
  const hasInitializedNotificationFeed = useRef(false);
  const announcedNotificationIds = useRef<Set<string>>(new Set());

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

  async function loadNotifications() {
    try {
      setIsLoadingNotifications(true);
      setNotificationErrorMessage(null);
      const response = await fetch("/api/admin/notifications", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as AdminNotificationsApiResponse | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
      }

      setNotifications(payload?.notifications ?? []);
      setUnreadNotificationCount(payload?.unreadCount ?? 0);
    } catch (error) {
      console.error("Failed to load /api/admin/notifications.", error);
      setNotifications([]);
      setUnreadNotificationCount(0);
      setNotificationErrorMessage(getSafeApiErrorMessage(error) ?? "Could not load notifications.");
    } finally {
      setIsLoadingNotifications(false);
    }
  }

  useEffect(() => {
    setCaseOverrides(readAdminCaseOverridesFromStorage());
    void loadDashboardCases();
    void loadNotifications();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    setBrowserNotificationPermission(window.Notification.permission);
  }, []);

  useEffect(() => {
    setIsCaseActionsMenuOpen(false);
  }, [panelMode, selectedCaseId]);

  useEffect(() => {
    if (!isNotificationDrawerOpen) {
      return;
    }

    void loadNotifications();
  }, [isNotificationDrawerOpen]);

  useEffect(() => {
    const unreadNotifications = notifications.filter((notification) => !notification.isRead);

    if (!hasInitializedNotificationFeed.current) {
      unreadNotifications.forEach((notification) => announcedNotificationIds.current.add(notification.id));
      hasInitializedNotificationFeed.current = true;
      return;
    }

    if (typeof window === "undefined" || !("Notification" in window) || browserNotificationPermission !== "granted") {
      return;
    }

    unreadNotifications.forEach((notification) => {
      if (announcedNotificationIds.current.has(notification.id)) {
        return;
      }

      announcedNotificationIds.current.add(notification.id);
      const browserNotification = new window.Notification(`${notification.mspName} completed a step`, {
        body: `${notification.taskTitle} in ${notification.stage}`,
        tag: notification.id
      });

      browserNotification.onclick = () => {
        window.focus();
        openCaseFromNotification(notification);
        browserNotification.close();
      };
    });
  }, [browserNotificationPermission, notifications]);

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
  const selectedCaseBundle = useMemo(
    () => (selectedCase ? getPlanBundle(selectedCase.onboardingPlanId) : null),
    [selectedCase]
  );
  const selectedCaseApps = selectedCaseBundle?.apps ?? [];
  const selectedCaseDocuments = useServerData ? [] : selectedCaseBundle?.attachments ?? [];
  const selectedCaseComments = (selectedCaseBundle?.comments ?? []).filter((comment) => isMeaningfulAdminComment(comment.body));
  const adminPortalOpenHref = selectedCase?.mspId ? `/api/admin/msps/${selectedCase.mspId}/open-portal` : null;
  const canOpenPortalAsAdmin = Boolean(selectedCase?.mspId && useServerData);
  const rollbackStageOptions = useMemo<RollbackStageOption[]>(() => {
    if (!selectedCaseBundle) {
      return [];
    }

    const orderedTasks = selectedCaseBundle.plan.taskIds
      .map((taskId) => selectedCaseBundle.tasks.find((task) => task.id === taskId))
      .filter((task): task is NonNullable<typeof selectedCaseBundle.tasks[number]> => Boolean(task));
    const orderedPhases = [...selectedCaseBundle.phases].sort((left, right) => left.order - right.order);

    return orderedPhases
      .map((phase) => ({
        id: phase.id,
        tasks: orderedTasks
          .filter((task) => task.phaseId === phase.id)
          .map((task) => ({
            description: task.description,
            id: task.id,
            title: task.title
          })),
        title: phase.title
      }))
      .filter((phase) => phase.tasks.length > 0);
  }, [selectedCaseBundle]);
  const currentRollbackTaskId = useMemo(() => {
    if (!selectedCase || !selectedCaseBundle) {
      return "";
    }

    return selectedCaseBundle.tasks.find((task) => task.title === selectedCase.activeTaskTitle)?.id ?? "";
  }, [selectedCase, selectedCaseBundle]);
  const canRollbackCase = Boolean(selectedCase?.mspId && useServerData && rollbackStageOptions.length > 0);
  const referenceBundle = useMemo(() => getPlanBundle(REFERENCE_PLAN_ID), []);
  const flowReferenceStages = useMemo<FlowReferenceStage[]>(() => {
    const tasksByPhase = new Map<string, Array<{ title: string }>>();

    referenceBundle?.tasks.forEach((task) => {
      const currentTasks = tasksByPhase.get(task.phaseId) ?? [];
      currentTasks.push({ title: task.title });
      tasksByPhase.set(task.phaseId, currentTasks);
    });

    return phases.map((phase) => {
      if (phase.id === "phase-kickoff") {
        return {
          id: phase.id,
          movesForwardWhenShort: "Kickoff call is booked and marked complete.",
          movesForwardWhen: "The kickoff call is booked and marked complete.",
          ownerLabels: ["MSP"],
          ownerSummary: "MSP-owned setup",
          purpose: "Start the NFR onboarding engagement and confirm the initial tenant setup.",
          tasks: tasksByPhase.get(phase.id) ?? [],
          title: phase.title
        };
      }

      if (phase.id === "phase-tenant-setup") {
        return {
          id: phase.id,
          movesForwardWhenShort: "Passwords are imported, backup admins are invited, users are added, and guidance is shared.",
          movesForwardWhen: "The onboarding owner has imported passwords, backup administrators are invited, users are added, and Vault/browser extension guidance has been shared.",
          ownerLabels: ["MSP"],
          ownerSummary: "MSP-owned setup",
          purpose: "Prepare the MSP owner and team for the NFR rollout.",
          tasks: [
            {
              title: "Import Your Passwords",
              description: "The onboarding owner imports their saved passwords into KZero Passwordless Vault first so they can validate the user experience before guiding the rest of the team."
            },
            {
              title: "Add Backup Administrators",
              description: "Invite backup administrators in the KZero Passwordless Dashboard so the tenant is not dependent on a single admin account."
            },
            {
              title: "Add Employees and Contractors",
              description: "Invite the members of the MSP team who will participate in the NFR rollout using their company email addresses."
            },
            {
              title: "Share Vault and Browser Extension Guidance",
              description: "Share the KZero Passwordless Vault and browser extension guides with the users who were added to the tenant."
            }
          ],
          title: phase.title
        };
      }

      if (phase.id === "phase-app-review") {
        return {
          id: phase.id,
          kzeroActionRequired: "KZero Passwordless reviews app compatibility and prepares rollout guidance.",
          movesForwardWhenShort: "Priority SaaS apps are submitted and KZero Passwordless completes compatibility review.",
          movesForwardWhen: "Priority SaaS applications are submitted and KZero Passwordless completes the compatibility review.",
          ownerLabels: ["MSP", "KZero Passwordless"],
          ownerSummary: "MSP submission plus KZero Passwordless review",
          purpose: "Collect SaaS applications and let KZero Passwordless review SSO readiness.",
          tasks: tasksByPhase.get(phase.id) ?? [],
          title: phase.title
        };
      }

      if (phase.id === "phase-sso-rollout") {
        return {
          id: phase.id,
          kzeroActionRequired: "KZero Passwordless uploads the onboarding plan and supports implementation.",
          movesForwardWhenShort: "The onboarding plan is reviewed and the SSO implementation session is completed.",
          movesForwardWhen: "The onboarding plan is reviewed and the first SSO implementation session is completed.",
          ownerLabels: ["KZero Passwordless", "Joint Step"],
          ownerSummary: "KZero Passwordless guidance plus joint implementation",
          purpose: "Review the onboarding plan and complete the first SSO implementation wave.",
          tasks: tasksByPhase.get(phase.id) ?? [],
          title: phase.title
        };
      }

      return {
        id: phase.id,
        kzeroActionRequired: "KZero Passwordless reviews the pilot approach before the rollout session.",
        movesForwardWhenShort: "The first customer pilot is selected, reviewed, scheduled, and completed.",
        movesForwardWhen: "The first customer pilot is selected, reviewed, scheduled, and completed.",
        ownerLabels: ["MSP", "KZero Passwordless", "Joint Step"],
        ownerSummary: "MSP preparation, KZero Passwordless review, and joint rollout",
        purpose: "Apply the validated onboarding process to the first customer tenant.",
        tasks: tasksByPhase.get(phase.id) ?? [],
        title: phase.title
      };
    });
  }, [referenceBundle]);

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
    setRollbackTaskId("");
    setRollbackErrorMessage(null);
  }

  function openPreview(item: DashboardCase) {
    setSelectedCaseId(item.onboardingPlanId);
    setPanelMode("preview");
  }

  async function markNotificationRead(notificationId: string) {
    try {
      const response = await fetch(`/api/admin/notifications/${notificationId}`, {
        method: "PATCH"
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; notification?: AdminNotification } | null;

      if (!response.ok || !payload?.notification) {
        throw new Error(payload?.error ?? "Could not mark the notification as read.");
      }

      let decrementedUnread = false;
      setNotifications((current) =>
        current.map((notification) => {
          if (notification.id !== notificationId) {
            return notification;
          }

          if (!notification.isRead) {
            decrementedUnread = true;
          }

          return payload.notification!;
        })
      );
      if (decrementedUnread) {
        setUnreadNotificationCount((current) => Math.max(0, current - 1));
      }
    } catch (error) {
      setNotificationErrorMessage(getSafeApiErrorMessage(error) ?? "Could not mark the notification as read.");
    }
  }

  async function markAllNotificationsRead() {
    try {
      const response = await fetch("/api/admin/notifications/mark-all-read", {
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not mark notifications as read.");
      }

      setNotifications((current) =>
        current.map((notification) => ({
          ...notification,
          isRead: true,
          readAt: notification.readAt ?? new Date().toISOString()
        }))
      );
      setUnreadNotificationCount(0);
    } catch (error) {
      setNotificationErrorMessage(getSafeApiErrorMessage(error) ?? "Could not mark notifications as read.");
    }
  }

  async function enableBrowserNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationErrorMessage("Browser notifications are not supported in this browser.");
      return;
    }

    const permission = await window.Notification.requestPermission();
    setBrowserNotificationPermission(permission);
  }

  function openFlowReference() {
    setIsFlowReferenceOpen(true);
    setExpandedFlowStageId(null);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const section = document.getElementById("onboarding-flow-reference");
        section?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    });
  }

  function toggleFlowStageDetails(stageId: string) {
    setExpandedFlowStageId((current) => (current === stageId ? null : stageId));
  }

  function toggleFlowReferenceVisibility() {
    setIsFlowReferenceOpen((current) => !current);
    setExpandedFlowStageId(null);
  }

  function openCaseFromNotification(notification: AdminNotification) {
    setSelectedCaseId(notification.planId);
    setPanelMode("preview");
    setIsNotificationDrawerOpen(false);
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

  function openRollback(item: DashboardCase) {
    setSelectedCaseId(item.onboardingPlanId);
    setRollbackTaskId(getPlanBundle(item.onboardingPlanId)?.tasks.find((task) => task.title === item.activeTaskTitle)?.id ?? "");
    setRollbackErrorMessage(null);
    setPanelMode("rollback");
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
    const nextLastActivity = formatDateDisplayValue(enrollmentState.lastActivity) || formatDateLabel();

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
              lastActivity: nextLastActivity,
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

    const nextPlanId = `${normalizedMspSlug}-${enrollmentState.startingPlanType}`;

    const nextStatus: OnboardingCase["status"] = progress >= 100 ? "complete" : enrollmentState.status;

    persistOverrides({
      ...caseOverrides,
      [nextPlanId]: {
        accessMode,
        currentStage: enrollmentState.currentStage,
        lastActivity: nextLastActivity,
        mspName: trimmedMspName,
        oidcClientId: trimmedClientId || undefined,
        oidcClientSecretConfigured: Boolean(enrollmentState.clientSecret.trim()),
        oidcStatus: nextOidcStatus,
        primaryContactEmail: trimmedPrimaryContactEmail,
        progress,
        startingPlanType: enrollmentState.startingPlanType,
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
    const nextLastActivity = formatDateDisplayValue(editState.lastActivity) || selectedCase.lastActivity;
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
            lastActivity: nextLastActivity,
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
        lastActivity: nextLastActivity,
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

  async function handleApplyRollback() {
    if (!selectedCase?.mspId || !rollbackTaskId) {
      setRollbackErrorMessage("Select a step to reopen before applying rollback.");
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "This will reopen the selected step, lock later steps, and recalculate the onboarding case status."
      );

      if (!confirmed) {
        return;
      }
    }

    setIsApplyingRollback(true);
    setRollbackErrorMessage(null);

    try {
      const response = await fetch(`/api/admin/msps/${selectedCase.mspId}/rollback`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          taskId: rollbackTaskId
        })
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not reopen the selected onboarding step.");
      }

      await loadDashboardCases();
      setPanelMode("preview");
      setRollbackTaskId("");
    } catch (error) {
      setRollbackErrorMessage(getSafeApiErrorMessage(error) ?? "Could not reopen the selected onboarding step.");
    } finally {
      setIsApplyingRollback(false);
    }
  }

  const isModalOpen =
    panelMode === "enroll" || ((panelMode === "preview" || panelMode === "edit" || panelMode === "oidc" || panelMode === "delete" || panelMode === "rollback") && !!selectedCase);

  return (
    <main className="mx-auto grid w-full max-w-7xl min-w-0 gap-5">
      <section className="min-w-0 grid gap-4">
        <Card className="border-white/10 bg-[#101a2d] px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-center">
              <KzeroLogo
                className="w-fit shrink-0"
                imageClassName="h-auto w-[190px] md:w-[200px]"
                surface="dark"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white">Sales Engineer Dashboard</h2>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300">
                    Admin
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-300">
                  Manage MSP onboarding, OIDC readiness, and rollout progress.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button className="relative h-10 px-4" onClick={() => setIsNotificationDrawerOpen(true)} variant="outline">
                <Bell className="mr-2 h-4 w-4" />
                Notifications
                {unreadNotificationCount > 0 ? (
                  <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-blue-400 px-1.5 py-0.5 text-[11px] font-semibold text-slate-950">
                    {unreadNotificationCount}
                  </span>
                ) : null}
              </Button>
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
        </Card>

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
                  <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end xl:gap-6">
                    <div className="min-w-0 xl:max-w-xl">
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
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                        {quickFilters.map((filterOption) => (
                          <Button
                            className="h-10 whitespace-nowrap px-3 sm:px-4"
                            key={filterOption.value}
                            onClick={() => setQuickFilter(filterOption.value)}
                            variant={quickFilter === filterOption.value ? "default" : "outline"}
                          >
                            {filterOption.label}
                          </Button>
                        ))}
                      </div>
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

                <Card className="border-white/10 bg-[#101a2d]" id="onboarding-flow-reference">
                  <div className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Onboarding Flow Reference</p>
                      <h3 className="mt-2 text-2xl font-semibold text-white">Onboarding Flow Reference</h3>
                      <p className="mt-1 text-sm text-slate-300">
                        Review the full KZero Passwordless MSP onboarding flow without opening an individual case.
                      </p>
                    </div>
                    <Button onClick={toggleFlowReferenceVisibility} variant="outline">
                      {isFlowReferenceOpen ? "Hide Onboarding Flow" : "View Onboarding Flow"}
                    </Button>
                  </div>

                  {isFlowReferenceOpen ? (
                    <div className="grid gap-4 px-4 py-4 md:px-5 md:py-5">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Stage Count</p>
                          <p className="mt-2 text-2xl font-semibold text-white">5 Stages</p>
                          <p className="mt-1 text-sm text-slate-300">From kickoff through the first customer pilot.</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">MSP-Owned Setup</p>
                          <p className="mt-2 text-2xl font-semibold text-white">Stages 1-2</p>
                          <p className="mt-1 text-sm text-slate-300">The onboarding owner and team complete the initial NFR setup work.</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">KZero Passwordless Review Points</p>
                          <p className="mt-2 text-2xl font-semibold text-white">Stages 3-4</p>
                          <p className="mt-1 text-sm text-slate-300">KZero Passwordless reviews apps, uploads guidance, and supports implementation.</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">First Customer Pilot</p>
                          <p className="mt-2 text-2xl font-semibold text-white">Stage 5</p>
                          <p className="mt-1 text-sm text-slate-300">Apply the validated onboarding process to the first customer rollout.</p>
                        </div>
                      </div>

                      <div className="grid gap-3">
                        {flowReferenceStages.map((stage, index) => (
                          <div key={stage.id} className="rounded-2xl border border-white/10 bg-[#0a1424]">
                            <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
                              <div className="flex min-w-0 items-start gap-4">
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-slate-200">
                                  {index + 1}
                                </span>
                                <div className="min-w-0">
                                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Stage {index + 1}</p>
                                  <h4 className="mt-1 text-xl font-semibold text-white">{stage.title}</h4>
                                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{stage.purpose}</p>
                                </div>
                              </div>

                              <div className="flex flex-col gap-3 lg:min-w-[340px] lg:max-w-[420px] lg:items-end">
                                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                  <span className="rounded-full border border-white/10 bg-[#08111f] px-3 py-1.5 text-xs font-medium text-slate-200">
                                    {stage.tasks.length} {stage.tasks.length === 1 ? "Task" : "Tasks"}
                                  </span>
                                  {stage.ownerLabels.map((ownerLabel) => (
                                    <Badge key={ownerLabel} status={getOwnerBadgeTone(ownerLabel)}>
                                      {ownerLabel}
                                    </Badge>
                                  ))}
                                </div>
                                <p className="text-sm text-slate-300 lg:text-right">{stage.ownerSummary}</p>
                                <div className="lg:self-end">
                                  <Button onClick={() => toggleFlowStageDetails(stage.id)} variant="outline">
                                    {expandedFlowStageId === stage.id ? "Hide Details" : "Show Details"}
                                  </Button>
                                </div>
                              </div>
                            </div>

                            {expandedFlowStageId === stage.id ? (
                              <div className="border-t border-white/10 px-4 py-4">
                                <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Key Tasks</p>
                                    <ol className="mt-3 grid gap-2">
                                      {stage.tasks.map((task, taskIndex) => (
                                        <li key={task.title} className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#08111f] px-3 py-3">
                                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-semibold text-slate-300">
                                            {taskIndex + 1}
                                          </span>
                                          <div className="min-w-0">
                                            <p className="text-sm font-medium text-slate-100">{task.title}</p>
                                            {task.description ? (
                                              <p className="mt-1 text-sm leading-6 text-slate-300">{task.description}</p>
                                            ) : null}
                                          </div>
                                        </li>
                                      ))}
                                    </ol>
                                  </div>

                                  <div className="grid gap-4">
                                    <div className="rounded-xl border border-white/10 bg-[#08111f] px-4 py-4">
                                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Moves Forward When</p>
                                      <p className="mt-2 text-sm leading-6 text-slate-300">{stage.movesForwardWhen}</p>
                                    </div>

                                    {stage.kzeroActionRequired ? (
                                      <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-4">
                                        <p className="text-xs uppercase tracking-[0.18em] text-amber-200">KZero Passwordless Action</p>
                                        <p className="mt-2 text-sm leading-6 text-amber-50/90">{stage.kzeroActionRequired}</p>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </Card>
              </>
                )}
              </>
            ) : null}
          </>
        )}
      </section>

      {isNotificationDrawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/70 p-0 md:p-4">
          <div className="flex h-full w-full max-w-[460px] flex-col border-l border-white/10 bg-[#101a2d] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 md:px-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Notifications</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">Notifications</h3>
                <p className="mt-1 text-sm text-slate-300">MSP activity appears here when onboarding steps are completed.</p>
              </div>
              <Button aria-label="Close notifications" className="h-9 px-2.5" onClick={() => setIsNotificationDrawerOpen(false)} variant="outline">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-5">
              <div>
                <p className="text-sm text-slate-300">
                  {unreadNotificationCount > 0 ? `${unreadNotificationCount} unread` : "All caught up"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {browserNotificationPermission === "granted"
                    ? "Browser alerts enabled"
                    : "Enable browser alerts to see new MSP activity outside the dashboard."}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {browserNotificationPermission !== "granted" ? (
                  <Button onClick={enableBrowserNotifications} variant="outline">
                    Enable Browser Alerts
                  </Button>
                ) : null}
                <Button disabled={unreadNotificationCount === 0} onClick={markAllNotificationsRead} variant="outline">
                  Mark All Read
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5">
              {isLoadingNotifications ? (
                <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-4 py-4 text-sm text-slate-300">
                  Loading notifications...
                </div>
              ) : notificationErrorMessage ? (
                <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-4 text-sm text-red-100">
                  {notificationErrorMessage}
                </div>
              ) : notifications.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#0a1424] px-4 py-5">
                  <p className="text-base font-semibold text-white">No Notifications Yet</p>
                  <p className="mt-2 text-sm text-slate-400">
                    MSP activity will appear here when onboarding steps are completed.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`rounded-2xl border px-4 py-4 ${
                        notification.isRead
                          ? "border-white/10 bg-[#0a1424]"
                          : "border-blue-400/20 bg-blue-400/[0.08]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-white">
                              {notification.mspName} completed: {notification.taskTitle}
                            </p>
                            <Badge status={notification.isRead ? "in_progress" : "waiting_on_kzero"}>
                              {notification.isRead ? "Read" : "Unread"}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm text-slate-300">Completed in {notification.stage}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                            {formatNotificationTimestamp(notification.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <Button className="sm:w-auto" onClick={() => openCaseFromNotification(notification)}>
                          Open Case
                        </Button>
                        <Button
                          className="sm:w-auto"
                          disabled={notification.isRead}
                          onClick={() => markNotificationRead(notification.id)}
                          variant="outline"
                        >
                          Mark Read
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 p-4 md:p-6">
          <Card
            className={`w-full overflow-hidden border-white/10 bg-[#101a2d] ${
              panelMode === "preview"
                ? "max-h-[calc(100vh-2rem)] max-w-[1040px] md:max-h-[calc(100vh-3rem)]"
                : panelMode === "edit" || panelMode === "enroll"
                  ? "max-h-[calc(100vh-2rem)] max-w-[940px] md:max-h-[calc(100vh-3rem)]"
                  : panelMode === "rollback"
                    ? "max-h-[calc(100vh-2rem)] max-w-[920px] md:max-h-[calc(100vh-3rem)]"
                : "max-h-[calc(100vh-2rem)] max-w-[520px] overflow-y-auto md:max-h-[calc(100vh-3rem)]"
            }`}
          >
            <div className={`flex items-start justify-between gap-4 border-b border-white/10 bg-[#101a2d] px-4 py-4 md:px-6 ${(panelMode === "preview" || panelMode === "edit" || panelMode === "enroll" || panelMode === "rollback") ? "sticky top-0 z-20" : "mb-5"}`}>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-blue-200">
                  {panelMode === "preview"
                    ? "Case preview"
                    : panelMode === "edit"
                      ? "Edit MSP"
                      : panelMode === "rollback"
                        ? "Reopen Step"
                      : panelMode === "delete"
                        ? "Delete MSP"
                      : panelMode === "oidc"
                        ? "Configure OIDC"
                        : "Enroll MSP"}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {panelMode === "enroll" ? "Enroll MSP" : selectedCase?.mspName}
                </h3>
                <p className="mt-1 text-sm text-slate-300">
                  {panelMode === "enroll"
                    ? "Create a new MSP onboarding case with access, stage, and reporting details."
                    : panelMode === "preview"
                      ? selectedCase?.primaryContactEmail
                      : panelMode === "rollback"
                        ? "Select the onboarding step to reopen and make current again."
                      : panelMode === "delete"
                        ? "This action permanently removes the MSP and related onboarding records."
                      : panelMode === "edit"
                        ? "Update account details and case status."
                        : getAccessLabel(selectedCase!)}
                </p>
                {panelMode === "preview" && selectedCase ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge status={getStatusTone(selectedCase)}>{getWaitingLabel(selectedCase)}</Badge>
                    <Badge status={selectedCase.oidcClientSecretConfigured ? "complete" : "waiting_on_msp"}>
                      OIDC {getOidcStatusLabel(selectedCase)}
                    </Badge>
                    <Badge status={selectedCase.oidcClientSecretConfigured ? "complete" : "in_progress"}>
                      {getAccessLabel(selectedCase)}
                    </Badge>
                  </div>
                ) : null}
              </div>
              <Button aria-label="Close panel" className="h-9 px-2.5" onClick={closePanel} title="Close" variant="outline">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {panelMode === "preview" && selectedCase ? (
              <>
                <div className="sticky top-[89px] z-10 border-b border-white/10 bg-[#101a2d]/95 px-4 py-4 backdrop-blur md:px-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Case Actions</p>
                      <p className="mt-1 text-sm text-slate-300">
                        {canOpenPortalAsAdmin
                          ? "Advance, update, or open this onboarding case with admin access."
                          : "Advance or update this MSP case from here."}
                      </p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                      {canOpenPortalAsAdmin && adminPortalOpenHref ? (
                        <a className="w-full sm:w-auto" href={adminPortalOpenHref} rel="noreferrer" target="_blank">
                          <Button className="w-full sm:w-auto">Open Onboarding Case</Button>
                        </a>
                      ) : null}
                      {selectedCase.activeTaskOwner === "kzero_se" || selectedCase.status === "waiting_on_kzero" ? (
                        <Button className="w-full sm:w-auto" onClick={handleCompleteKzeroStep} variant="outline">
                          <Clock3 className="mr-2 h-4 w-4" />
                          {isCompletingKzeroStep ? "Saving..." : getKzeroActionLabel(selectedCase)}
                        </Button>
                      ) : null}
                      <div className="relative w-full sm:w-auto">
                        <Button
                          aria-expanded={isCaseActionsMenuOpen}
                          aria-haspopup="menu"
                          className="w-full sm:w-auto"
                          onClick={() => setIsCaseActionsMenuOpen((current) => !current)}
                          variant="outline"
                        >
                          More Actions
                          <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                        {isCaseActionsMenuOpen ? (
                          <div
                            className="mt-2 grid gap-2 rounded-2xl border border-white/10 bg-[#0a1424] p-2 sm:absolute sm:right-0 sm:mt-2 sm:min-w-[220px] sm:shadow-xl"
                            role="menu"
                          >
                            <Button
                              className="justify-start"
                              disabled={!canRollbackCase}
                              onClick={() => {
                                setIsCaseActionsMenuOpen(false);
                                openRollback(selectedCase);
                              }}
                              variant="outline"
                            >
                              <TimerReset className="mr-2 h-4 w-4" />
                              Reopen Step
                            </Button>
                            <Button
                              className="justify-start"
                              onClick={() => {
                                setIsCaseActionsMenuOpen(false);
                                openEdit(selectedCase);
                              }}
                              variant="outline"
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit MSP
                            </Button>
                            <Button
                              className="justify-start"
                              onClick={() => {
                                setIsCaseActionsMenuOpen(false);
                                openOidc(selectedCase);
                              }}
                              variant="outline"
                            >
                              <KeyRound className="mr-2 h-4 w-4" />
                              Configure OIDC
                            </Button>
                            <Button
                              className="justify-start border-red-400/30 text-red-100 hover:bg-red-400/10"
                              onClick={() => {
                                setIsCaseActionsMenuOpen(false);
                                openDelete(selectedCase);
                              }}
                              variant="outline"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete MSP
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {!canOpenPortalAsAdmin ? (
                    <p className="mt-3 text-xs text-slate-400">
                      Open Onboarding Case is available for server-backed MSP records and uses admin-authenticated portal access.
                    </p>
                  ) : null}
                </div>

                <div className="max-h-[calc(100vh-11.5rem)] overflow-y-auto px-4 py-4 md:max-h-[calc(100vh-12.5rem)] md:px-6 md:py-6">
                  <div className="grid gap-6">
                    <div className="grid gap-6 lg:grid-cols-[1.45fr_0.95fr]">
                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Current Stage</p>
                          <p className="mt-2 text-lg font-semibold text-white">{selectedCase.currentStage}</p>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Current Active Task</p>
                            <Badge status={getStatusTone(selectedCase)}>{getPreviewTaskStatusLabel(selectedCase)}</Badge>
                          </div>
                          <p className="mt-3 text-lg font-semibold text-white">{selectedCase.activeTaskTitle ?? "No active task"}</p>
                          <p className="mt-2 text-sm leading-6 text-slate-300">{getNextStepDescription(selectedCase)}</p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Who Owns The Next Action</p>
                            <p className="mt-2 text-base font-semibold text-white">{getActiveTaskOwnerLabel(selectedCase)}</p>
                            <p className="mt-2 text-sm text-slate-300">{getNextActionHeading(selectedCase)}</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">What Happens Next</p>
                            <p className="mt-2 text-sm leading-6 text-slate-300">
                              {selectedCase.activeTaskOwner === "msp" || selectedCase.status === "waiting_on_msp"
                                ? "The plan stays with the MSP until the current onboarding step is completed."
                                : "The case can move forward as soon as the current KZero step is completed."}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                            {selectedCase.activeTaskOwner === "msp" || selectedCase.status === "waiting_on_msp"
                              ? "What The MSP Needs To Do"
                              : "What KZero Needs To Do"}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            {selectedCase.activeTaskOwner === "msp" || selectedCase.status === "waiting_on_msp"
                              ? getMspNeedsToDoLabel(selectedCase)
                              : getNextStepDescription(selectedCase)}
                          </p>
                        </div>

                        {selectedCase.firstCustomerPilot ? (
                          <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">First Customer Pilot</p>
                            <p className="mt-2 text-lg font-semibold text-white">{selectedCase.firstCustomerPilot.customerAlias}</p>
                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Target Timing</p>
                                <p className="mt-1 text-sm text-slate-200">{selectedCase.firstCustomerPilot.targetRolloutTiming}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Estimated Users</p>
                                <p className="mt-1 text-sm text-slate-200">{selectedCase.firstCustomerPilot.estimatedUserCount ?? "Not provided"}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Customer Admin</p>
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

                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Summary</p>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Progress</p>
                              <p className="mt-1 text-lg font-semibold text-white">{selectedCase.progress}%</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Waiting Status</p>
                              <p className="mt-1 text-sm text-slate-200">{getWaitingLabel(selectedCase)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Access Mode</p>
                              <p className="mt-1 text-sm text-slate-200">{getAccessLabel(selectedCase)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">OIDC Status</p>
                              <p className="mt-1 text-sm text-slate-200">{getOidcStatusLabel(selectedCase)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tenant Realm</p>
                              <p className="mt-1 text-sm text-slate-200">{selectedCase.tenantName ?? "Not configured"}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Sales Engineer</p>
                              <p className="mt-1 text-sm text-slate-200">{SALES_ENGINEER_NAME}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last Activity</p>
                              <p className="mt-1 text-sm text-slate-200">{selectedCase.lastActivity}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-white">Submitted Apps</p>
                          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">{selectedCase.submittedSaasAppCount}</span>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {selectedCaseApps.length > 0 ? (
                            selectedCaseApps.slice(0, 4).map((app) => (
                              <div key={app.id} className="rounded-xl border border-white/10 bg-[#08111f] px-3 py-2.5">
                                <p className="text-sm text-white">{app.name}</p>
                                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{app.status.replaceAll("_", " ")}</p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-300">
                              {selectedCase.submittedSaasAppCount > 0
                                ? `${selectedCase.submittedSaasAppCount} apps submitted for review.`
                                : "No SaaS apps submitted yet."}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <p className="text-sm font-semibold text-white">Documents</p>
                        <div className="mt-3 grid gap-2">
                          {selectedCaseDocuments.length > 0 ? (
                            selectedCaseDocuments.map((attachment) => (
                              <div key={attachment.id} className="rounded-xl border border-white/10 bg-[#08111f] px-3 py-2.5">
                                <p className="text-sm text-white">{attachment.name}</p>
                                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{attachment.kind}</p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-300">No documents attached yet.</p>
                          )}
                        </div>
                      </div>

                      {selectedCaseComments.length > 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                          <p className="text-sm font-semibold text-white">Notes / Activity</p>
                          <div className="mt-3 grid gap-2">
                            {selectedCaseComments.slice(0, 3).map((comment) => (
                              <div key={comment.id} className="rounded-xl border border-white/10 bg-[#08111f] px-3 py-2.5">
                                <p className="text-sm font-medium text-white">{comment.author}</p>
                                <p className="mt-1 text-sm leading-6 text-slate-300">{comment.body}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <Link href={selectedCase.actionHref}>
                        <Button className="w-full md:w-auto">Open Full Onboarding Plan</Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </>
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

            {panelMode === "rollback" && selectedCase ? (
              <>
                <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-4 py-4 md:max-h-[calc(100vh-12rem)] md:px-6 md:py-6">
                  <div className="grid gap-5">
                    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] px-5 py-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
                        <div>
                          <p className="text-sm font-semibold text-white">Rollback will reopen the selected step.</p>
                          <p className="mt-2 text-sm leading-6 text-amber-50/90">
                            This will reopen the selected step, lock later steps, and recalculate the onboarding case status.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Select Step To Reopen</p>
                          <h4 className="mt-2 text-lg font-semibold text-white">Choose the exact onboarding step to make current again.</h4>
                        </div>
                        {currentRollbackTaskId ? (
                          <Button className="h-10 px-4" onClick={() => setRollbackTaskId(currentRollbackTaskId)} variant="outline">
                            Use Current Active Step
                          </Button>
                        ) : null}
                      </div>

                      <div className="mt-5 grid gap-4">
                        {rollbackStageOptions.map((stage, stageIndex) => (
                          <div key={stage.id} className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-4">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300">
                                Stage {stageIndex + 1}
                              </span>
                              <h5 className="text-base font-semibold text-white">{stage.title}</h5>
                            </div>
                            <div className="mt-4 grid gap-3">
                              {stage.tasks.map((task) => {
                                const isSelected = rollbackTaskId === task.id;
                                const isCurrentTask = currentRollbackTaskId === task.id;

                                return (
                                  <button
                                    key={task.id}
                                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                                      isSelected
                                        ? "border-blue-400/60 bg-blue-400/10"
                                        : "border-white/10 bg-[#0a1424] hover:border-white/20"
                                    }`}
                                    onClick={() => setRollbackTaskId(task.id)}
                                    type="button"
                                  >
                                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-semibold text-white">{task.title}</p>
                                          {isCurrentTask ? (
                                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300">
                                              Current Active Step
                                            </span>
                                          ) : null}
                                        </div>
                                        <p className="mt-2 text-sm leading-6 text-slate-300">{task.description}</p>
                                      </div>
                                      <span
                                        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                                          isSelected
                                            ? "border-blue-300 bg-blue-300 text-slate-950"
                                            : "border-white/15 text-slate-400"
                                        }`}
                                      >
                                        {isSelected ? "•" : ""}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>

                      {rollbackErrorMessage ? (
                        <div className="mt-4 rounded-2xl border border-red-400/25 bg-red-400/[0.08] px-4 py-3 text-sm text-red-100">
                          {rollbackErrorMessage}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-white/10 bg-[#101a2d] px-4 py-4 md:flex-row md:justify-end md:px-6">
                  <Button
                    className="md:min-w-[180px]"
                    disabled={!rollbackTaskId || isApplyingRollback || !canRollbackCase}
                    onClick={handleApplyRollback}
                  >
                    {isApplyingRollback ? "Applying..." : "Apply Rollback"}
                  </Button>
                  <Button disabled={isApplyingRollback} onClick={() => setPanelMode("preview")} variant="outline">
                    Cancel
                  </Button>
                </div>
              </>
            ) : null}

            {panelMode === "edit" && selectedCase && editState ? (
              <>
                <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-4 py-4 md:max-h-[calc(100vh-12rem)] md:px-6 md:py-6">
                  <div className="grid gap-5">
                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">MSP Account</p>
                        <div className="mt-4 grid gap-4">
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>MSP Name</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) => setEditState((current) => (current ? { ...current, mspName: event.target.value } : current))}
                              value={editState.mspName}
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Primary Contact Email</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEditState((current) => (current ? { ...current, primaryContactEmail: event.target.value } : current))
                              }
                              type="email"
                              value={editState.primaryContactEmail}
                            />
                          </label>
                          <div className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Assigned Sales Engineer</p>
                            <p className="mt-2 text-sm text-white">{SALES_ENGINEER_NAME}</p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Onboarding Status</p>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
                            <span>Current Stage</span>
                            <select
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEditState((current) =>
                                  current ? { ...current, currentStage: event.target.value } : current
                                )
                              }
                              value={editState.currentStage}
                            >
                              {ONBOARDING_STAGE_OPTIONS.map((stage) => (
                                <option key={stage} value={stage}>
                                  {stage}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Status</span>
                            <select
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEditState((current) =>
                                  current ? { ...current, status: event.target.value as OnboardingCase["status"] } : current
                                )
                              }
                              value={editState.status}
                            >
                              {STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Last Activity</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEditState((current) => (current ? { ...current, lastActivity: event.target.value } : current))
                              }
                              type="date"
                              value={editState.lastActivity}
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Progress</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              max={100}
                              min={0}
                              onChange={(event) =>
                                setEditState((current) =>
                                  current ? { ...current, progress: Math.max(0, Math.min(100, Number(event.target.value) || 0)) } : current
                                )
                              }
                              type="number"
                              value={editState.progress}
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Access & Tenant</p>
                        <div className="mt-4 grid gap-4">
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Access Mode</span>
                            <select
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEditState((current) =>
                                  current
                                    ? { ...current, accessMode: event.target.value as OnboardingCase["accessMode"] }
                                    : current
                                )
                              }
                              value={editState.accessMode}
                            >
                              {ACCESS_MODE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Tenant Realm</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEditState((current) => (current ? { ...current, tenantName: event.target.value } : current))
                              }
                              value={editState.tenantName}
                            />
                          </label>
                          <p className="text-xs leading-5 text-slate-400">Use the exact KZero Passwordless tenant realm casing for OIDC.</p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Reporting Details</p>
                        <div className="mt-4 grid gap-4">
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Submitted Apps</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              min={0}
                              onChange={(event) =>
                                setEditState((current) =>
                                  current ? { ...current, submittedSaasAppCount: Math.max(0, Number(event.target.value) || 0) } : current
                                )
                              }
                              type="number"
                              value={editState.submittedSaasAppCount}
                            />
                          </label>
                          <div className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current Waiting Status</p>
                            <p className="mt-2 text-sm text-white">
                              {STATUS_OPTIONS.find((option) => option.value === editState.status)?.label ?? "In Progress"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-white/10 bg-[#101a2d] px-4 py-4 md:flex-row md:justify-end md:px-6">
                  <Button className="md:min-w-[180px]" onClick={handleSaveEdit}>
                    Save MSP Details
                  </Button>
                  <Button onClick={closePanel} variant="outline">
                    Cancel
                  </Button>
                </div>
              </>
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
              <>
                <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-4 py-4 md:max-h-[calc(100vh-12rem)] md:px-6 md:py-6">
                  <div className="grid gap-5">
                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">MSP Account</p>
                        <div className="mt-4 grid gap-4">
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>MSP Name</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) => setEnrollmentState((current) => ({ ...current, mspName: event.target.value }))}
                              value={enrollmentState.mspName}
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Primary Contact Email</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEnrollmentState((current) => ({ ...current, primaryContactEmail: event.target.value }))
                              }
                              type="email"
                              value={enrollmentState.primaryContactEmail}
                            />
                          </label>
                          <div className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Assigned Sales Engineer</p>
                            <p className="mt-2 text-sm text-white">{SALES_ENGINEER_NAME}</p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Access & Tenant</p>
                        <div className="mt-4 grid gap-4">
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Access Mode</span>
                            <select
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEnrollmentState((current) => ({
                                  ...current,
                                  accessMode: event.target.value as OnboardingCase["accessMode"]
                                }))
                              }
                              value={enrollmentState.accessMode}
                            >
                              {ACCESS_MODE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Tenant Name / Realm</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) => setEnrollmentState((current) => ({ ...current, tenantName: event.target.value }))}
                              value={enrollmentState.tenantName}
                            />
                          </label>
                          <p className="text-xs leading-5 text-slate-400">
                            Use the exact KZero Passwordless tenant realm casing for OIDC.
                          </p>
                          <div className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">OIDC Configuration</p>
                            <p className="mt-2 text-sm text-white">
                              {enrollmentState.accessMode === "oidc"
                                ? "Configure the client ID and secret from the Configure OIDC action after enrollment."
                                : "Temporary access is selected by default. You can configure KZero OIDC later."}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Onboarding Status</p>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
                            <span>Current Stage</span>
                            <select
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) => setEnrollmentState((current) => ({ ...current, currentStage: event.target.value }))}
                              value={enrollmentState.currentStage}
                            >
                              {ONBOARDING_STAGE_OPTIONS.map((stage) => (
                                <option key={stage} value={stage}>
                                  {stage}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Status</span>
                            <select
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEnrollmentState((current) => ({
                                  ...current,
                                  status: event.target.value as OnboardingCase["status"]
                                }))
                              }
                              value={enrollmentState.status}
                            >
                              {STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Last Activity</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) => setEnrollmentState((current) => ({ ...current, lastActivity: event.target.value }))}
                              type="date"
                              value={enrollmentState.lastActivity}
                            />
                          </label>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-[#0a1424] px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Reporting Details</p>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
                            <span>Starting Plan Type</span>
                            <select
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              onChange={(event) =>
                                setEnrollmentState((current) => ({
                                  ...current,
                                  startingPlanType: event.target.value as TenantType
                                }))
                              }
                              value={enrollmentState.startingPlanType}
                            >
                              {PLAN_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Progress %</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              max={100}
                              min={0}
                              onChange={(event) =>
                                setEnrollmentState((current) => ({
                                  ...current,
                                  progress: Math.max(0, Math.min(100, Number(event.target.value) || 0))
                                }))
                              }
                              type="number"
                              value={enrollmentState.progress}
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-slate-300">
                            <span>Submitted Apps</span>
                            <input
                              className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                              min={0}
                              onChange={(event) =>
                                setEnrollmentState((current) => ({
                                  ...current,
                                  submittedSaasAppCount: Math.max(0, Number(event.target.value) || 0)
                                }))
                              }
                              type="number"
                              value={enrollmentState.submittedSaasAppCount}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-white/10 bg-[#101a2d] px-4 py-4 md:flex-row md:justify-end md:px-6">
                  <Button className="md:min-w-[180px]" onClick={handleEnroll}>
                    Save MSP Details
                  </Button>
                  <Button onClick={closePanel} variant="outline">
                    Cancel
                  </Button>
                </div>
              </>
            ) : null}
          </Card>
        </div>
      ) : null}
    </main>
  );
}
