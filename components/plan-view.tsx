"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  Clock3,
  ListChecks,
  LockKeyhole,
  Mail
} from "lucide-react";
import { GuidePreviewModal } from "@/components/guide-preview-modal";
import { KzeroLogo } from "@/components/kzero-logo";
import { PortalTourModal, type PortalTourStep } from "@/components/portal-tour-modal";
import { TaskGuideAccess } from "@/components/task-guide-access";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DocumentsReviewCard } from "@/components/documents-review-card";
import { getTaskGuides, type TaskGuide } from "@/lib/guide-previews";
import type { PlanBundle } from "@/lib/mock-data";
import { users } from "@/lib/mock-data";
import { getPhaseTimeEstimate, getTaskTimeEstimate } from "@/lib/onboarding-time-estimates";

const BOOKING_URL =
  "https://outlook.office.com/bookwithme/user/be858ab23c9b4c5f846a37d3d14e064b@klvn0.co/meetingtype/L_3aZP9-PUWjbOtkRaB7bw2?anonymous&ismsaljsauthenabled&ep=mlink";
const TOUR_STORAGE_KEY_PREFIX = "kzero-onboarding-tour-seen:";

const PORTAL_TOUR_STEPS: PortalTourStep[] = [
  {
    title: "Welcome to Your KZero Passwordless Onboarding Workspace",
    body: "This portal guides your team through tenant setup, SaaS app review, SSO rollout, and your first customer pilot."
  },
  {
    title: "Start With Your Status",
    body: "The Status view shows overall progress and whether the next step belongs to your team or KZero Passwordless."
  },
  {
    title: "Complete Work in Tasks",
    body: "The Tasks view is where your team completes onboarding steps. Each phase unlocks as the previous required work is completed."
  },
  {
    title: "Focus on Your Next Action",
    body: "The next action summary shows what to do now and takes you directly to the task where work is completed."
  },
  {
    title: "Use Built-In Guides",
    body: "Some tasks include guide previews from the KZero Passwordless Partner Portal. Open the full guide when you need detailed instructions."
  },
  {
    title: "Submit SaaS Applications",
    body: "Use the Apps view when the plan asks your team to submit SaaS applications for KZero Passwordless review."
  },
  {
    title: "Review Shared Documents",
    body: "Use Documents to review onboarding materials, implementation plans, and rollout files shared during the engagement."
  },
  {
    title: "When KZero Passwordless Is Working",
    body: "Some steps are owned by your KZero Passwordless Sales Engineer. When that happens, no action is needed from your team until the next step is ready."
  },
  {
    title: "You’re Ready to Continue",
    body: "Use Tasks to complete your active work. You can relaunch this tour anytime from the portal header."
  }
];

type GuidePreviewState = {
  guides: TaskGuide[];
  stepName: string;
} | null;

type FirstCustomerPilotFormState = {
  adminContactEmail: string;
  adminContactName: string;
  customerAlias: string;
  estimatedUserCount: string;
  notes: string;
  targetRolloutTiming: string;
};

type AppSubmissionFormState = {
  loginUrl: string;
  name: string;
  notes: string;
  priority: string;
};

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatTaskStatusLabel(status: string) {
  if (status === "waiting_on_msp") {
    return "Action Required";
  }

  if (status === "waiting_on_kzero") {
    return "KZero Passwordless is working on this";
  }

  if (status === "not_started") {
    return "Upcoming";
  }

  return formatLabel(status);
}

function formatCurrentStepStatusLabel(status: string) {
  if (status === "waiting_on_msp") {
    return "Action Required";
  }

  if (status === "waiting_on_kzero") {
    return "KZero Action Required";
  }

  if (status === "not_started") {
    return "Upcoming";
  }

  if (status === "in_progress") {
    return "In Progress";
  }

  if (status === "complete") {
    return "Complete";
  }

  return formatLabel(status);
}

function getPortalTaskStatusLabel(task: PlanBundle["tasks"][number], isLocked: boolean) {
  if (isLocked) {
    return "Locked";
  }

  if (task.owner === "kzero_se" && task.status === "waiting_on_kzero") {
    return task.title.toLowerCase().includes("investigate") || task.title.toLowerCase().includes("compatibility")
      ? "KZero Review In Progress"
      : "KZero Action Required";
  }

  if (task.waitingOn === "kzero" && task.status !== "complete") {
    return "Blocked";
  }

  return formatTaskStatusLabel(task.status);
}

function formatTaskOwnerLabel(owner: string) {
  if (owner === "kzero_se") {
    return "KZero Passwordless Sales Engineer";
  }

  if (owner === "shared") {
    return "Joint step";
  }

  if (owner === "msp") {
    return "You";
  }

  return formatLabel(owner);
}

function formatWaitingLabel(waitingOn: "msp" | "kzero") {
  return waitingOn === "kzero" ? "KZero action in progress" : "Action Required";
}

function getRealDueLabel(dueLabel?: string) {
  if (!dueLabel) {
    return null;
  }

  const hasCalendarDate = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(dueLabel) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(dueLabel) ||
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(dueLabel);

  return hasCalendarDate ? dueLabel : null;
}

function formatTaskOwnerLabelShort(owner: string) {
  if (owner === "kzero_se") {
    return "KZero";
  }

  if (owner === "shared") {
    return "You and KZero";
  }

  return "You";
}

function formatPlanTypeLabel(tenantType: PlanBundle["plan"]["tenantType"]) {
  return tenantType === "nfr" ? "NFR Plan" : "Customer Plan";
}

