"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  Lock,
  Mail,
  ShieldCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PlanBundle, Task } from "@/lib/mock-data";
import { users } from "@/lib/mock-data";

const BOOKING_URL =
  "https://outlook.office.com/bookwithme/user/be858ab23c9b4c5f846a37d3d14e064b@klvn0.co/meetingtype/L_3aZP9-PUWjbOtkRaB7bw2?anonymous&ismsaljsauthenabled&ep=mlink";

type DemoSubmittedApp = {
  id: string;
  loginUrl: string;
  name: string;
  notes: string;
  priority: "High" | "Medium" | "Low";
};

type DemoState = {
  completedTaskIds: string[];
  submittedApps: DemoSubmittedApp[];
};

type TaskViewState = "complete" | "active" | "locked";

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function isBookingTask(task: Task) {
  return task.title.toLowerCase().includes("book") && task.title.toLowerCase().includes("meeting");
}

function isAppSubmissionTask(task: Task) {
  return task.title.toLowerCase().includes("submit saas apps");
}

function isDocumentationTask(task: Task) {
  return task.title.toLowerCase().includes("distribute vault");
}

function isKZeroOwnedTask(task: Task) {
  return task.owner === "kzero_se";
}

function getStorageKey(planId: string) {
  return `demo-plan-state:${planId}`;
}

function taskStateClass(taskState: TaskViewState, task: Task) {
  if (taskState === "locked") {
    return "border-white/8 bg-[#0b1423]/70";
  }

  if (taskState === "complete") {
    return "border-emerald-400/18 bg-emerald-400/[0.05]";
  }

  if (isKZeroOwnedTask(task)) {
    return "border-amber-400/22 bg-amber-400/[0.05]";
  }

  return "border-blue-400/18 bg-blue-400/[0.05]";
}

