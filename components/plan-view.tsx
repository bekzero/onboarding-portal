import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  Clock3,
  ListChecks,
  Mail,
  ShieldCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DocumentsReviewCard } from "@/components/documents-review-card";
import type { PlanBundle } from "@/lib/mock-data";
import { users } from "@/lib/mock-data";

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
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

export function PlanView({
  bundle
}: {
  bundle: PlanBundle;
}) {
  const nextTask = bundle.nextTask;
  const completedTasks = bundle.tasks.filter((task) => task.status === "complete").length;
  const waitingOnKZeroTasks = bundle.tasks.filter((task) => task.status === "waiting_on_kzero").length;
  const activeTasks = bundle.tasks.filter((task) => ["in_progress", "waiting_on_msp"].includes(task.status)).length;
  const safeNextStepPhase = bundle.phases.find((phase) => phase.id === nextTask.phaseId);
  const phaseTasks = bundle.phases.map((phase) => ({
    phase,
    tasks: bundle.tasks.filter((task) => task.phaseId === phase.id)
  }));
  const kzeroContact = users.find((user) => user.role === "sales_engineer");

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
                  Overview
                </Button>
              </Link>
              <Link href="/portal/northwind-nfr">
                <Button variant="secondary" className="h-9 px-4">
                  MSP Portal
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="mt-5 grid gap-5">
        <div className="grid gap-5 lg:grid-cols-12">
          <section className="grid gap-5 lg:col-span-8">
            <Card className="border-white/10 bg-[linear-gradient(135deg,#223c78_0%,#101c31_54%,#09111d_100%)] p-5 md:p-6">
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.26em] text-blue-100/80">
                  <span>{safeNextStepPhase?.title ?? "Kickoff"}</span>
                  <span className="text-slate-500">/</span>
                  <span>Next action</span>
                </div>
                <div className="grid gap-4 md:grid-cols-[1.4fr_0.6fr] md:items-start">
                  <div className="space-y-3">
                    <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-white md:text-[2.8rem]">
                      {nextTask.title}
                    </h2>
                    <p className="max-w-2xl text-sm leading-7 text-blue-100/78">{nextTask.description}</p>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-blue-100/78">
                      <span className="rounded-full bg-white/10 px-3 py-1">{formatLabel(nextTask.status)}</span>
                      <span>Owner: {nextTask.owner === "kzero_se" ? "KZero SE" : nextTask.owner.toUpperCase()}</span>
                      {nextTask.dueLabel ? <span>Due: {nextTask.dueLabel}</span> : null}
                    </div>
                  </div>
                  <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-[#0a1424]/70 p-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Done</p>
                        <p className="mt-1 text-2xl font-semibold text-white">{completedTasks}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Active</p>
                        <p className="mt-1 text-2xl font-semibold text-white">{activeTasks}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">KZero</p>
                        <p className="mt-1 text-2xl font-semibold text-white">{waitingOnKZeroTasks}</p>
                      </div>
                    </div>
                    <div className="text-sm text-slate-300">
                      <p>Current phase</p>
                      <p className="mt-1 font-medium text-white">{safeNextStepPhase?.title ?? "Kickoff"}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button className="h-11 px-5">
                    {nextTask.meetingCta ?? "Open Microsoft Bookings"}
                  </Button>
                  <Button variant="outline" className="h-11 px-5">
                    View full checklist
                  </Button>
                </div>
              </div>
            </Card>

            {waitingOnKZeroTasks > 0 ? (
              <Card className="border-amber-400/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(59,130,246,0.06))] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-400/12 text-amber-200">
                      <Clock3 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-amber-200">Waiting on KZero</p>
                      <p className="mt-1 text-lg font-semibold text-white">Compatibility review is in progress.</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        Your Sales Engineer is reviewing submitted SaaS applications and preparing the onboarding plan.
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-amber-100/85">1 task currently owned by KZero</div>
                </div>
              </Card>
            ) : null}

            <Card className="border-white/10 bg-[#101a2d] p-5">
              <div className="mb-5 flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <ListChecks className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Phase checklist</h3>
                  <p className="text-sm text-slate-300">A tighter view of what happens next, who owns it, and where meetings are needed.</p>
                </div>
              </div>

              <div className="grid gap-4">
                {phaseTasks.map(({ phase, tasks }, index) => (
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
                          <p className="text-sm text-slate-400">{tasks.length} tasks</p>
                        </div>

                        <div className="mt-4 border-l border-white/10 pl-4">
                          <div className="grid gap-3">
                            {tasks.map((task) => (
                              <div key={task.id} className={`rounded-[1.2rem] border p-4 ${taskTone(task.status)}`}>
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                                      <span>{formatLabel(task.status)}</span>
                                      <span className="text-slate-600">/</span>
                                      <span>{task.owner === "kzero_se" ? "KZero SE" : task.owner.toUpperCase()}</span>
                                      {task.waitingOn ? (
                                        <>
                                          <span className="text-slate-600">/</span>
                                          <span>{task.waitingOn === "kzero" ? "Waiting on KZero" : "Waiting on MSP"}</span>
                                        </>
                                      ) : null}
                                    </div>
                                    <h5 className="mt-2 text-base font-semibold text-white">{task.title}</h5>
                                    <p className="mt-1 text-sm leading-6 text-slate-300">{task.description}</p>
                                  </div>

                                  <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                                    {task.dueLabel ? (
                                      <div className="flex items-center gap-2 text-sm text-slate-300">
                                        <CalendarDays className="h-4 w-4 text-blue-200" />
                                        <span>{task.dueLabel}</span>
                                      </div>
                                    ) : null}
                                    {task.waitingOn ? (
                                      <div className="flex items-center gap-2 text-sm text-amber-100/85">
                                        <CircleAlert className="h-4 w-4 text-amber-200" />
                                        <span>{task.waitingOn === "msp" ? "Action needed from MSP" : "Action needed from KZero"}</span>
                                      </div>
                                    ) : null}
                                    {task.meetingCta ? (
                                      <Button variant="secondary" className="h-10 px-4">
                                        {task.meetingCta}
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
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
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Progress</p>
                  <h3 className="mt-1 text-2xl font-semibold text-white">{bundle.plan.progress}% complete</h3>
                </div>
                <Badge status={nextTask.status}>{formatLabel(nextTask.status)}</Badge>
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
                  <p className="text-slate-400">Active</p>
                  <p className="mt-1 font-semibold text-white">{activeTasks}</p>
                </div>
                <div className="rounded-xl bg-[#0a1424] px-3 py-2">
                  <p className="text-slate-400">KZero</p>
                  <p className="mt-1 font-semibold text-white">{waitingOnKZeroTasks}</p>
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
                <p className="font-medium text-white">{kzeroContact?.name ?? "Ben Eakin"}</p>
                <p className="mt-1 text-sm text-slate-300">{kzeroContact?.email ?? "ben@kzero.com"}</p>
                <p className="mt-3 text-sm text-slate-300">Use Microsoft Bookings to schedule implementation help.</p>
              </div>
            </Card>

            <Card className="border-white/10 bg-[#101a2d] p-4">
              <h3 className="text-lg font-semibold text-white">SaaS app submissions</h3>
              <p className="mt-1 text-sm text-slate-300">Apps currently in the compatibility review queue.</p>
              <div className="mt-4 grid gap-3">
                {bundle.apps.map((app) => (
                  <div key={app.id} className="rounded-[1.1rem] border border-white/10 bg-[#0a1424] p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-white">{app.name}</p>
                      <span className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                        {formatLabel(app.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <DocumentsReviewCard attachments={bundle.attachments} planId={bundle.plan.id} />

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