function taskTone(status: string) {
  if (status === "complete") {
    return "border-success-border/60 bg-success-surface";
  }

  if (status === "waiting_on_kzero" || status === "waiting_on_msp") {
    return "border-warning-border/60 bg-warning-surface";
  }

  if (status === "in_progress") {
    return "border-info-border/60 bg-info-surface";
  }

  return "border-border bg-surface-secondary";
}

function isBookingTask(title: string) {
  const normalizedTitle = title.toLowerCase();
  return normalizedTitle.includes("book") &&
    (normalizedTitle.includes("meeting") || normalizedTitle.includes("call") || normalizedTitle.includes("session"));
}

function isSaasSubmissionTask(title: string) {
  return title.toLowerCase().includes("submit saas apps");
}

function getMeetingButtonLabel(title: string) {
  return title.toLowerCase().includes("implementation") ? "Book Implementation Session" : "Book Meeting";
}

function isMeaningfulComment(body: string) {
  const normalizedBody = body.toLowerCase();
  return !normalizedBody.includes("placeholder") &&
    !normalizedBody.includes("kickoff booking link is ready when abcmsp is ready to schedule") &&
    !normalizedBody.includes("demo-generated onboarding case");
}

function isFirstCustomerPilotTask(title: string) {
  return title.toLowerCase() === "select first customer pilot";
}

function getTaskDisplayTitle(task: Pick<PlanBundle["tasks"][number], "title">) {
  return task.title;
}

function getTaskDisplayDescription(task: Pick<PlanBundle["tasks"][number], "title" | "description">) {
  if (task.title === "Import Your Passwords") {
    return "Import your saved passwords into KZero Passwordless Vault first so you can validate the user experience before guiding the rest of your team.";
  }

  if (task.title === "Add Backup Administrators") {
    return "Open the KZero Passwordless Dashboard, select the correct organization, use Add Admin, send the invite, and confirm backup administrators and break-glass coverage are in place.";
  }

  if (task.title === "Add Employees and Contractors") {
    return "Open the KZero Passwordless Dashboard, select the correct tenant, open Users, choose Add User, send the invite, and confirm the invited users appear in the tenant after activation.";
  }

  if (task.title === "Share Vault and Browser Extension Guidance") {
    return "Share the KZero Passwordless Vault and browser extension guide collections with your team so they can prepare for password import and install the supported browser extension.";
  }

  if (task.title === "Submit SaaS Applications for Review") {
    return "Submit your priority SaaS applications with login URLs and notes where available so KZero Passwordless can begin compatibility review.";
  }

  if (task.title === "Review App Compatibility and Prepare the Onboarding Plan") {
    return "KZero Passwordless is working on this. No action needed from you right now.";
  }

  if (task.title === "Upload the Onboarding Plan") {
    return "KZero Passwordless is working on this. No action needed from you right now. Your team will review the plan as soon as it is available.";
  }

  if (task.title === "KZero Reviews Pilot Plan") {
    return "KZero Passwordless is working on this. No action needed from you right now.";
  }

  if (task.title === "Complete First Customer Rollout") {
    return "Apply the validated KZero Passwordless rollout process to the first customer tenant and confirm the initial rollout is complete.";
  }

  return task.description;
}

function createFirstCustomerPilotFormState(bundle: PlanBundle): FirstCustomerPilotFormState {
  return {
    adminContactEmail: bundle.firstCustomerPilot?.adminContactEmail ?? "",
    adminContactName: bundle.firstCustomerPilot?.adminContactName ?? "",
    customerAlias: bundle.firstCustomerPilot?.customerAlias ?? "",
    estimatedUserCount: bundle.firstCustomerPilot?.estimatedUserCount?.toString() ?? "",
    notes: bundle.firstCustomerPilot?.notes ?? "",
    targetRolloutTiming: bundle.firstCustomerPilot?.targetRolloutTiming ?? ""
  };
}

function createAppSubmissionFormState(): AppSubmissionFormState {
  return {
    loginUrl: "",
    name: "",
    notes: "",
    priority: ""
  };
}

function hasRequiredFirstCustomerPilotDetails(pilot: Pick<FirstCustomerPilotFormState, "customerAlias" | "targetRolloutTiming">) {
  return Boolean(pilot.customerAlias.trim() && pilot.targetRolloutTiming.trim());
}

type PlanTab = "overview" | "tasks" | "apps" | "documents" | "activity";