export function DemoPlanView({ bundle }: { bundle: PlanBundle }) {
  const orderedTasks = bundle.plan.taskIds
    .map((taskId) => bundle.tasks.find((task) => task.id === taskId))
    .filter((task): task is Task => Boolean(task));

  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const [submittedApps, setSubmittedApps] = useState<DemoSubmittedApp[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [formState, setFormState] = useState({
    loginUrl: "",
    name: "",
    notes: "",
    priority: "Medium" as DemoSubmittedApp["priority"]
  });

  useEffect(() => {
    const rawState = window.localStorage.getItem(getStorageKey(bundle.plan.id));

    if (rawState) {
      try {
        const parsed = JSON.parse(rawState) as Partial<DemoState>;
        setCompletedTaskIds(Array.isArray(parsed.completedTaskIds) ? parsed.completedTaskIds : []);
        setSubmittedApps(Array.isArray(parsed.submittedApps) ? parsed.submittedApps : []);
      } catch {
        setCompletedTaskIds([]);
        setSubmittedApps([]);
      }
    }

    setIsHydrated(true);
  }, [bundle.plan.id]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const state: DemoState = {
      completedTaskIds,
      submittedApps
    };

    window.localStorage.setItem(getStorageKey(bundle.plan.id), JSON.stringify(state));
  }, [bundle.plan.id, completedTaskIds, isHydrated, submittedApps]);

  const activeTaskIndex = orderedTasks.findIndex((task) => !completedTaskIds.includes(task.id));
  const currentTask = activeTaskIndex === -1 ? null : orderedTasks[activeTaskIndex];
  const currentPhase = currentTask
    ? bundle.phases.find((phase) => phase.id === currentTask.phaseId) ?? null
    : null;
  const completedCount = completedTaskIds.length;
  const progress = orderedTasks.length === 0 ? 0 : Math.round((completedCount / orderedTasks.length) * 100);
  const currentOwnerState = currentTask
    ? isKZeroOwnedTask(currentTask)
      ? "Waiting on KZero"
      : "Waiting on MSP"
    : "Complete";
  const currentStatusBadge = currentTask
    ? isKZeroOwnedTask(currentTask)
      ? "waiting_on_kzero"
      : completedTaskIds.includes(currentTask.id)
        ? "complete"
        : "waiting_on_msp"
    : "complete";
  const phaseGroups = bundle.phases.map((phase) => ({
    phase,
    tasks: orderedTasks.filter((task) => task.phaseId === phase.id)
  }));
  const kzeroContact = users.find((user) => user.id === bundle.organization.assignedSalesEngineerId);

  function markTaskComplete(taskId: string) {
    setCompletedTaskIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
  }

  function resetDemoState() {
    setCompletedTaskIds([]);
    setSubmittedApps([]);
    setFormState({
      loginUrl: "",
      name: "",
      notes: "",
      priority: "Medium"
    });
    window.localStorage.removeItem(getStorageKey(bundle.plan.id));
  }

  function submitApp() {
    const trimmedName = formState.name.trim();
    const trimmedUrl = formState.loginUrl.trim();

    if (!trimmedName || !trimmedUrl) {
      return;
    }

    setSubmittedApps((current) => [
      ...current,
      {
        id: `submitted-${Date.now()}`,
        loginUrl: trimmedUrl,
        name: trimmedName,
        notes: formState.notes.trim(),
        priority: formState.priority
      }
    ]);

    setFormState({
      loginUrl: "",
      name: "",
      notes: "",
      priority: "Medium"
    });
  }

  function canMarkActiveTaskComplete(task: Task) {
    if (isKZeroOwnedTask(task)) {
      return false;
    }

    if (isAppSubmissionTask(task)) {
      return submittedApps.length > 0;
    }

    return true;
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 md:px-6 md:py-6">
      <header className="rounded-[1.7rem] border border-white/10 bg-[#101c31]/90 px-4 py-4 shadow-panel md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-100/80">
                  {bundle.plan.tenantType.toUpperCase()} plan
                </p>
                <span className="rounded-full border border-blue-300/20 bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-100">
                  Demo mode
                </span>
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-white md:text-3xl">{bundle.plan.title}</h1>
              <p className="mt-1 text-sm text-slate-300">{bundle.organization.name} - KZero Passwordless onboarding workspace</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/">
              <Button variant="outline" className="h-9 px-4">
                Overview
              </Button>
            </Link>
            <a
              className={buttonVariants({ variant: "secondary" })}
              href={BOOKING_URL}
              rel="noreferrer"
              target="_blank"
            >
              Book kickoff
            </a>
          </div>
        </div>
      </header>

      <main className="mt-5 grid gap-5">
        <div className="rounded-full border border-blue-300/20 bg-blue-400/10 px-4 py-2 text-center text-sm text-blue-100">
          Demo mode - mock onboarding data
        </div>

        <div className="grid gap-5 lg:grid-cols-12">
          <section className="grid gap-5 lg:col-span-8">
            <Card className="border-white/10 bg-[linear-gradient(135deg,#223c78_0%,#101c31_54%,#09111d_100%)] p-5 md:p-6">
              <div className="grid gap-5 md:grid-cols-[1.2fr_0.8fr] md:items-start">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.26em] text-blue-100/80">
                    <span>{currentPhase?.title ?? "Onboarding complete"}</span>
                    <span className="text-slate-500">/</span>
                    <span>{currentOwnerState}</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-white md:text-[2.6rem]">
                      {currentTask?.title ?? "All onboarding steps are complete."}
                    </h2>
                    <p className="max-w-2xl text-sm leading-7 text-blue-100/78">
                      {currentTask?.description ??
                        "You have completed the guided demo workflow. Reset the demo to walk through it again."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {currentTask && isBookingTask(currentTask) ? (
                      <>
                        <a
                          className={buttonVariants({ variant: "default" })}
                          href={BOOKING_URL}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open Microsoft Bookings
                        </a>
                        <Button onClick={() => markTaskComplete(currentTask.id)}>Mark meeting booked</Button>
                      </>
                    ) : null}
                    {currentTask && isDocumentationTask(currentTask) ? (
                      <Button onClick={() => markTaskComplete(currentTask.id)}>Mark documentation distributed</Button>
                    ) : null}
                    {currentTask && isAppSubmissionTask(currentTask) && submittedApps.length > 0 ? (
                      <Button onClick={() => markTaskComplete(currentTask.id)}>Mark SaaS app step complete</Button>
                    ) : null}
                    {currentTask && !isBookingTask(currentTask) && !isDocumentationTask(currentTask) && !isAppSubmissionTask(currentTask) && canMarkActiveTaskComplete(currentTask) ? (
                      <Button onClick={() => markTaskComplete(currentTask.id)}>Mark complete</Button>
                    ) : null}
                    {currentTask && isKZeroOwnedTask(currentTask) ? (
                      <Button variant="outline" onClick={() => markTaskComplete(currentTask.id)}>
                        Demo only: simulate KZero completion
                      </Button>
                    ) : null}
                    {!currentTask ? (
                      <Button variant="outline" onClick={resetDemoState}>
                        Restart demo
                      </Button>
                    ) : null}
                  </div>
                  {currentTask && isKZeroOwnedTask(currentTask) ? (
                    <p className="text-sm text-amber-100/85">
                      This step is owned by KZero and cannot be completed by the MSP in production.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-[1.4rem] border border-white/10 bg-[#0a1424]/70 p-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.24em] text-slate-400">
                    <span>Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-white/10">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Done</p>
                      <p className="mt-1 text-2xl font-semibold text-white">{completedCount}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Current</p>
                      <p className="mt-1 text-2xl font-semibold text-white">{currentTask ? 1 : 0}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Locked</p>
                      <p className="mt-1 text-2xl font-semibold text-white">
                        {Math.max(orderedTasks.length - completedCount - (currentTask ? 1 : 0), 0)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 text-sm text-slate-300">
                    <p>Current owner</p>
                    <p className="mt-1 font-medium text-white">{currentOwnerState}</p>
                  </div>
                </div>
              </div>
            </Card>

            {currentTask && isKZeroOwnedTask(currentTask) ? (
              <Card className="border-amber-400/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(59,130,246,0.06))] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-400/12 text-amber-200">
                      <Clock3 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-amber-200">Waiting on KZero</p>
                      <p className="mt-1 text-lg font-semibold text-white">{currentTask.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{currentTask.description}</p>
                    </div>
                  </div>
                  <Badge status="waiting_on_kzero">waiting on kzero</Badge>
                </div>
              </Card>
            ) : null}

            <Card className="border-white/10 bg-[#101a2d] p-5">
              <div className="mb-5 flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Guided onboarding steps</h3>
                  <p className="text-sm text-slate-300">Complete each step in order to unlock the next part of the rollout.</p>
                </div>
              </div>

              <div className="grid gap-4">
                {phaseGroups.map(({ phase, tasks }, phaseIndex) => (
                  <div key={phase.id} className="rounded-[1.4rem] border border-white/10 bg-[#0d1627] p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                        {phaseIndex + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                          <div>
                            <h4 className="text-lg font-semibold text-white">{phase.title}</h4>
                            <p className="text-sm text-slate-300">{phase.description}</p>
                          </div>
                          <p className="text-sm text-slate-400">{tasks.length} steps</p>
                        </div>

                        <div className="mt-4 grid gap-3">
                          {tasks.map((task) => {
                            const taskIndex = orderedTasks.findIndex((item) => item.id === task.id);
                            const isCompleted = completedTaskIds.includes(task.id);
                            const isActive = taskIndex === activeTaskIndex;
                            const taskViewState: TaskViewState = isCompleted
                              ? "complete"
                              : isActive
                                ? "active"
                                : "locked";

                            return (
                              <div key={task.id} className={`rounded-[1.2rem] border p-4 ${taskStateClass(taskViewState, task)}`}>
                                {taskViewState === "complete" ? (
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-emerald-200">
                                        <CheckCircle2 className="h-4 w-4" />
                                        <span>Complete</span>
                                      </div>
                                      <p className="mt-2 text-base font-semibold text-white">{task.title}</p>
                                    </div>
                                    <p className="text-sm text-slate-300">{task.owner === "kzero_se" ? "KZero SE" : task.owner.toUpperCase()}</p>
                                  </div>
                                ) : null}

                                {taskViewState === "locked" ? (
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                                        <Lock className="h-4 w-4" />
                                        <span>Locked</span>
                                      </div>
                                      <p className="mt-2 text-base font-semibold text-white">{task.title}</p>
                                      <p className="mt-1 text-sm text-slate-400">Complete previous step to unlock.</p>
                                    </div>
                                  </div>
                                ) : null}

                                {taskViewState === "active" ? (
                                  <div className="grid gap-4">
                                    <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-300">
                                      <span>{isKZeroOwnedTask(task) ? "Waiting on KZero" : "Waiting on MSP"}</span>
                                      <span className="text-slate-600">/</span>
                                      <span>{task.owner === "kzero_se" ? "KZero SE" : task.owner.toUpperCase()}</span>
                                    </div>
                                    <div>
                                      <h5 className="text-lg font-semibold text-white">{task.title}</h5>
                                      <p className="mt-2 text-sm leading-6 text-slate-300">{task.description}</p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
                                      {task.dueLabel ? (
                                        <div className="flex items-center gap-2">
                                          <CalendarDays className="h-4 w-4 text-blue-200" />
                                          <span>{task.dueLabel}</span>
                                        </div>
                                      ) : null}
                                      {isKZeroOwnedTask(task) ? (
                                        <div className="flex items-center gap-2 text-amber-100/85">
                                          <CircleAlert className="h-4 w-4 text-amber-200" />
                                          <span>Waiting on KZero</span>
                                        </div>
                                      ) : null}
                                    </div>

                                    {isAppSubmissionTask(task) ? (
                                      <div className="grid gap-4 rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-4">
                                        <div className="grid gap-3 md:grid-cols-2">
                                          <label className="grid gap-2 text-sm text-slate-300">
                                            <span>App name</span>
                                            <input
                                              className="rounded-xl border border-white/10 bg-[#08111f] px-3 py-2 text-white outline-none placeholder:text-slate-500"
                                              onChange={(event) =>
                                                setFormState((current) => ({ ...current, name: event.target.value }))
                                              }
                                              placeholder="Microsoft 365"
                                              value={formState.name}
                                            />
                                          </label>
                                          <label className="grid gap-2 text-sm text-slate-300">
                                            <span>Login URL</span>
                                            <input
                                              className="rounded-xl border border-white/10 bg-[#08111f] px-3 py-2 text-white outline-none placeholder:text-slate-500"
                                              onChange={(event) =>
                                                setFormState((current) => ({ ...current, loginUrl: event.target.value }))
                                              }
                                              placeholder="https://login.example.com"
                                              type="url"
                                              value={formState.loginUrl}
                                            />
                                          </label>
                                        </div>
                                        <div className="grid gap-3 md:grid-cols-[0.5fr_1.5fr]">
                                          <label className="grid gap-2 text-sm text-slate-300">
                                            <span>Priority</span>
                                            <select
                                              className="rounded-xl border border-white/10 bg-[#08111f] px-3 py-2 text-white outline-none"
                                              onChange={(event) =>
                                                setFormState((current) => ({
                                                  ...current,
                                                  priority: event.target.value as DemoSubmittedApp["priority"]
                                                }))
                                              }
                                              value={formState.priority}
                                            >
                                              <option>High</option>
                                              <option>Medium</option>
                                              <option>Low</option>
                                            </select>
                                          </label>
                                          <label className="grid gap-2 text-sm text-slate-300">
                                            <span>Notes</span>
                                            <textarea
                                              className="min-h-[88px] rounded-xl border border-white/10 bg-[#08111f] px-3 py-2 text-white outline-none placeholder:text-slate-500"
                                              onChange={(event) =>
                                                setFormState((current) => ({ ...current, notes: event.target.value }))
                                              }
                                              placeholder="Any compatibility notes or known SSO requirements"
                                              value={formState.notes}
                                            />
                                          </label>
                                        </div>
                                        <div className="flex flex-wrap gap-3">
                                          <Button onClick={submitApp}>Add SaaS application</Button>
                                          {submittedApps.length > 0 ? (
                                            <Button onClick={() => markTaskComplete(task.id)} variant="outline">
                                              Mark SaaS app step complete
                                            </Button>
                                          ) : null}
                                        </div>
                                      </div>
                                    ) : null}

                                    {isBookingTask(task) ? (
                                      <div className="flex flex-wrap gap-3">
                                        <a
                                          className={buttonVariants({ variant: "default" })}
                                          href={BOOKING_URL}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          Open Microsoft Bookings
                                        </a>
                                        <Button onClick={() => markTaskComplete(task.id)}>Mark meeting booked</Button>
                                      </div>
                                    ) : null}

                                    {isDocumentationTask(task) ? (
                                      <Button onClick={() => markTaskComplete(task.id)}>Mark documentation distributed</Button>
                                    ) : null}

                                    {!isBookingTask(task) &&
                                    !isDocumentationTask(task) &&
                                    !isAppSubmissionTask(task) &&
                                    !isKZeroOwnedTask(task) &&
                                    canMarkActiveTaskComplete(task) ? (
                                      <Button onClick={() => markTaskComplete(task.id)}>Mark complete</Button>
                                    ) : null}

                                    {isKZeroOwnedTask(task) ? (
                                      <Button variant="outline" onClick={() => markTaskComplete(task.id)}>
                                        Demo only: simulate KZero completion
                                      </Button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <aside className="grid gap-4 lg:col-span-4 lg:self-start lg:sticky lg:top-6">
            <Card className="border-white/10 bg-[#101a2d] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Workflow status</p>
                  <h3 className="mt-1 text-2xl font-semibold text-white">{currentOwnerState}</h3>
                </div>
                <Badge status={currentStatusBadge}>{formatLabel(currentStatusBadge)}</Badge>
              </div>
              <div className="mt-4 h-2 rounded-full bg-white/10">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-xl bg-[#0a1424] px-3 py-2">
                  <p className="text-slate-400">Done</p>
                  <p className="mt-1 font-semibold text-white">{completedCount}</p>
                </div>
                <div className="rounded-xl bg-[#0a1424] px-3 py-2">
                  <p className="text-slate-400">Current</p>
                  <p className="mt-1 font-semibold text-white">{currentTask ? 1 : 0}</p>
                </div>
                <div className="rounded-xl bg-[#0a1424] px-3 py-2">
                  <p className="text-slate-400">Apps</p>
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
                  <h3 className="text-lg font-semibold text-white">KZero contact</h3>
                  <p className="mt-1 text-sm text-slate-300">Your Sales Engineer for this onboarding plan.</p>
                </div>
              </div>
              <div className="mt-4 rounded-[1.2rem] border border-white/10 bg-[#0a1424] p-4">
                <p className="font-medium text-white">{kzeroContact?.name ?? "Morgan Lee"}</p>
                <p className="mt-1 text-sm text-slate-300">{kzeroContact?.email ?? "morgan@kzero.com"}</p>
                <a
                  className={`${buttonVariants({ variant: "outline" })} mt-4 w-full justify-center`}
                  href={BOOKING_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open Microsoft Bookings
                </a>
              </div>
            </Card>

            <Card className="border-white/10 bg-[#101a2d] p-4">
              <h3 className="text-lg font-semibold text-white">Submitted SaaS apps</h3>
              <p className="mt-1 text-sm text-slate-300">Applications added during this demo are saved in your browser.</p>
              <div className="mt-4 grid gap-3">
                {submittedApps.length === 0 ? (
                  <div className="rounded-[1.1rem] border border-dashed border-white/10 bg-[#0a1424] px-3.5 py-4 text-sm text-slate-400">
                    No SaaS apps submitted yet.
                  </div>
                ) : null}
                {submittedApps.map((app) => (
                  <div key={app.id} className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-white">{app.name}</p>
                      <span className="text-[11px] uppercase tracking-[0.2em] text-slate-300">{app.priority}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{app.loginUrl}</p>
                    {app.notes ? <p className="mt-2 text-sm text-slate-400">{app.notes}</p> : null}
                  </div>
                ))}
              </div>
            </Card>

            <Card className="border-white/10 bg-[#101a2d] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Plan docs</h3>
                  <p className="text-sm text-slate-300">Guides and placeholders tied to this rollout.</p>
                </div>
              </div>
              <div className="mt-4 grid gap-2.5">
                {bundle.attachments.map((attachment) => (
                  <div key={attachment.id} className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] px-3.5 py-3 text-sm text-white">
                    {attachment.name}
                  </div>
                ))}
              </div>
            </Card>

            <Card className="border-white/10 bg-[#101a2d] p-4">
              <h3 className="text-lg font-semibold text-white">Blockers and notes</h3>
              <div className="mt-4 grid gap-3">
                {bundle.comments.map((comment) => (
                  <div key={comment.id} className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-3.5 text-sm text-slate-300">
                    <p className="font-medium text-white">{comment.author}</p>
                    <p className="mt-2 leading-6">{comment.body}</p>
                  </div>
                ))}
              </div>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
