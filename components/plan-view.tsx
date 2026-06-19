"use client";

import { useState } from "react";
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

function getMeetingButtonLabel(title: string) {
  return title.toLowerCase().includes("implementation") ? "Book Implementation Session" : "Book Meeting";
}

function isMeaningfulComment(body: string) {
  const normalizedBody = body.toLowerCase();
  return !normalizedBody.includes("placeholder") &&
    !normalizedBody.includes("kickoff booking link is ready when abcmsp is ready to schedule") &&
    !normalizedBody.includes("demo-generated onboarding case");
}

type PlanTab = "overview" | "tasks" | "apps" | "documents" | "activity";

export function PlanView({
  bundle: initialBundle
}: {
  bundle: PlanBundle;
}) {
  const [activeTab, setActiveTab] = useState<PlanTab>("overview");
  const [bundle, setBundle] = useState<PlanBundle>(initialBundle);
  const [guidePreview, setGuidePreview] = useState<GuidePreviewState>(null);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
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
  const waitingOnKZeroTasks = bundle.tasks.filter((task) => task.status === "waiting_on_kzero").length;
  const activeTasks = bundle.tasks.filter((task) => ["in_progress", "waiting_on_msp"].includes(task.status)).length;
  const safeNextStepPhase = bundle.phases.find((phase) => phase.id === nextTask.phaseId);
  const phaseTasks = bundle.phases.map((phase) => ({
    phase,
    tasks: bundle.tasks.filter((task) => task.phaseId === phase.id)
  }));
  const kzeroContact = users.find((user) => user.role === "sales_engineer");
  const isKZeroOwnedCurrentTask = !isPlanComplete && nextTask.owner === "kzero_se";
  const isKickoffBookingTask = isBookingTask(nextTask.title);
  const isBlocked = nextTask.waitingOn === "kzero" && !isKZeroOwnedCurrentTask;
  const showCurrentKzeroBanner =
    activeTab === "tasks" &&
    !isPlanComplete &&
    (isKZeroOwnedCurrentTask || nextTask.status === "waiting_on_kzero" || nextTask.waitingOn === "kzero");
  const meaningfulComments = bundle.comments.filter((comment) => isMeaningfulComment(comment.body));
  const yourNextAction = isPlanComplete
    ? "Onboarding complete"
    : isKZeroOwnedCurrentTask
      ? "No action needed from you right now."
      : nextTask.title;
  const yourNextActionDetail = isPlanComplete
    ? "Your team has completed the current onboarding plan."
    : isKZeroOwnedCurrentTask
    ? "KZero is currently moving this step forward. We will let you know when your team needs to step back in."
    : nextTask.description;
  const kzeroCurrentAction = isPlanComplete
    ? "Implementation complete"
    : isKZeroOwnedCurrentTask
    ? nextTask.title
    : followingTask?.owner === "kzero_se"
      ? followingTask.title
      : "KZero Sales Engineer is standing by for your current step.";
  const kzeroCurrentActionDetail = isPlanComplete
    ? "No active KZero work remains in this onboarding plan."
    : isKZeroOwnedCurrentTask
    ? nextTask.description
    : followingTask?.owner === "kzero_se"
      ? "This is the next KZero-owned step after you complete the current action."
      : "Your KZero Sales Engineer will continue with implementation support once your current action is complete.";
  const actionStatusHeading = isPlanComplete
    ? "No Blockers Right Now"
    : isBlocked
    ? "Blocked"
    : isKZeroOwnedCurrentTask
      ? "KZero Is Working On This"
      : "Action Needed From You";
  const actionStatusMessage = isPlanComplete
    ? "All onboarding steps are complete."
    : isKZeroOwnedCurrentTask
    ? "No action needed from you right now."
    : isKickoffBookingTask
      ? "Book your kickoff call with your KZero Sales Engineer to begin NFR tenant setup."
      : nextTask.description;
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
    : followingTask
    ? isKickoffBookingTask
      ? "After kickoff, you'll add backup admins and invite your MSP users."
      : `${followingTask.title} (${formatTaskOwnerLabelShort(followingTask.owner)})`
    : "This completes the current onboarding milestone.";
  const currentStepLabel = isPlanComplete ? "Completed onboarding plan" : isKickoffBookingTask ? "Book kickoff call" : nextTask.title;
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
      : followingTask.title
    : "Complete onboarding milestone";
  const tabs: { id: PlanTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "tasks", label: "Tasks" },
    { id: "apps", label: "Apps" },
    { id: "documents", label: "Documents" },
    ...(meaningfulComments.length > 0 ? [{ id: "activity" as const, label: "Activity" }] : [])
  ];

  async function markTaskComplete(taskId: string) {
    setSavingTaskId(taskId);

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
              <p className="mt-1 text-sm text-slate-300">{bundle.organization.name} - KZero Passwordless onboarding workspace</p>
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
                  <span>Current Action</span>
                </div>
                <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr] md:items-start">
                  <div className="space-y-3">
                    <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-white md:text-[2.8rem]">
                      {yourNextAction}
                    </h2>
                    <p className="max-w-2xl text-sm leading-7 text-blue-100/78">{yourNextActionDetail}</p>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-blue-100/78">
                      <span className="rounded-full bg-white/10 px-3 py-1">{formatTaskStatusLabel(nextTask.status)}</span>
                      <span>Current Milestone: {safeNextStepPhase?.title ?? "Kickoff"}</span>
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
                      <p className="mt-1 font-semibold text-white">{bundle.apps.length}</p>
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
                      <h3 className="text-lg font-semibold text-white">{actionStatusHeading}</h3>
                      <p className="mt-1 text-sm text-slate-300">
                        {isKZeroOwnedCurrentTask
                          ? "KZero is moving the current step forward."
                          : "Here is the clearest view of what needs attention right now."}
                      </p>
                    </div>
                    {!isKZeroOwnedCurrentTask && nextTask.meetingCta ? (
                      <a
                        className={buttonVariants({ variant: "secondary", className: "h-10 px-4" })}
                        href={BOOKING_URL}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Book Meeting
                      </a>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">What to Do</p>
                      <p className="mt-2 text-sm leading-6 text-white">{actionStatusMessage}</p>
                    </div>
                    <div className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Why It Matters</p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{actionStatusReason}</p>
                    </div>
                    <div className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">What Happens Next</p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{whatHappensNext}</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest Updates</p>
                    {meaningfulComments.length > 0 ? (
                      <div className="mt-3 grid gap-3">
                        {meaningfulComments.slice(0, 2).map((comment) => (
                          <div key={comment.id} className="rounded-[1rem] border border-white/10 bg-[#08111f] p-3.5 text-sm text-slate-300">
                            <p className="font-medium text-white">{comment.author}</p>
                            <p className="mt-2 leading-6">{comment.body}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[1rem] border border-dashed border-white/10 bg-[#08111f] p-3.5 text-sm text-slate-400">
                        <p>No updates yet.</p>
                        <p className="mt-1">Updates from your team or KZero will appear here.</p>
                      </div>
                    )}
                  </div>
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
                      <p className="text-xs uppercase tracking-[0.24em] text-amber-200">KZero is working on this</p>
                      <p className="mt-1 text-lg font-semibold text-white">{nextTask.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{nextTask.description}</p>
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
                    <p className="text-sm text-slate-300">A tighter view of what happens next, who owns it, and where meetings are needed.</p>
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
                                    <div key={task.id} className={`rounded-[1.2rem] border p-4 ${taskToneClass}`}>
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
                                            <h5 className="text-base font-semibold text-white">{task.title}</h5>
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
                                            {isLocked ? "Complete previous steps to unlock." : task.description}
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
                                          {isCurrentTask && !isKZeroOwnedCurrentTask && !task.meetingCta && !isBookingTask(task.title) ? (
                                            <Button
                                              className="h-10 px-4"
                                              disabled={savingTaskId === task.id}
                                              onClick={() => markTaskComplete(task.id)}
                                            >
                                              {savingTaskId === task.id ? "Saving..." : "Mark Complete"}
                                            </Button>
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
                <div className="mt-4 grid gap-3">
                  {bundle.apps.length > 0 ? (
                    bundle.apps.map((app) => (
                      <div key={app.id} className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-white">{app.name}</p>
                          <span className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                            {formatLabel(app.status)}
                          </span>
                        </div>
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