export function PlanView({
  bundle: initialBundle
}: {
  bundle: PlanBundle;
}) {
  const [activeTab, setActiveTab] = useState<PlanTab>(() =>
    initialBundle.plan.progress >= 100 ? "overview" : "tasks"
  );
  const [bundle, setBundle] = useState<PlanBundle>(initialBundle);
  const [guidePreview, setGuidePreview] = useState<GuidePreviewState>(null);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [submittedApps, setSubmittedApps] = useState<PlanBundle["apps"]>(initialBundle.apps);
  const [appForm, setAppForm] = useState<AppSubmissionFormState>(createAppSubmissionFormState);
  const [appError, setAppError] = useState<string | null>(null);
  const [savingAppSubmission, setSavingAppSubmission] = useState(false);
  const [pilotForm, setPilotForm] = useState<FirstCustomerPilotFormState>(() => createFirstCustomerPilotFormState(initialBundle));
  const [savingPilotDetails, setSavingPilotDetails] = useState(false);
  const [pilotError, setPilotError] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [expandedPhaseIds, setExpandedPhaseIds] = useState<string[]>([]);
  const orderedTasks = bundle.plan.taskIds
    .map((taskId) => bundle.tasks.find((task) => task.id === taskId))
    .filter((task): task is NonNullable<(typeof bundle.tasks)[number]> => Boolean(task));
  const nextTask = bundle.nextTask;
  const isPlanComplete = bundle.plan.progress >= 100 || orderedTasks.every((task) => task.status === "complete");
  const activeTaskIndex = isPlanComplete
    ? -1
    : orderedTasks.findIndex((task) => task.id === nextTask.id);
  const nextTaskIndex = orderedTasks.findIndex((task) => task.id === nextTask.id);
  const followingTask = nextTaskIndex >= 0 ? orderedTasks[nextTaskIndex + 1] ?? null : null;
  const completedTasks = bundle.tasks.filter((task) => task.status === "complete").length;
  const activeTasks = bundle.tasks.filter((task) => ["in_progress", "waiting_on_msp"].includes(task.status)).length;
  const safeNextStepPhase = bundle.phases.find((phase) => phase.id === nextTask.phaseId);
  const phaseTasks = bundle.phases.map((phase) => ({
    phase,
    tasks: bundle.tasks.filter((task) => task.phaseId === phase.id)
  }));
  const kzeroContact = users.find((user) => user.role === "sales_engineer");
  const isKZeroOwnedCurrentTask = !isPlanComplete && nextTask.owner === "kzero_se";
  const isKickoffBookingTask = isBookingTask(nextTask.title);
  const isSubmittingSaasApps = isSaasSubmissionTask(nextTask.title);
  const isSelectingFirstCustomerPilot = isFirstCustomerPilotTask(nextTask.title);
  const hasSavedFirstCustomerPilot =
    Boolean(bundle.firstCustomerPilot?.customerAlias?.trim() && bundle.firstCustomerPilot?.targetRolloutTiming?.trim());
  const hasRequiredPilotFormDetails = hasRequiredFirstCustomerPilotDetails(pilotForm);
  const meaningfulComments = bundle.comments.filter((comment) => isMeaningfulComment(comment.body));
  const nextTaskDescription = getTaskDisplayDescription(nextTask);
  const nextTaskTitle = getTaskDisplayTitle(nextTask);
  const isCustomerPlan = bundle.plan.tenantType === "customer";
  const tenantSetupLabel = isCustomerPlan ? "customer tenant setup" : "NFR tenant setup";
  const portalHeading = isCustomerPlan
    ? bundle.plan.customerName ?? bundle.plan.title
    : bundle.organization.name;
  const portalSubtitle = isCustomerPlan
    ? `Managed by ${bundle.plan.mspName ?? bundle.organization.name} through KZero Passwordless.`
    : "KZero Passwordless NFR onboarding workspace";
  const yourNextAction = isPlanComplete
    ? "Onboarding complete"
    : isKZeroOwnedCurrentTask
      ? "KZero Passwordless is working on this."
      : nextTaskTitle;
  const yourNextActionDetail = isPlanComplete
    ? "Your team has completed the current onboarding plan."
    : isKZeroOwnedCurrentTask
    ? "No action needed from you right now. We'll update this plan when the next step is ready."
    : nextTaskDescription;
  const actionStatusMessage = isPlanComplete
    ? "All onboarding steps in this plan are complete."
    : isKZeroOwnedCurrentTask
      ? "KZero Passwordless is working on this. No action needed from you right now."
        : isSubmittingSaasApps
          ? "Submit your SaaS applications from the Apps section to continue."
        : isKickoffBookingTask
          ? `Book your kickoff meeting to begin ${tenantSetupLabel}.`
          : formatCurrentStepStatusLabel(nextTask.status);
  const whatHappensNext = isPlanComplete
    ? "You can return to this workspace at any time to review completed onboarding milestones."
    : isKZeroOwnedCurrentTask
    ? "We'll update this plan when the next step is ready."
    : followingTask
    ? isKickoffBookingTask
      ? isCustomerPlan
        ? "After kickoff, you'll add backup admins and invite your customer users."
        : "After kickoff, you'll add backup admins and invite your MSP users."
      : `${getTaskDisplayTitle(followingTask)} (${formatTaskOwnerLabelShort(followingTask.owner)})`
    : "This completes the current onboarding milestone.";
  const currentStepLabel = isPlanComplete ? "Completed onboarding plan" : isKickoffBookingTask ? "Book kickoff call" : nextTaskTitle;
  const currentOwnerLabel = isPlanComplete
    ? "Complete"
    : nextTask.owner === "kzero_se"
    ? "KZero Passwordless"
    : nextTask.owner === "shared"
      ? "Your team and KZero Passwordless"
      : "Your team";
  const currentStatusLabel = isPlanComplete
    ? "Complete"
    : isKZeroOwnedCurrentTask
      ? "KZero Action Required"
      : formatCurrentStepStatusLabel(nextTask.status);
  const currentTaskTimeEstimate = isPlanComplete ? null : getTaskTimeEstimate(nextTask.id, "next-action");
  const tabs: { id: PlanTab; label: string }[] = [
    { id: "overview", label: "Status" },
    { id: "tasks", label: "Tasks" },
    { id: "apps", label: "Apps" },
    { id: "documents", label: "Documents" },
    ...(meaningfulComments.length > 0 ? [{ id: "activity" as const, label: "Activity" }] : [])
  ];
  const tourStorageKey = `${TOUR_STORAGE_KEY_PREFIX}${bundle.plan.id}`;

  useEffect(() => {
    setPilotForm(createFirstCustomerPilotFormState(bundle));
  }, [bundle]);

  useEffect(() => {
    setSubmittedApps(bundle.apps);
  }, [bundle.apps]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const hasSeenTour = window.localStorage.getItem(tourStorageKey) === "true";
    if (hasSeenTour) {
      return;
    }

    setTourStepIndex(0);
    setTourOpen(true);
  }, [tourStorageKey]);

  function markTourSeen() {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(tourStorageKey, "true");
  }

  function openTour() {
    setTourStepIndex(0);
    setTourOpen(true);
  }

  function skipTour() {
    markTourSeen();
    setTourOpen(false);
    setTourStepIndex(0);
  }

  function finishTour() {
    markTourSeen();
    setTourOpen(false);
    setTourStepIndex(0);
  }

  function goToNextTourStep() {
    setTourStepIndex((current) => Math.min(current + 1, PORTAL_TOUR_STEPS.length - 1));
  }

  function goToPreviousTourStep() {
    setTourStepIndex((current) => Math.max(current - 1, 0));
  }

  function goToTab(targetTab: PlanTab) {
    setActiveTab(targetTab);
  }

  function goToTabSection(targetTab: PlanTab, elementId: string) {
    setActiveTab(targetTab);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(elementId);
        if (!target) {
          return;
        }

        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });

        if (target instanceof HTMLElement) {
          target.focus({ preventScroll: true });
        }
      });
    });
  }

  function goToCurrentTask() {
    setExpandedPhaseIds((current) =>
      current.includes(nextTask.phaseId) ? current : [...current, nextTask.phaseId]
    );
    goToTabSection("tasks", "current-task-card");
  }

  function togglePhase(phaseId: string) {
    setExpandedPhaseIds((current) =>
      current.includes(phaseId)
        ? current.filter((currentPhaseId) => currentPhaseId !== phaseId)
        : [...current, phaseId]
    );
  }

  function openAppSubmissionForm() {
    goToTabSection("apps", "apps-submission-form");
  }

  async function submitPortalApp() {
    const trimmedName = appForm.name.trim();
    if (!trimmedName) {
      setAppError("App name is required.");
      return;
    }

    setSavingAppSubmission(true);
    setAppError(null);

    try {
      const response = await fetch(`/api/portal/plans/${bundle.plan.id}/apps`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          loginUrl: appForm.loginUrl,
          name: trimmedName,
          notes: appForm.notes,
          priority: appForm.priority
        })
      });

      const payload = (await response.json()) as { bundle?: PlanBundle; error?: string };

      if (!response.ok || !payload.bundle) {
        throw new Error(payload.error ?? "Could not save the SaaS application.");
      }

      setBundle(payload.bundle);
      setAppForm(createAppSubmissionFormState());
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Could not save the SaaS application.");
    } finally {
      setSavingAppSubmission(false);
    }
  }

  async function markTaskComplete(taskId: string) {
    if (taskId === nextTask.id && isSelectingFirstCustomerPilot && !hasSavedFirstCustomerPilot) {
      setPilotError("Save the first customer pilot details before marking this step complete.");
      return;
    }

    setSavingTaskId(taskId);
    setPilotError(null);

    try {
      const response = await fetch(`/api/portal/plans/${bundle.plan.id}/tasks/${taskId}/complete`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error("complete_failed");
      }

      const payload = (await response.json()) as { bundle: PlanBundle };
      if (payload.bundle) {
        setBundle(payload.bundle);
      }
    } finally {
      setSavingTaskId(null);
    }
  }

  async function saveFirstCustomerPilot() {
    setSavingPilotDetails(true);
    setPilotError(null);

    try {
      const response = await fetch(`/api/portal/plans/${bundle.plan.id}/first-customer-pilot`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          adminContactEmail: pilotForm.adminContactEmail,
          adminContactName: pilotForm.adminContactName,
          customerAlias: pilotForm.customerAlias,
          estimatedUserCount: pilotForm.estimatedUserCount ? Number(pilotForm.estimatedUserCount) : undefined,
          notes: pilotForm.notes,
          targetRolloutTiming: pilotForm.targetRolloutTiming
        })
      });

      const payload = (await response.json()) as { bundle?: PlanBundle; error?: string };

      if (!response.ok || !payload.bundle) {
        throw new Error(payload.error ?? "save_failed");
      }

      setBundle(payload.bundle);
    } catch (error) {
      setPilotError(error instanceof Error ? error.message : "Could not save the first customer pilot details.");
    } finally {
      setSavingPilotDetails(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 md:px-6 md:py-5">
      <header className="rounded-3xl border border-border bg-surface/95 p-4 shadow-panel md:px-5 md:py-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] lg:items-center lg:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] xl:gap-10">
          <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6 lg:gap-10">
            <KzeroLogo className="shrink-0" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border bg-hover px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-info">
                  {formatPlanTypeLabel(bundle.plan.tenantType)}
                </span>
              </div>
              <h1 className="mt-2 break-words text-2xl font-semibold leading-tight tracking-tight text-foreground">{portalHeading}</h1>
              <p className="mt-1.5 text-sm leading-5 text-secondary">{portalSubtitle}</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3 lg:items-end">
            <div className="w-full max-w-[320px]">
              <div className="flex items-center justify-between text-xs font-medium text-muted">
                <span>{completedTasks} of {orderedTasks.length} {orderedTasks.length === 1 ? "task" : "tasks"} completed</span>
                <span>{bundle.plan.progress}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-subtle">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${bundle.plan.progress}%` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle className="h-9 w-9" />
              <Button className="h-9 px-4" onClick={openTour} variant="outline">
                Portal Tour
              </Button>
              <Link href="/">
                <Button variant="outline" className="h-9 px-4">
                  Home
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Portal sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            aria-pressed={activeTab === tab.id}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              activeTab === tab.id
                ? "border-primary/40 bg-primary/15 text-foreground"
                : "border-border bg-surface text-secondary hover:border-border-strong hover:text-foreground"
            }`}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="mt-4 grid gap-4">
        <div>
          <section className="grid gap-4">
            <Card className="border-border bg-surface p-5 md:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center lg:gap-8">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-info">
                    <span>{safeNextStepPhase?.title ?? "Kickoff"}</span>
                    <span className="text-muted-subtle">/</span>
                    <span>Your Next Action</span>
                  </div>
                  <h2 className="mt-3 max-w-3xl text-xl font-semibold leading-tight text-foreground md:text-2xl">
                    {currentStepLabel}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">{yourNextActionDetail}</p>
                  <p className="mt-3 text-xs text-muted">
                    <span className="font-medium text-secondary">Owner:</span> {currentOwnerLabel}
                  </p>
                </div>

                <div className="flex flex-col items-start gap-3 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  {currentTaskTimeEstimate ? (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                      <Clock3 className="h-3.5 w-3.5 text-info" aria-hidden="true" />
                      <span>{currentTaskTimeEstimate}</span>
                    </div>
                  ) : null}
                  <Badge status={nextTask.status}>{currentStatusLabel}</Badge>
                  {!isPlanComplete ? (
                    <Button className="h-10 w-full rounded-xl px-4 sm:w-auto lg:w-full" onClick={goToCurrentTask}>
                      Go to Task
                      <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>

            {activeTab === "overview" ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card className="border-border bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-muted">Progress</p>
                      <h3 className="mt-1 text-2xl font-semibold text-foreground">{bundle.plan.progress}% complete</h3>
                    </div>
                    <Badge status={nextTask.status}>{formatTaskStatusLabel(nextTask.status)}</Badge>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-subtle">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                      style={{ width: `${bundle.plan.progress}%` }}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-xl bg-surface-secondary px-3 py-2">
                      <p className="text-muted">Done</p>
                      <p className="mt-1 font-semibold text-foreground">{completedTasks}</p>
                    </div>
                    <div className="rounded-xl bg-surface-secondary px-3 py-2">
                      <p className="text-muted">Current</p>
                      <p className="mt-1 font-semibold text-foreground">{activeTasks}</p>
                    </div>
                    <div className="rounded-xl bg-surface-secondary px-3 py-2">
                      <p className="text-muted">Submitted Apps</p>
                      <p className="mt-1 font-semibold text-foreground">{submittedApps.length}</p>
                    </div>
                  </div>
                </Card>

                <Card className="border-border bg-surface p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-foreground">KZero Passwordless Contact</h3>
                      <p className="mt-1 text-sm text-secondary">Your Sales Engineer for this onboarding plan.</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-[1.2rem] border border-border bg-surface-secondary p-4">
                    <div className="grid gap-4">
                      <div>
                        <p className="font-medium text-foreground">{kzeroContact?.name ?? "Ben Eakin"}</p>
                        <p className="mt-1 text-sm text-secondary">KZero Passwordless Sales Engineer</p>
                        <a className="mt-1 block text-sm text-info hover:text-info" href="mailto:b.eakin@kzero.com">
                          b.eakin@kzero.com
                        </a>
                        <a
                          className="mt-3 inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium text-foreground transition hover:border-border-strong hover:bg-hover"
                          href={BOOKING_URL}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Book Meeting
                        </a>
                      </div>
                      <div className="border-t border-border pt-4">
                        <p className="font-medium text-foreground">KZero Passwordless Support</p>
                        <a className="mt-1 block text-sm text-info hover:text-info" href="mailto:support@kzero.com">
                          support@kzero.com
                        </a>
                      </div>
                      <div className="border-t border-border pt-4">
                        <p className="font-medium text-foreground">KZero Passwordless Sales Team</p>
                        <a className="mt-1 block text-sm text-info hover:text-info" href="mailto:partners@kzero.com">
                          partners@kzero.com
                        </a>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="border-border bg-surface p-4 lg:col-span-2">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">Current Status</h3>
                      <p className="mt-1 text-sm text-secondary">
                        {isKZeroOwnedCurrentTask
                          ? "KZero Passwordless is working on this. No action needed from you right now."
                          : "Use the action button to jump to the place where this step is completed."}
                      </p>
                    </div>
                    {!isPlanComplete ? (
                      <Button className="h-10 rounded-xl px-4" onClick={goToCurrentTask} variant="secondary">
                        Go to Task
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-[1.1rem] border border-border bg-surface-secondary p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">Current Step</p>
                      <p className="mt-2 text-sm leading-6 text-foreground">{yourNextAction}</p>
                    </div>
                    <div className="rounded-[1.1rem] border border-border bg-surface-secondary p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">Status</p>
                      <p className="mt-2 text-sm leading-6 text-secondary">{actionStatusMessage}</p>
                    </div>
                    <div className="rounded-[1.1rem] border border-border bg-surface-secondary p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">What Happens Next</p>
                      <p className="mt-2 text-sm leading-6 text-secondary">{whatHappensNext}</p>
                    </div>
                  </div>

                  {meaningfulComments.length > 0 ? (
                    <div className="mt-4 rounded-[1.1rem] border border-border bg-surface-secondary p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">Latest Updates</p>
                      <div className="mt-3 grid gap-3">
                        {meaningfulComments.slice(0, 2).map((comment) => (
                          <div key={comment.id} className="rounded-[1rem] border border-border bg-input p-3.5 text-sm text-secondary">
                            <p className="font-medium text-foreground">{comment.author}</p>
                            <p className="mt-2 leading-6">{comment.body}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </Card>
              </div>
            ) : null}

            {activeTab === "tasks" ? (
              <Card className="border-border bg-surface p-4 md:p-5">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <ListChecks className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">Phase Checklist</h3>
                    <p className="text-sm text-secondary">
                      Expand an available phase to view its tasks. Each phase unlocks when the previous phase is complete.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3">
                  {phaseTasks.map(({ phase, tasks }, index) => {
                    const phaseTaskIndexes = tasks.map((task) => orderedTasks.findIndex((item) => item.id === task.id));
                    const hasCurrentTask = phaseTaskIndexes.includes(activeTaskIndex);
                    const hasIncompleteTask = tasks.some((task) => task.status !== "complete");
                    const isPhaseLocked = phaseTasks
                      .slice(0, index)
                      .some(({ tasks: previousTasks }) => previousTasks.some((task) => task.status !== "complete"));
                    const isPhaseExpanded = !isPhaseLocked && expandedPhaseIds.includes(phase.id);
                    const phaseStatusLabel = isPhaseLocked
                      ? "Locked"
                      : hasCurrentTask
                        ? "Current"
                        : hasIncompleteTask
                          ? "Upcoming"
                          : "Complete";
                    const phaseTimeEstimate = getPhaseTimeEstimate(phase.id);

                    return (
                      <div key={phase.id} className="overflow-hidden rounded-[1.5rem] border border-border bg-surface">
                        <button
                          aria-controls={`phase-tasks-${phase.id}`}
                          aria-expanded={isPhaseExpanded}
                          className={`flex w-full items-start gap-3 p-4 text-left transition ${
                            isPhaseLocked ? "cursor-not-allowed opacity-65" : "hover:bg-hover"
                          }`}
                          disabled={isPhaseLocked}
                          onClick={() => togglePhase(phase.id)}
                          type="button"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div>
                                <h4 className="text-lg font-semibold text-foreground">{phase.title}</h4>
                                <p className="text-sm text-secondary">{phase.description}</p>
                              </div>
                              <div className="text-left md:text-right">
                                <p className="text-sm text-muted">
                                  {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
                                </p>
                                {phaseTimeEstimate ? (
                                  <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-info md:justify-end">
                                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>{phaseTimeEstimate}</span>
                                  </div>
                                ) : null}
                                <div className="mt-1 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-subtle md:justify-end">
                                  {isPhaseLocked ? <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                                  <span>{phaseStatusLabel}</span>
                                  {!isPhaseLocked ? (
                                    <ChevronDown
                                      aria-hidden="true"
                                      className={`h-4 w-4 transition-transform ${isPhaseExpanded ? "rotate-180" : ""}`}
                                    />
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>

                        {isPhaseExpanded ? (
                          <div className="px-4 pb-4" id={`phase-tasks-${phase.id}`}>
                            <div className="mt-4 border-l border-border pl-4">
                              <div className="grid gap-3">
                                {tasks.map((task) => {
                                  const guides = getTaskGuides(task.title);
                                  const taskIndex = orderedTasks.findIndex((item) => item.id === task.id);
                                  const isCurrentTask = !isPlanComplete && task.id === nextTask.id;
                                  const isCompleted = task.status === "complete";
                                  const isLocked = !isCompleted && !isCurrentTask && taskIndex > activeTaskIndex;
                                  const taskStatusLabel = getPortalTaskStatusLabel(task, isLocked);
                                  const taskToneClass = isLocked ? "border-border bg-surface-secondary/70" : taskTone(task.status);
                                  const taskTimeEstimate = getTaskTimeEstimate(task.id, "task");

                                  return (
                                    <div
                                      id={isCurrentTask ? "current-task-card" : undefined}
                                      tabIndex={isCurrentTask ? -1 : undefined}
                                      key={task.id}
                                      className={`scroll-mt-24 rounded-2xl border p-3.5 transition focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                        isCurrentTask ? "ring-1 ring-primary/40" : ""
                                      } ${taskToneClass}`}
                                    >
                                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.2em] text-muted">
                                            <span>Owner: {formatTaskOwnerLabel(task.owner)}</span>
                                            {getRealDueLabel(task.dueLabel) ? (
                                              <>
                                                <span className="text-muted">/</span>
                                                <span>Due: {getRealDueLabel(task.dueLabel)}</span>
                                              </>
                                            ) : null}
                                            {taskTimeEstimate ? (
                                              <>
                                                <span className="text-muted">/</span>
                                                <span className="flex items-center gap-1.5 normal-case tracking-normal text-secondary">
                                                  <Clock3 className="h-3.5 w-3.5 text-info" aria-hidden="true" />
                                                  {taskTimeEstimate}
                                                </span>
                                              </>
                                            ) : null}
                                          </div>
                                          <div className="mt-2">
                                            <h5 className="text-base font-semibold text-foreground">{getTaskDisplayTitle(task)}</h5>
                                          </div>
                                          <p className="mt-1 text-sm leading-6 text-secondary">
                                            {isLocked ? "Complete the previous step to unlock this task." : getTaskDisplayDescription(task)}
                                          </p>
                                          {isCurrentTask && task.owner === "kzero_se" ? (
                                            <p className="mt-2 text-sm text-warning">No action needed from you right now.</p>
                                          ) : null}
                                        </div>

                                        <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                                          <Badge status={isLocked ? "not_started" : task.waitingOn === "kzero" && task.status !== "complete" ? "waiting_on_kzero" : task.status}>
                                            {taskStatusLabel}
                                          </Badge>
                                          {!isLocked ? (
                                            <TaskGuideAccess
                                              guides={guides}
                                              onOpenGuide={(guide) => setGuidePreview({ guides: [guide], stepName: task.title })}
                                            />
                                          ) : null}
                                          {isCurrentTask && isSaasSubmissionTask(task.title) ? (
                                            <Button className="h-10 px-4" onClick={openAppSubmissionForm}>
                                              Submit SaaS Apps
                                            </Button>
                                          ) : null}
                                          {isCurrentTask && (task.meetingCta || isBookingTask(task.title)) ? (
                                            <>
                                              <a
                                                className={buttonVariants({ variant: "default", className: "h-10 rounded-xl px-4" })}
                                                href={BOOKING_URL}
                                                rel="noreferrer"
                                                target="_blank"
                                              >
                                                {getMeetingButtonLabel(task.title)}
                                                <ArrowRight className="ml-2 h-4 w-4" />
                                              </a>
                                              <Button
                                                className="h-10 rounded-xl px-4"
                                                disabled={savingTaskId === task.id}
                                                onClick={() => markTaskComplete(task.id)}
                                                variant="outline"
                                              >
                                                {savingTaskId === task.id ? "Saving..." : "Mark Complete"}
                                              </Button>
                                            </>
                                          ) : null}
                                          {isCurrentTask && isSaasSubmissionTask(task.title) ? (
                                            <Button
                                              className="h-10 rounded-xl px-4"
                                              disabled={savingTaskId === task.id}
                                              onClick={() => markTaskComplete(task.id)}
                                              variant="outline"
                                            >
                                              {savingTaskId === task.id ? "Saving..." : "Mark Complete"}
                                            </Button>
                                          ) : null}
                                          {isCurrentTask && !isKZeroOwnedCurrentTask && !task.meetingCta && !isBookingTask(task.title) ? (
                                            (!isFirstCustomerPilotTask(task.title) || hasSavedFirstCustomerPilot) && !isSaasSubmissionTask(task.title) ? (
                                              <Button
                                                className="h-10 rounded-xl px-4"
                                                disabled={savingTaskId === task.id}
                                                onClick={() => markTaskComplete(task.id)}
                                              >
                                                {savingTaskId === task.id ? "Saving..." : "Mark Complete"}
                                              </Button>
                                            ) : null
                                          ) : null}
                                        </div>
                                      </div>

                                      {isCurrentTask && isFirstCustomerPilotTask(task.title) ? (
                                        <div
                                          className="mt-4 border-t border-border pt-4"
                                          id="first-customer-pilot-form"
                                          tabIndex={-1}
                                        >
                                          {hasSavedFirstCustomerPilot && bundle.firstCustomerPilot ? (
                                            <div className="rounded-xl border border-success-border/60 bg-success-surface px-4 py-3 text-sm text-secondary">
                                              <p className="font-medium text-foreground">Pilot details saved</p>
                                              <p className="mt-1">
                                                {bundle.firstCustomerPilot.customerAlias} · {bundle.firstCustomerPilot.targetRolloutTiming}
                                              </p>
                                            </div>
                                          ) : (
                                            <div className="grid gap-3 md:grid-cols-2">
                                              <label className="grid gap-2 text-sm text-secondary">
                                                <span>Customer name or alias</span>
                                                <input
                                                  className="h-11 rounded-xl border border-border bg-input px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                                  onChange={(event) => setPilotForm((current) => ({ ...current, customerAlias: event.target.value }))}
                                                  value={pilotForm.customerAlias}
                                                />
                                              </label>
                                              <label className="grid gap-2 text-sm text-secondary">
                                                <span>Target rollout date or timing</span>
                                                <input
                                                  className="h-11 rounded-xl border border-border bg-input px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                                  onChange={(event) => setPilotForm((current) => ({ ...current, targetRolloutTiming: event.target.value }))}
                                                  placeholder="e.g. July 2026 or week of July 15"
                                                  value={pilotForm.targetRolloutTiming}
                                                />
                                              </label>
                                              <label className="grid gap-2 text-sm text-secondary">
                                                <span>Estimated user count</span>
                                                <input
                                                  className="h-11 rounded-xl border border-border bg-input px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                                  min={1}
                                                  onChange={(event) => setPilotForm((current) => ({ ...current, estimatedUserCount: event.target.value }))}
                                                  type="number"
                                                  value={pilotForm.estimatedUserCount}
                                                />
                                              </label>
                                              <label className="grid gap-2 text-sm text-secondary">
                                                <span>Customer admin contact name</span>
                                                <input
                                                  className="h-11 rounded-xl border border-border bg-input px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                                  onChange={(event) => setPilotForm((current) => ({ ...current, adminContactName: event.target.value }))}
                                                  value={pilotForm.adminContactName}
                                                />
                                              </label>
                                              <label className="grid gap-2 text-sm text-secondary md:col-span-2">
                                                <span>Customer admin contact email</span>
                                                <input
                                                  className="h-11 rounded-xl border border-border bg-input px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                                  onChange={(event) => setPilotForm((current) => ({ ...current, adminContactEmail: event.target.value }))}
                                                  type="email"
                                                  value={pilotForm.adminContactEmail}
                                                />
                                              </label>
                                              <label className="grid gap-2 text-sm text-secondary md:col-span-2">
                                                <span>Notes</span>
                                                <textarea
                                                  className="min-h-[88px] rounded-xl border border-border bg-input px-3 py-2 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                                  onChange={(event) => setPilotForm((current) => ({ ...current, notes: event.target.value }))}
                                                  value={pilotForm.notes}
                                                />
                                              </label>
                                              <div className="md:col-span-2">
                                                <Button
                                                  className="h-10 rounded-xl px-4"
                                                  disabled={savingPilotDetails || !hasRequiredPilotFormDetails}
                                                  onClick={saveFirstCustomerPilot}
                                                >
                                                  {savingPilotDetails ? "Saving..." : "Save Pilot Details"}
                                                </Button>
                                              </div>
                                            </div>
                                          )}
                                          {pilotError ? <p className="mt-3 text-sm text-warning">{pilotError}</p> : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : null}

            {activeTab === "apps" ? (
              <Card className="border-border bg-surface p-4">
                <h3 className="text-lg font-semibold text-foreground">SaaS App Submissions</h3>
                <p className="mt-1 text-sm text-secondary">Apps currently in the compatibility review queue.</p>
                <div
                  className="mt-4 rounded-[1.2rem] border border-border bg-surface-secondary p-4"
                  id="apps-submission-form"
                  tabIndex={-1}
                >
                  <div className="flex flex-col gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">Submit App For Review</p>
                      <p className="mt-2 text-sm text-secondary">
                        Add each SaaS application you want KZero Passwordless to review for SSO readiness.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-2 text-sm text-secondary">
                        <span>App name</span>
                        <input
                          className="rounded-2xl border border-border bg-input px-4 py-3 text-foreground outline-none"
                          onChange={(event) => setAppForm((current) => ({ ...current, name: event.target.value }))}
                          placeholder="Microsoft 365"
                          value={appForm.name}
                        />
                      </label>
                      <label className="grid gap-2 text-sm text-secondary">
                        <span>Login URL</span>
                        <input
                          className="rounded-2xl border border-border bg-input px-4 py-3 text-foreground outline-none"
                          onChange={(event) => setAppForm((current) => ({ ...current, loginUrl: event.target.value }))}
                          placeholder="https://login.example.com"
                          type="url"
                          value={appForm.loginUrl}
                        />
                      </label>
                      <label className="grid gap-2 text-sm text-secondary">
                        <span>Priority</span>
                        <input
                          className="rounded-2xl border border-border bg-input px-4 py-3 text-foreground outline-none"
                          onChange={(event) => setAppForm((current) => ({ ...current, priority: event.target.value }))}
                          placeholder="High"
                          value={appForm.priority}
                        />
                      </label>
                      <label className="grid gap-2 text-sm text-secondary md:col-span-2">
                        <span>Notes</span>
                        <textarea
                          className="min-h-[110px] rounded-2xl border border-border bg-input px-4 py-3 text-foreground outline-none"
                          onChange={(event) => setAppForm((current) => ({ ...current, notes: event.target.value }))}
                          placeholder="Known SSO requirements, MFA expectations, or compatibility notes"
                          value={appForm.notes}
                        />
                      </label>
                    </div>
                    {appError ? <p className="text-sm text-danger">{appError}</p> : null}
                    <div className="flex flex-wrap gap-3">
                      <Button
                        className="h-10 px-4"
                        disabled={!appForm.name.trim() || savingAppSubmission}
                        onClick={submitPortalApp}
                      >
                        {savingAppSubmission ? "Saving..." : "Add SaaS Application"}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  {submittedApps.length > 0 ? (
                    submittedApps.map((app) => (
                      <div key={app.id} className="rounded-[1.1rem] border border-border bg-surface-secondary p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-foreground">{app.name}</p>
                          <span className="text-[11px] uppercase tracking-[0.2em] text-secondary">
                            {formatLabel(app.status)}
                          </span>
                        </div>
                        {app.priority ? <p className="mt-2 text-sm text-secondary">Priority: {app.priority}</p> : null}
                        {app.loginUrl ? <p className="mt-2 text-sm text-secondary">{app.loginUrl}</p> : null}
                        {app.notes ? <p className="mt-2 text-sm text-muted">{app.notes}</p> : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[1.1rem] border border-dashed border-border bg-surface-secondary p-4 text-sm text-muted">
                      <p>No SaaS apps submitted yet.</p>
                      <p className="mt-1">Submit the SaaS applications you want KZero Passwordless to review for SSO readiness.</p>
                    </div>
                  )}
                </div>
              </Card>
            ) : null}

            {activeTab === "documents" ? (
              <DocumentsReviewCard
                canUpload
                downloadUrlBase={`/api/portal/plans/${bundle.plan.id}/documents`}
                listUrl={`/api/portal/plans/${bundle.plan.id}/documents`}
                planType={bundle.plan.tenantType}
                uploadUrl={`/api/portal/plans/${bundle.plan.id}/documents`}
              />
            ) : null}

            {activeTab === "activity" && meaningfulComments.length > 0 ? (
              <Card className="border-border bg-surface p-4">
                <h3 className="text-lg font-semibold text-foreground">Activity</h3>
                <div className="mt-4 grid gap-3">
                  {meaningfulComments.map((comment) => (
                    <div key={comment.id} className="rounded-[1.1rem] border border-border bg-surface-secondary p-3.5 text-sm text-secondary">
                      <p className="font-medium text-foreground">{comment.author}</p>
                      <p className="mt-2 leading-6">{comment.body}</p>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
          </section>

        </div>
      </main>

      <PortalTourModal
        currentStep={tourStepIndex}
        onBack={goToPreviousTourStep}
        onFinish={finishTour}
        onNext={goToNextTourStep}
        onSkip={skipTour}
        open={tourOpen}
        steps={PORTAL_TOUR_STEPS}
      />

      <GuidePreviewModal guidePreview={guidePreview} onClose={() => setGuidePreview(null)} />
    </div>
  );
}
