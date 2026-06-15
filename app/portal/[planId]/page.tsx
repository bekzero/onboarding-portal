import { notFound } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePortalUser } from "@/lib/auth";
import { attachments, comments, getPlanBundle } from "@/lib/mock-data";

export default async function PortalPlanPage({
  params
}: {
  params: Promise<{ planId: string }>;
}) {
  await requirePortalUser();

  const { planId } = await params;
  const bundle = getPlanBundle(planId);

  if (!bundle || !bundle.organization || !bundle.nextTask) {
    notFound();
  }

  const phaseTasks = bundle.phases.map((phase) => ({
    phase,
    tasks: bundle.tasks.filter((task) => task.phaseId === phase.id)
  }));

  return (
    <PortalShell title={bundle.organization.name} eyebrow={`${bundle.plan.tenantType.toUpperCase()} plan`}>
      <main className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="grid gap-6">
          <Card>
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.22em] text-blue-200">{bundle.plan.title}</p>
                <h2 className="text-3xl font-semibold text-white">Current next step</h2>
                <p className="max-w-2xl text-sm leading-6 text-muted">{bundle.nextTask.description}</p>
              </div>
              <div className="w-full max-w-sm space-y-3 rounded-[1.5rem] border border-border bg-[#091321] p-4">
                <div className="flex items-center justify-between text-sm text-muted">
                  <span>Progress</span>
                  <span>{bundle.plan.progress}%</span>
                </div>
                <div className="h-3 rounded-full bg-white/10">
                  <div
                    className="h-3 rounded-full bg-primary"
                    style={{ width: `${bundle.plan.progress}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge status={bundle.nextTask.status}>{bundle.nextTask.status.replaceAll("_", " ")}</Badge>
                  <Badge>{bundle.nextTask.owner}</Badge>
                </div>
              </div>
            </div>
            {bundle.nextTask.meetingCta ? (
              <div className="mt-5">
                <Button>{bundle.nextTask.meetingCta}</Button>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="flex flex-wrap gap-3">
              {bundle.phases.map((phase) => (
                <div key={phase.id} className="rounded-full border border-border bg-white/5 px-4 py-2 text-sm text-muted">
                  {phase.order}. {phase.title}
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-6">
            {phaseTasks.map(({ phase, tasks }) => (
              <Card key={phase.id}>
                <div className="mb-5 space-y-2">
                  <h3 className="text-xl font-semibold text-white">{phase.title}</h3>
                  <p className="text-sm text-muted">{phase.description}</p>
                </div>
                <div className="grid gap-4">
                  {tasks.map((task) => (
                    <div key={task.id} className="rounded-[1.5rem] border border-border bg-[#091321] p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <Badge status={task.status}>{task.status.replaceAll("_", " ")}</Badge>
                            <Badge>{task.owner}</Badge>
                          </div>
                          <h4 className="text-lg font-medium text-white">{task.title}</h4>
                          <p className="text-sm leading-6 text-muted">{task.description}</p>
                        </div>
                        <div className="text-sm text-muted">
                          {task.dueLabel ? <p>Due: {task.dueLabel}</p> : null}
                          {task.waitingOn ? <p>Waiting on: {task.waitingOn === "msp" ? "MSP" : "KZero"}</p> : null}
                        </div>
                      </div>
                      {task.meetingCta ? (
                        <div className="mt-4">
                          <Button variant="secondary">{task.meetingCta}</Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>

        <aside className="grid gap-6">
          <Card>
            <h3 className="text-lg font-semibold text-white">SaaS app submissions</h3>
            <div className="mt-4 grid gap-3">
              {bundle.apps.map((app) => (
                <div key={app.id} className="rounded-2xl border border-border bg-[#091321] p-4">
                  <p className="font-medium text-white">{app.name}</p>
                  <p className="mt-1 text-sm text-muted">Status: {app.status.replaceAll("_", " ")}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold text-white">Onboarding plan review</h3>
            <div className="mt-4 space-y-3 text-sm text-muted">
              {attachments
                .filter((attachment) => bundle.plan.taskIds.includes(attachment.taskId))
                .map((attachment) => (
                  <div key={attachment.id} className="rounded-2xl border border-border bg-[#091321] p-4">
                    {attachment.name}
                  </div>
                ))}
              <p>Placeholder only until file upload and plan persistence are requested.</p>
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold text-white">Blockers and notes</h3>
            <div className="mt-4 grid gap-3">
              {comments
                .filter((comment) => bundle.plan.taskIds.includes(comment.taskId))
                .map((comment) => (
                  <div key={comment.id} className="rounded-2xl border border-border bg-[#091321] p-4 text-sm text-muted">
                    <p className="font-medium text-white">{comment.author}</p>
                    <p className="mt-2 leading-6">{comment.body}</p>
                  </div>
                ))}
            </div>
          </Card>
        </aside>
      </main>
    </PortalShell>
  );
}
