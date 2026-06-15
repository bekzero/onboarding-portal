import { PortalShell } from "@/components/portal-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireInternalUser } from "@/lib/auth";
import { organizations, plans, saasApps, tasks } from "@/lib/mock-data";

export default async function InternalPage() {
  await requireInternalUser();

  const waitingOnKZero = tasks.filter((task) => task.status === "waiting_on_kzero");
  const customerRollouts = plans.filter((plan) => plan.tenantType === "customer");

  return (
    <PortalShell title="Sales Engineer Dashboard" eyebrow="Internal">
      <main className="grid gap-6">
        <section className="grid gap-6 md:grid-cols-4">
          <Card>
            <p className="text-sm text-muted">Active onboarding plans</p>
            <p className="mt-3 text-3xl font-semibold text-white">{plans.length}</p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Tasks waiting on KZero</p>
            <p className="mt-3 text-3xl font-semibold text-white">{waitingOnKZero.length}</p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Apps submitted for review</p>
            <p className="mt-3 text-3xl font-semibold text-white">{saasApps.length}</p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Customer rollouts</p>
            <p className="mt-3 text-3xl font-semibold text-white">{customerRollouts.length}</p>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Active plans</h2>
                <p className="mt-1 text-sm text-muted">Static filters only for the initial skeleton.</p>
              </div>
              <div className="flex gap-2">
                <Badge>All tenants</Badge>
                <Badge>Waiting on KZero</Badge>
              </div>
            </div>
            <div className="mt-5 grid gap-4">
              {plans.map((plan) => {
                const org = organizations.find((item) => item.id === plan.organizationId);
                return (
                  <div key={plan.id} className="rounded-[1.5rem] border border-border bg-[#091321] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-lg font-medium text-white">{plan.title}</p>
                        <p className="mt-1 text-sm text-muted">{org?.name}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge>{plan.tenantType}</Badge>
                        <Badge status={plan.progress > 10 ? "in_progress" : "not_started"}>
                          {plan.progress}% complete
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="grid gap-6">
            <Card>
              <h2 className="text-xl font-semibold text-white">SaaS apps submitted</h2>
              <div className="mt-5 grid gap-3">
                {saasApps.map((app) => (
                  <div key={app.id} className="rounded-2xl border border-border bg-[#091321] p-4">
                    <p className="font-medium text-white">{app.name}</p>
                    <p className="mt-1 text-sm text-muted">Status: {app.status.replaceAll("_", " ")}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="text-xl font-semibold text-white">Plan upload placeholder</h2>
              <p className="mt-4 text-sm leading-6 text-muted">
                Reserve this panel for the KZero implementation plan once uploads and persistence are added.
              </p>
            </Card>

            <Card>
              <h2 className="text-xl font-semibold text-white">Customer rollout status</h2>
              <div className="mt-4 grid gap-3">
                {customerRollouts.map((plan) => (
                  <div key={plan.id} className="rounded-2xl border border-border bg-[#091321] p-4">
                    <p className="font-medium text-white">{plan.title}</p>
                    <p className="mt-1 text-sm text-muted">{plan.progress}% complete</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </section>
      </main>
    </PortalShell>
  );
}
