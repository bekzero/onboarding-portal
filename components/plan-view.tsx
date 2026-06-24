"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Clock3,
  ListChecks,
  Mail
} from "lucide-react";
import { GuidePreviewModal } from "@/components/guide-preview-modal";
import { KzeroLogo } from "@/components/kzero-logo";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DocumentsReviewCard } from "@/components/documents-review-card";
import { getTaskGuides, type TaskGuide } from "@/lib/guide-previews";
import type { PlanBundle } from "@/lib/mock-data";
import { users } from "@/lib/mock-data";

const BOOKING_URL =
  "https://outlook.office.com/bookwithme/user/be858ab23c9b4c5f846a37d3d14e064b@klvn0.co/meetingtype/L_3aZP9-PUWjbOtkRaB7bw2?anonymous&ismsaljsauthenabled&ep=mlink";

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
};

type SubmittedPortalApp = PlanBundle["apps"][number] & {
  loginUrl?: string;
  notes?: string;
};

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatTaskStatusLabel(status: string) {
  if (status === "waiting_on_msp") {
    return "Action needed from you";
  }

  if (status === "waiting_on_kzero") {
    return "KZero is working on this";
  }

  if (status === "not_started") {
    return "Upcoming";
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
    return "KZero Sales Engineer";
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
  return waitingOn === "kzero" ? "KZero action in progress" : "Action needed from you";
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

function taskTone(status: string) {
  if (status === "complete") {
    return "border-emerald-400/20 bg-emerald-400/[0.05]";
  }

  if (status === "waiting_on_kzero" || status === "waiting_on_msp") {
    return "border-amber-400/20 bg-amber-400/[0.04]";
  }

  if (status === "in_progress") {
    return "border-blue-400/20 bg-blue-400/[0.05]";
  }

  return "border-white/10 bg-[#0a1424]";
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
  if (task.title === "Investigate app compatibility and draft plan") {
    return "Review app compatibility and prepare the onboarding plan";
  }

  if (task.title === "Upload onboarding plan for review") {
    return "Review the onboarding plan";
  }

  return task.title;
}

function getTaskDisplayDescription(task: Pick<PlanBundle["tasks"][number], "title" | "description">) {
  if (task.title === "Add employees and contractors") {
    return "Add the members of your team who will participate in the NFR rollout using their company email addresses.";
  }

  if (task.title === "Distribute Vault and extension guidance") {
    return "Share the Vault and browser extension guides with the members of your team you added in the previous step. Confirm they can import passwords and install the extension in Edge, Chrome, or Brave.";
  }

  if (task.title === "Submit SaaS apps for compatibility review") {
    return "Submit the SaaS applications you want KZero to review for SSO readiness.";
  }

  if (task.title === "Investigate app compatibility and draft plan") {
    return "KZero reviews the applications your team submitted and prepares the onboarding plan.";
  }

  if (task.title === "Upload onboarding plan for review") {
    return "KZero uploads the onboarding plan with recommended app sequencing and implementation guidance.";
  }

  if (task.title === "Complete first customer rollout") {
    return "Apply the validated rollout process to the first customer pilot.";
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
    notes: ""
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
  const [submittedApps, setSubmittedApps] = useState<SubmittedPortalApp[]>(initialBundle.apps);
  const [appForm, setAppForm] = useState<AppSubmissionFormState>(createAppSubmissionFormState);
  const [pilotForm, setPilotForm] = useState<FirstCustomerPilotFormState>(() => createFirstCustomerPilotFormState(initialBundle));
  const [savingPilotDetails, setSavingPilotDetails] = useState(false);
  const [pilotError, setPilotError] = useState<string | null>(null);
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
  const isBlocked = nextTask.waitingOn === "kzero" && !isKZeroOwnedCurrentTask;
  const showCurrentKzeroBanner =
    activeTab === "tasks" &&
    !isPlanComplete &&
    (isKZeroOwnedCurrentTask || nextTask.status === "waiting_on_kzero" || nextTask.waitingOn === "kzero");
  const meaningfulComments = bundle.comments.filter((comment) => isMeaningfulComment(comment.body));
  const nextTaskDescription = getTaskDisplayDescription(nextTask);
  const nextTaskTitle = getTaskDisplayTitle(nextTask);
  const yourNextAction = isPlanComplete
    ? "Onboarding complete"
    : isKZeroOwnedCurrentTask
      ? "KZero is reviewing this."
      : nextTaskTitle;
  const yourNextActionDetail = isPlanComplete
    ? "Your team has completed the current onboarding plan."
    : isKZeroOwnedCurrentTask
    ? "No action needed from you right now. We'll update this plan when the next step is ready."
    : nextTaskDescription;
  const actionStatusMessage = isPlanComplete
    ? "All onboarding steps are complete."
    : isKZeroOwnedCurrentTask
    ? "No action needed from you right now."
    : isSubmittingSaasApps
      ? "Submit your SaaS applications directly from the Apps section."
    : isKickoffBookingTask
      ? "Book your kickoff call with your KZero Sales Engineer to begin NFR tenant setup."
      : nextTaskDescription;
  const actionStatusReason = isPlanComplete
    ? "Your progress is saved and the onboarding plan is complete."
    : isBlocked
    ? "This step depends on KZero completing work before your team can move to the next milestone."
    : isKZeroOwnedCurrentTask
    ? "KZero is currently handling the work required to keep your onboarding plan moving."
    : isKickoffBookingTask
      ? "This meeting starts the NFR deployment and confirms the initial tenant configuration."
      : `Completing this step keeps ${safeNextStepPhase?.title ?? "your onboarding"} on track and unlocks the next milestone.`;
  const whatHappensNext = isPlanComplete
    ? "You can return to this workspace at any time to review completed onboarding milestones."
    : isKZeroOwnedCurrentTask
    ? "We'll update this plan when the next step is ready."
    : followingTask
    ? isKickoffBookingTask
      ? "After kickoff, you'll add backup admins and invite your MSP users."
      : `${getTaskDisplayTitle(followingTask)} (${formatTaskOwnerLabelShort(followingTask.owner)})`
    : "This completes the current onboarding milestone.";
  const currentStepLabel = isPlanComplete ? "Completed onboarding plan" : isKickoffBookingTask ? "Book kickoff call" : nextTaskTitle;
  const currentOwnerLabel = isPlanComplete
    ? "Complete"
    : nextTask.owner === "kzero_se"
    ? "KZero"
    : nextTask.owner === "shared"
      ? "Your team and KZero"
      : "Your team";
  const currentStatusLabel = isPlanComplete ? "Complete" : isBlocked ? "Blocked" : formatTaskStatusLabel(nextTask.status);
  const afterThisLabel = isPlanComplete
    ? "No further action required"
    : followingTask
    ? isKickoffBookingTask
      ? "Add backup admins"
      : getTaskDisplayTitle(followingTask)
    : "Complete onboarding milestone";
  const tabs: { id: PlanTab; label: string }[] = [
    { id: "overview", label: "Status" },
    { id: "tasks", label: "Tasks" },
    { id: "apps", label: "Apps" },
    { id: "documents", label: "Documents" },
    ...(meaningfulComments.length > 0 ? [{ id: "activity" as const, label: "Activity" }] : [])
  ];

  useEffect(() => {
    setPilotForm(createFirstCustomerPilotFormState(bundle));
  }, [bundle]);

  useEffect(() => {
    setSubmittedApps((current) => {
      const localOnlyApps = current.filter((app) => !bundle.apps.some((serverApp) => serverApp.id === app.id));
      return [...bundle.apps, ...localOnlyApps];
    });
  }, [bundle.apps]);

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
    goToTabSection("tasks", "current-task-card");
  }

  function getCurrentActionTargetTab() {
    const normalizedTitle = nextTask.title.toLowerCase();

    if (normalizedTitle.includes("submit saas apps")) {
      return "apps" as const;
    }

    if (normalizedTitle.includes("upload onboarding plan") || normalizedTitle.includes("document")) {
      return "documents" as const;
    }

    return "tasks" as const;
  }

  const currentActionTargetTab = getCurrentActionTargetTab();
  const currentActionCtaLabel =
    currentActionTargetTab === "apps"
      ? "Submit SaaS Apps"
      : currentActionTargetTab === "documents"
        ? "Go to Documents"
        : isSelectingFirstCustomerPilot
          ? "Select First Customer Pilot"
        : "Go to Current Task";

  function handleCurrentActionCta() {
    if (currentActionTargetTab === "apps") {
      goToTabSection("apps", "apps-submission-form");
      return;
    }

    if (currentActionTargetTab === "documents") {
      goToTab("documents");
      return;
    }

    if (isSelectingFirstCustomerPilot) {
      goToTabSection("tasks", "first-customer-pilot-form");
      return;
    }

    goToCurrentTask();
  }

  function openAppSubmissionForm() {
    goToTabSection("apps", "apps-submission-form");
  }

  function openFirstCustomerPilotForm() {
    goToTabSection("tasks", "first-customer-pilot-form");
  }

  function submitPortalApp() {
    const trimmedName = appForm.name.trim();
    if (!trimmedName) {
      return;
    }

    setSubmittedApps((current) => [
      {
        id: `local-app-${Date.now()}`,
        loginUrl: appForm.loginUrl.trim() || undefined,
        name: trimmedName,
        notes: appForm.notes.trim() || undefined,
        organizationId: bundle.organization.id,
        status: "submitted"
      },
      ...current
    ]);
    setAppForm(createAppSubmissionFormState());
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
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 md:px-6 md:py-6">
      <header className="rounded-[1.7rem] border border-white/10 bg-[#101c31]/90 px-4 py-4 shadow-panel md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <KzeroLogo className="w-fit shrink-0" imageClassName="h-auto w-[196px]" surface="dark" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-100/80">
                  {bundle.plan.tenantType.toUpperCase()} plan
                </p>
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-white md:text-3xl">{bundle.plan.title}</h1>
              <p className="mt-1 text-sm text-slate-300">{bundle.organization.name} - KZero Passwordless onboarding plan</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex min-w-[220px] items-center gap-3 rounded-2xl border border-white/10 bg-[#0b1424] px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.24em] text-slate-400">
                  <span>Progress</span>
                  <span>{bundle.plan.progress}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                    style={{ width: `${bundle.plan.progress}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
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
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.id
                ? "border-primary/40 bg-primary/15 text-white"
                : "border-white/10 bg-[#0d1627] text-slate-300 hover:border-white/20 hover:text-white"
            }`}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="mt-5 grid gap-5">
        <div className="grid gap-5 lg:grid-cols-12">
          <section className="grid gap-5 lg:col-span-8">
            <Card className="border-white/10 bg-[linear-gradient(135deg,#223c78_0%,#101c31_54%,#09111d_100%)] p-5 md:p-6">
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.26em] text-blue-100/80">
                  <span>{safeNextStepPhase?.title ?? "Kickoff"}</span>
                  <span className="text-slate-500">/</span>
                  <span>Current Step</span>
                </div>
                <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr] md:items-start">
                  <div className="space-y-3">
                    <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-white md:text-[2.8rem]">
                      {yourNextAction}
                    </h2>
                    <p className="max-w-2xl text-sm leading-7 text-blue-100/78">{yourNextActionDetail}</p>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-blue-100/78">
                      <span className="rounded-full bg-white/10 px-3 py-1">{formatTaskStatusLabel(nextTask.status)}</span>
                      <span>Current milestone: {safeNextStepPhase?.title ?? "Kickoff"}</span>
                      {nextTask.dueLabel ? <span>Due: {nextTask.dueLabel}</span> : null}
                    </div>
                  </div>
                  <div className="rounded-[1.4rem] border border-white/10 bg-[#0a1424]/70 p-4 text-sm">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">At a Glance</p>
                    <div className="mt-4 grid gap-3">
                      <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3">
                        <p className="text-slate-400">Current Step</p>
                        <p className="text-right font-medium text-white">{currentStepLabel}</p>
                      </div>
                      <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3">
                        <p className="text-slate-400">Owner</p>
                        <p className="text-right font-medium text-white">{currentOwnerLabel}</p>
                      </div>
                      <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3">
                        <p className="text-slate-400">Status</p>
                        <p className="text-right font-medium text-white">{currentStatusLabel}</p>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-slate-400">After This</p>
                        <p className="text-right font-medium text-white">{afterThisLabel}</p>
                      </div>
                      {isBlocked ? (
                        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-slate-200">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200">Blocked</p>
                          <p className="mt-2">{actionStatusReason}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {!isPlanComplete && !isKZeroOwnedCurrentTask ? (
                    isBookingTask(nextTask.title) || nextTask.meetingCta ? (
                      <>
                        <a
                          className={buttonVariants({ variant: "default", className: "h-11 px-5" })}
                          href={BOOKING_URL}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {getMeetingButtonLabel(nextTask.title)}
                        </a>
                        <Button
                          className="h-11 px-5"
                          disabled={savingTaskId === nextTask.id}
                          onClick={() => markTaskComplete(nextTask.id)}
                          variant="outline"
                        >
                          {savingTaskId === nextTask.id ? "Saving..." : "Mark Complete"}
                        </Button>
                      </>
                    ) : isSubmittingSaasApps ? (
                      <>
                        <Button className="h-11 px-5" onClick={openAppSubmissionForm}>
                          Submit SaaS Apps
                        </Button>
                        <Button
                          className="h-11 px-5"
                          disabled={savingTaskId === nextTask.id}
                          onClick={() => markTaskComplete(nextTask.id)}
                          variant="outline"
                        >
                          {savingTaskId === nextTask.id ? "Saving..." : "Mark Complete"}
                        </Button>
                      </>
                    ) : isSelectingFirstCustomerPilot ? (
                      <>
                        <Button className="h-11 px-5" onClick={openFirstCustomerPilotForm}>
                          Select First Customer Pilot
                        </Button>
                        {hasSavedFirstCustomerPilot ? (
                          <Button
                            className="h-11 px-5"
                            disabled={savingTaskId === nextTask.id}
                            onClick={() => markTaskComplete(nextTask.id)}
                            variant="outline"
                          >
                            {savingTaskId === nextTask.id ? "Saving..." : "Mark Complete"}
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <Button
                        className="h-11 px-5"
                        disabled={savingTaskId === nextTask.id}
                        onClick={() => markTaskComplete(nextTask.id)}
                      >
                        {savingTaskId === nextTask.id ? "Saving..." : "Mark Complete"}
                      </Button>
                    )
                  ) : null}
                </div>
                {isSelectingFirstCustomerPilot ? (
                  <div
                    className="rounded-[1.2rem] border border-white/10 bg-[#0a1424]/85 p-4"
                    id="first-customer-pilot-form"
                    tabIndex={-1}
                  >
                    <div className="flex flex-col gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">First Customer Pilot</p>
                        <h3 className="mt-2 text-lg font-semibold text-white">Capture the first customer rollout target</h3>
                        <p className="mt-1 text-sm text-slate-300">
                          You can use a customer alias if preferred. Add enough detail for KZero to review the pilot plan and prepare the tenant.
                        </p>
                      </div>
                      <p className="text-sm text-slate-300">Save the pilot details before marking this step complete.</p>
                      {!hasSavedFirstCustomerPilot ? <div className="grid gap-4 md:grid-cols-2">
                        <label className="grid gap-2 text-sm text-slate-300">
                          <span>Customer name or alias</span>
                          <input
                            className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                            onChange={(event) => setPilotForm((current) => ({ ...current, customerAlias: event.target.value }))}
                            value={pilotForm.customerAlias}
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-slate-300">
                          <span>Estimated user count</span>
                          <input
                            className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                            min={1}
                            onChange={(event) => setPilotForm((current) => ({ ...current, estimatedUserCount: event.target.value }))}
                            type="number"
                            value={pilotForm.estimatedUserCount}
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-slate-300">
                          <span>Target rollout date or timing</span>
                          <input
                            className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                            onChange={(event) => setPilotForm((current) => ({ ...current, targetRolloutTiming: event.target.value }))}
                            placeholder="e.g. July 2026 or Week of July 15"
                            value={pilotForm.targetRolloutTiming}
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-slate-300">
                          <span>Customer admin contact name</span>
                          <input
                            className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                            onChange={(event) => setPilotForm((current) => ({ ...current, adminContactName: event.target.value }))}
                            value={pilotForm.adminContactName}
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
                          <span>Customer admin contact email</span>
                          <input
                            className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                            onChange={(event) => setPilotForm((current) => ({ ...current, adminContactEmail: event.target.value }))}
                            type="email"
                            value={pilotForm.adminContactEmail}
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
                          <span>Notes</span>
                          <textarea
                            className="min-h-[110px] rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                            onChange={(event) => setPilotForm((current) => ({ ...current, notes: event.target.value }))}
                            value={pilotForm.notes}
                          />
                        </label>
                      </div> : null}
                      {hasSavedFirstCustomerPilot && bundle.firstCustomerPilot ? (
                        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-4 text-sm text-slate-200">
                          <p className="font-medium text-white">Pilot details saved</p>
                          <p className="mt-1">
                            {bundle.firstCustomerPilot.customerAlias} · {bundle.firstCustomerPilot.targetRolloutTiming}
                          </p>
                        </div>
                      ) : null}
                      {pilotError ? (
                        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">
                          {pilotError}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-3">
                        {!hasSavedFirstCustomerPilot ? (
                          <Button
                            className="h-11 px-5"
                            disabled={savingPilotDetails || !hasRequiredPilotFormDetails}
                            onClick={saveFirstCustomerPilot}
                          >
                            {savingPilotDetails ? "Saving..." : "Save Pilot Details"}
                          </Button>
                        ) : null}
                        {hasSavedFirstCustomerPilot ? (
                          <Button
                            className="h-11 px-5"
                            disabled={savingTaskId === nextTask.id}
                            onClick={() => markTaskComplete(nextTask.id)}
                            variant="outline"
                          >
                            {savingTaskId === nextTask.id ? "Saving..." : "Mark Complete"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>

            {activeTab === "overview" ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card className="border-white/10 bg-[#101a2d] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Progress</p>
                      <h3 className="mt-1 text-2xl font-semibold text-white">{bundle.plan.progress}% complete</h3>
                    </div>
                    <Badge status={nextTask.status}>{formatTaskStatusLabel(nextTask.status)}</Badge>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-white/10">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                      style={{ width: `${bundle.plan.progress}%` }}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-xl bg-[#0a1424] px-3 py-2">
                      <p className="text-slate-400">Done</p>
                      <p className="mt-1 font-semibold text-white">{completedTasks}</p>
                    </div>
                    <div className="rounded-xl bg-[#0a1424] px-3 py-2">
                      <p className="text-slate-400">Current</p>
                      <p className="mt-1 font-semibold text-white">{activeTasks}</p>
                    </div>
                    <div className="rounded-xl bg-[#0a1424] px-3 py-2">
                      <p className="text-slate-400">Submitted Apps</p>
                      <p className="mt-1 font-semibold text-white">{submittedApps.length}</p>
                    </div>
                  </div>
                </Card>

                <Card className="border-white/10 bg-[#101a2d] p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-white">KZero Contact</h3>
                      <p className="mt-1 text-sm text-slate-300">Your Sales Engineer for this onboarding plan.</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-[1.2rem] border border-white/10 bg-[#0a1424] p-4">
                    <div className="grid gap-4">
                      <div>
                        <p className="font-medium text-white">{kzeroContact?.name ?? "Ben Eakin"}</p>
                        <p className="mt-1 text-sm text-slate-300">KZero Sales Engineer</p>
                        <a className="mt-1 block text-sm text-blue-200 hover:text-blue-100" href="mailto:b.eakin@kzero.com">
                          b.eakin@kzero.com
                        </a>
                        <a
                          className="mt-3 inline-flex h-10 items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.03]"
                          href={BOOKING_URL}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Book Meeting
                        </a>
                      </div>
                      <div className="border-t border-white/10 pt-4">
                        <p className="font-medium text-white">KZero Support</p>
                        <a className="mt-1 block text-sm text-blue-200 hover:text-blue-100" href="mailto:support@kzero.com">
                          support@kzero.com
                        </a>
                      </div>
                      <div className="border-t border-white/10 pt-4">
                        <p className="font-medium text-white">KZero Sales Team</p>
                        <a className="mt-1 block text-sm text-blue-200 hover:text-blue-100" href="mailto:partners@kzero.com">
                          partners@kzero.com
                        </a>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="border-white/10 bg-[#101a2d] p-4 lg:col-span-2">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Current Status</h3>
                      <p className="mt-1 text-sm text-slate-300">
                        {isKZeroOwnedCurrentTask
                          ? "KZero is reviewing this. No action needed from you right now."
                          : "Use the action button to jump to the place where this step is completed."}
                      </p>
                    </div>
                    {!isPlanComplete ? (
                      <Button className="h-10 px-4" onClick={handleCurrentActionCta} variant="secondary">
                        {currentActionCtaLabel}
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Current Step</p>
                      <p className="mt-2 text-sm leading-6 text-white">{yourNextAction}</p>
                    </div>
                    <div className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Status</p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{actionStatusMessage}</p>
                    </div>
                    <div className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">What Happens Next</p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{whatHappensNext}</p>
                    </div>
                  </div>

                  {meaningfulComments.length > 0 ? (
                    <div className="mt-4 rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest Updates</p>
                      <div className="mt-3 grid gap-3">
                        {meaningfulComments.slice(0, 2).map((comment) => (
                          <div key={comment.id} className="rounded-[1rem] border border-white/10 bg-[#08111f] p-3.5 text-sm text-slate-300">
                            <p className="font-medium text-white">{comment.author}</p>
                            <p className="mt-2 leading-6">{comment.body}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </Card>
              </div>
            ) : null}

            {showCurrentKzeroBanner ? (
              <Card className="border-amber-400/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(59,130,246,0.06))] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-400/12 text-amber-200">
                      <Clock3 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-amber-200">KZero is reviewing this</p>
                      <p className="mt-1 text-lg font-semibold text-white">{nextTaskTitle}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{nextTaskDescription}</p>
                    </div>
                  </div>
                  <div className="text-sm text-amber-100/85">{formatTaskStatusLabel(nextTask.status)}</div>
                </div>
              </Card>
            ) : null}

            {activeTab === "tasks" ? (
              <Card className="border-white/10 bg-[#101a2d] p-5">
                <div className="mb-5 flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                    <ListChecks className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white">Phase Checklist</h3>
                    <p className="text-sm text-slate-300">Track each step, who owns it, and when a meeting is needed.</p>
                  </div>
                </div>

                <div className="grid gap-4">
                  {phaseTasks.map(({ phase, tasks }, index) => {
                    const phaseTaskIndexes = tasks.map((task) => orderedTasks.findIndex((item) => item.id === task.id));
                    const hasCurrentTask = phaseTaskIndexes.includes(activeTaskIndex);
                    const hasIncompleteTask = tasks.some((task) => task.status !== "complete");
                    const isPhaseLocked =
                      !isPlanComplete &&
                      !hasCurrentTask &&
                      hasIncompleteTask &&
                      phaseTaskIndexes.length > 0 &&
                      phaseTaskIndexes.every((taskIndex) => taskIndex > activeTaskIndex);
                    const phaseStatusLabel = isPhaseLocked
                      ? "Locked"
                      : hasCurrentTask
                        ? "Current"
                        : hasIncompleteTask
                          ? "Upcoming"
                          : "Complete";

                    return (
                      <div key={phase.id} className="rounded-[1.5rem] border border-white/10 bg-[#0d1627] p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div>
                                <h4 className="text-lg font-semibold text-white">{phase.title}</h4>
                                <p className="text-sm text-slate-300">{phase.description}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm text-slate-400">{tasks.length} tasks</p>
                                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{phaseStatusLabel}</p>
                              </div>
                            </div>

                            <div className="mt-4 border-l border-white/10 pl-4">
                              <div className="grid gap-3">
                                {tasks.map((task) => {
                                  const guides = getTaskGuides(task.title);
                                  const taskIndex = orderedTasks.findIndex((item) => item.id === task.id);
                                  const isCurrentTask = !isPlanComplete && task.id === nextTask.id;
                                  const isCompleted = task.status === "complete";
                                  const isLocked = !isCompleted && !isCurrentTask && taskIndex > activeTaskIndex;
                                  const taskStatusLabel = getPortalTaskStatusLabel(task, isLocked);
                                  const taskToneClass = isLocked ? "border-white/8 bg-[#0b1423]/70" : taskTone(task.status);

                                  return (
                                    <div
                                      id={isCurrentTask ? "current-task-card" : undefined}
                                      tabIndex={isCurrentTask ? -1 : undefined}
                                      key={task.id}
                                      className={`rounded-[1.2rem] border p-4 ${taskToneClass}`}
                                    >
                                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                                            <span>Owner: {formatTaskOwnerLabel(task.owner)}</span>
                                            {task.dueLabel ? (
                                              <>
                                                <span className="text-slate-600">/</span>
                                                <span>Due: {task.dueLabel}</span>
                                              </>
                                            ) : null}
                                          </div>
                                          <div className="mt-2 flex flex-wrap items-center gap-3">
                                            <h5 className="text-base font-semibold text-white">{getTaskDisplayTitle(task)}</h5>
                                            {guides.length > 0 ? (
                                              <button
                                                className={`text-sm font-medium transition ${
                                                  isLocked ? "text-slate-400 hover:text-slate-300" : "text-blue-200 hover:text-blue-100"
                                                }`}
                                                onClick={() => setGuidePreview({ guides, stepName: task.title })}
                                                type="button"
                                              >
                                                {guides.length > 1 ? "View Guides" : "View Guide"}
                                              </button>
                                            ) : null}
                                          </div>
                                          <p className="mt-1 text-sm leading-6 text-slate-300">
                                            {isLocked ? "Complete previous steps to unlock." : getTaskDisplayDescription(task)}
                                          </p>
                                        </div>

                                        <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                                          <Badge status={isLocked ? "not_started" : task.waitingOn === "kzero" && task.status !== "complete" ? "waiting_on_kzero" : task.status}>
                                            {taskStatusLabel}
                                          </Badge>
                                          {guides.length > 0 ? (
                                            <Button
                                              className="h-10 px-4"
                                              onClick={() => setGuidePreview({ guides, stepName: task.title })}
                                              variant="outline"
                                            >
                                              {guides.length > 1 ? "View Guides" : "View Guide"}
                                            </Button>
                                          ) : null}
                                          {isCurrentTask && isSaasSubmissionTask(task.title) ? (
                                            <Button className="h-10 px-4" onClick={openAppSubmissionForm}>
                                              Submit SaaS Apps
                                            </Button>
                                          ) : null}
                                          {isCurrentTask && isFirstCustomerPilotTask(task.title) ? (
                                            <Button className="h-10 px-4" onClick={openFirstCustomerPilotForm}>
                                              Select First Customer Pilot
                                            </Button>
                                          ) : null}
                                          {isCurrentTask && (task.meetingCta || isBookingTask(task.title)) ? (
                                            <>
                                              <a
                                                className={buttonVariants({ variant: "default", className: "h-10 px-4" })}
                                                href={BOOKING_URL}
                                                rel="noreferrer"
                                                target="_blank"
                                              >
                                                {getMeetingButtonLabel(task.title)}
                                                <ArrowRight className="ml-2 h-4 w-4" />
                                              </a>
                                              <Button
                                                className="h-10 px-4"
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
                                              className="h-10 px-4"
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
                                                className="h-10 px-4"
                                                disabled={savingTaskId === task.id}
                                                onClick={() => markTaskComplete(task.id)}
                                              >
                                                {savingTaskId === task.id ? "Saving..." : "Mark Complete"}
                                              </Button>
                                            ) : null
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : null}

            {activeTab === "apps" ? (
              <Card className="border-white/10 bg-[#101a2d] p-4">
                <h3 className="text-lg font-semibold text-white">SaaS App Submissions</h3>
                <p className="mt-1 text-sm text-slate-300">Apps currently in the compatibility review queue.</p>
                <div
                  className="mt-4 rounded-[1.2rem] border border-white/10 bg-[#0a1424] p-4"
                  id="apps-submission-form"
                  tabIndex={-1}
                >
                  <div className="flex flex-col gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Submit App For Review</p>
                      <p className="mt-2 text-sm text-slate-300">
                        Add each SaaS application you want KZero to review for SSO readiness.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-2 text-sm text-slate-300">
                        <span>App name</span>
                        <input
                          className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                          onChange={(event) => setAppForm((current) => ({ ...current, name: event.target.value }))}
                          placeholder="Microsoft 365"
                          value={appForm.name}
                        />
                      </label>
                      <label className="grid gap-2 text-sm text-slate-300">
                        <span>Login URL</span>
                        <input
                          className="rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                          onChange={(event) => setAppForm((current) => ({ ...current, loginUrl: event.target.value }))}
                          placeholder="https://login.example.com"
                          type="url"
                          value={appForm.loginUrl}
                        />
                      </label>
                      <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
                        <span>Notes</span>
                        <textarea
                          className="min-h-[110px] rounded-2xl border border-white/10 bg-[#08111f] px-4 py-3 text-white outline-none"
                          onChange={(event) => setAppForm((current) => ({ ...current, notes: event.target.value }))}
                          placeholder="Known SSO requirements, MFA expectations, or compatibility notes"
                          value={appForm.notes}
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button className="h-10 px-4" disabled={!appForm.name.trim()} onClick={submitPortalApp}>
                        Add SaaS Application
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  {submittedApps.length > 0 ? (
                    submittedApps.map((app) => (
                      <div key={app.id} className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-white">{app.name}</p>
                          <span className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                            {formatLabel(app.status)}
                          </span>
                        </div>
                        {app.loginUrl ? <p className="mt-2 text-sm text-slate-300">{app.loginUrl}</p> : null}
                        {app.notes ? <p className="mt-2 text-sm text-slate-400">{app.notes}</p> : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[1.1rem] border border-dashed border-white/10 bg-[#0a1424] p-4 text-sm text-slate-400">
                      <p>No SaaS apps submitted yet.</p>
                      <p className="mt-1">Submit the SaaS applications you want KZero to review for SSO readiness.</p>
                    </div>
                  )}
                </div>
              </Card>
            ) : null}

            {activeTab === "documents" ? <DocumentsReviewCard attachments={bundle.attachments} planId={bundle.plan.id} /> : null}

            {activeTab === "activity" && meaningfulComments.length > 0 ? (
              <Card className="border-white/10 bg-[#101a2d] p-4">
                <h3 className="text-lg font-semibold text-white">Activity</h3>
                <div className="mt-4 grid gap-3">
                  {meaningfulComments.map((comment) => (
                    <div key={comment.id} className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-3.5 text-sm text-slate-300">
                      <p className="font-medium text-white">{comment.author}</p>
                      <p className="mt-2 leading-6">{comment.body}</p>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
          </section>

        </div>
      </main>

      <GuidePreviewModal guidePreview={guidePreview} onClose={() => setGuidePreview(null)} />
    </div>
  );
}
