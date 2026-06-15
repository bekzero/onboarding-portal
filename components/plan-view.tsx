import { ArrowRight, CalendarDays, CircleAlert, Clock3, FileText, ListChecks } from "lucide-react";
import { PortalShell } from "@/components/portal-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PlanBundle } from "@/lib/mock-data";

export function PlanView({
  bundle,
  demoMode = false
}: {
  bundle: PlanBundle;
  demoMode?: boolean;
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

  return (
    <PortalShell title={bundle.organization.name} eyebrow={`${bundle.plan.tenantType.toUpperCase()} plan`}>
      <main className="grid gap-6">
        {demoMode ? (
          <div className="rounded-full border border-blue-300/20 bg-blue-400/10 px-4 py-2 text-center text-sm text-blue-100">
            Demo mode - mock onboarding data
          </div>
        ) : null}

        <Card className="overflow-hidden border-white/10 bg-transparent p-0">
          <div className="rounded-[1.9rem] bg-[linear-gradient(135deg,#1f3771_0%,#0d1931_48%,#050811_100%)] px-6 py-8 md:px-8 md:py-10">
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div className="space-y-4">
                <p className="text-sm uppercase tracking-[0.28em] text-blue-100/80">{bundle.plan.title}</p>
                <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-white md:text-5xl">
                  Shared onboarding plan for your KZero passwordless rollout.
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-blue-100/75 md:text-base">
                  Follow the checklist, see what KZero owns next, and keep the MSP-to-customer rollout moving in one place.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.24em] text-blue-100/65">Progress</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{bundle.plan.progress}%</p>
                  <div className="mt-4 h-2.5 rounded-full bg-white/10">
                    <div
                      className="h-2.5 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                      style={{ width: `${bundle.plan.progress}%` }}
                    />
                  </div>
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.24em] text-blue-100/65">Active</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{activeTasks}</p>
                  <p className="mt-2 text-sm text-blue-100/70">Tasks currently moving or waiting on your team</p>
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.24em] text-blue-100/65">Waiting on KZero</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{waitingOnKZeroTasks}</p>
                  <p className="mt-2 text-sm text-blue-100/70">Review and plan work owned by your Sales Engineer</p>
                </div>
              </div>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              {bundle.phases.map((phase) => (
                <div
                  key={phase.id}
                  className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-blue-50/88"
                >
                  {phase.order}. {phase.title}
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="grid gap-6">
            <Card className="border-slate-200/10 bg-[#0d1729]">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <p className="text-sm uppercase tracking-[0.22em] text-blue-200">Current next step</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge status={nextTask.status}>{nextTask.status.replaceAll("_", " ")}</Badge>
                    <Badge>{nextTask.owner}</Badge>
                    {safeNextStepPhase ? <Badge>{safeNextStepPhase.title}</Badge> : null}
                  </div>
                  <h3 className="text-2xl font-semibold text-white md:text-3xl">{nextTask.title}</h3>
                  <p className="max-w-2xl text-sm leading-7 text-slate-300">{nextTask.description}</p>
                </div>
                <div className="min-w-full rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4 lg:min-w-[260px]">
                  <p className="text-sm font-medium text-white">Plan summary</p>
                  <div className="mt-4 grid gap-3 text-sm text-slate-300">
                    <div className="flex items-center justify-between">
                      <span>Completed tasks</span>
                      <span className="font-semibold text-white">{completedTasks}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Remaining tasks</span>
                      <span className="font-semibold text-white">{bundle.tasks.length - completedTasks}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Current phase</span>
                      <span className="font-semibold text-white">{safeNextStepPhase?.title ?? "Kickoff"}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                {nextTask.meetingCta ? <Button>{nextTask.meetingCta}</Button> : null}
                <Button variant="outline">Microsoft Bookings placeholder</Button>
              </div>
            </Card>

            {waitingOnKZeroTasks > 0 ? (
              <Card className="border-amber-400/25 bg-[linear-gradient(135deg,rgba(59,130,246,0.08),rgba(245,158,11,0.08))]">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-200">
                      <Clock3 className="h-5 w-5" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm uppercase tracking-[0.22em] text-amber-200">Waiting on KZero</p>
                      <h3 className="text-xl font-semibold text-white">Compatibility review is in progress.</h3>
                      <p className="max-w-2xl text-sm leading-6 text-slate-300">
                        Your Sales Engineer is reviewing submitted SaaS applications and preparing the onboarding plan. We&apos;ll keep the task visible here until the review is ready.
                      </p>
                    </div>
                  </div>
                  <Badge status="waiting_on_kzero">waiting on kzero</Badge>
                </div>
              </Card>
            ) : null}

            <Card className="border-slate-200/10 bg-[#0d1729]">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <ListChecks className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Phase checklist</h3>
                  <p className="text-sm text-slate-300">Track task ownership, status, and the next action in each phase.</p>
                </div>
              </div>
              <div className="grid gap-5">
                {phaseTasks.map(({ phase, tasks }, index) => (
                  <div key={phase.id} className="rounded-[1.7rem] border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                            {index + 1}
                          </div>
                          <div>
                            <h4 className="text-lg font-semibold text-white">{phase.title}</h4>
                            <p className="text-sm text-slate-300">{phase.description}</p>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-slate-400">{tasks.length} tasks</p>
                    </div>

                    <div className="mt-5 grid gap-3">
                      {tasks.map((task) => (
                        <div key={task.id} className="rounded-[1.4rem] border border-white/10 bg-[#08111f] p-4">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-3">
                              <div className="flex flex-wrap gap-2">
                                <Badge status={task.status}>{task.status.replaceAll("_", " ")}</Badge>
                                <Badge>{task.owner}</Badge>
                                {task.waitingOn ? (
                                  <Badge>{task.waitingOn === "msp" ? "Waiting on MSP" : "Waiting on KZero"}</Badge>
                                ) : null}
                              </div>
                              <div className="space-y-2">
                                <h5 className="text-base font-semibold text-white">{task.title}</h5>
                                <p className="text-sm leading-6 text-slate-300">{task.description}</p>
                              </div>
                            </div>
                            <div className="flex min-w-[180px] flex-col gap-3 text-sm text-slate-300">
                              {task.dueLabel ? (
                                <div className="flex items-center gap-2">
                                  <CalendarDays className="h-4 w-4 text-blue-200" />
                                  <span>{task.dueLabel}</span>
                                </div>
                              ) : null}
                              {task.waitingOn ? (
                                <div className="flex items-center gap-2">
                                  <CircleAlert className="h-4 w-4 text-amber-200" />
                                  <span>{task.waitingOn === "msp" ? "Action needed from MSP" : "Action needed from KZero"}</span>
                                </div>
                              ) : null}
                              {task.meetingCta ? (
                                <Button variant="secondary" className="justify-between">
                                  {task.meetingCta}
                                  <ArrowRight className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <aside className="grid gap-6">
            <Card className="border-slate-200/10 bg-[#0d1729]">
              <h3 className="text-lg font-semibold text-white">SaaS app submissions</h3>
              <p className="mt-1 text-sm text-slate-300">Submitted apps stay visible while KZero validates SSO readiness.</p>
              <div className="mt-4 grid gap-3">
                {bundle.apps.map((app) => (
                  <div key={app.id} className="rounded-[1.35rem] border border-white/10 bg-[#08111f] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{app.name}</p>
                        <p className="mt-1 text-sm text-slate-300">Compatibility review queue</p>
                      </div>
                      <Badge>{app.status.replaceAll("_", " ")}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="border-slate-200/10 bg-[#0d1729]">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Onboarding plan review</h3>
                  <p className="text-sm text-slate-300">Placeholders for KZero-delivered planning artifacts.</p>
                </div>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                {bundle.attachments.map((attachment) => (
                  <div key={attachment.id} className="rounded-[1.35rem] border border-white/10 bg-[#08111f] p-4">
                    {attachment.name}
                  </div>
                ))}
                <Button variant="outline" className="w-full justify-center">
                  Plan upload placeholder
                </Button>
              </div>
            </Card>

            <Card className="border-slate-200/10 bg-[#0d1729]">
              <h3 className="text-lg font-semibold text-white">Blockers and notes</h3>
              <div className="mt-4 grid gap-3">
                {bundle.comments.map((comment) => (
                  <div key={comment.id} className="rounded-[1.35rem] border border-white/10 bg-[#08111f] p-4 text-sm text-slate-300">
                    <p className="font-medium text-white">{comment.author}</p>
                    <p className="mt-2 leading-6">{comment.body}</p>
                  </div>
                ))}
              </div>
            </Card>
          </aside>
        </div>
      </main>
    </PortalShell>
  );
}
