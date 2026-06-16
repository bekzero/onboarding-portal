import Link from "next/link";
import { ArrowRight, Building2, Clock3, Filter, Gauge, TimerReset } from "lucide-react";
import { PortalShell } from "@/components/portal-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireInternalUser } from "@/lib/auth";
import { onboardingCases } from "@/lib/mock-data";

const filterChips = [
  "All",
  "Waiting on MSP",
  "Waiting on KZero",
  "In progress",
  "Complete"
];

function formatStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export default async function InternalPage() {
  await requireInternalUser();

  const waitingOnMsp = onboardingCases.filter((item) => item.status === "waiting_on_msp").length;
  const waitingOnKZero = onboardingCases.filter((item) => item.status === "waiting_on_kzero").length;
  const averageProgress =
    onboardingCases.length === 0
      ? 0
      : Math.round(onboardingCases.reduce((total, item) => total + item.progress, 0) / onboardingCases.length);

  return (
    <PortalShell title="Sales Engineer Dashboard" eyebrow="Internal">
      <main className="grid gap-6">
        <section className="grid gap-6 md:grid-cols-4">
          <Card className="border-white/10 bg-[#101a2d]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Total onboarding cases</p>
                <p className="mt-1 text-3xl font-semibold text-white">{onboardingCases.length}</p>
              </div>
            </div>
          </Card>
          <Card className="border-white/10 bg-[#101a2d]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-400/15 text-blue-200">
                <TimerReset className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Waiting on MSP</p>
                <p className="mt-1 text-3xl font-semibold text-white">{waitingOnMsp}</p>
              </div>
            </div>
          </Card>
          <Card className="border-white/10 bg-[#101a2d]">
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
          <Card className="border-white/10 bg-[#101a2d]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-200">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Average progress</p>
                <p className="mt-1 text-3xl font-semibold text-white">{averageProgress}%</p>
              </div>
            </div>
          </Card>
        </section>

        <Card className="border-white/10 bg-[#101a2d]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">MSP onboarding cases</h2>
              <p className="mt-1 text-sm text-slate-300">Monitor onboarding progress, owner state, and sales engineer coverage.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {filterChips.map((chip) => (
                <Badge key={chip}>
                  {chip}
                </Badge>
              ))}
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0a1424]">
            <div className="hidden grid-cols-[1.4fr_1fr_1.1fr_0.9fr_1fr_0.8fr_1fr_1fr_0.8fr] gap-3 border-b border-white/10 px-5 py-4 text-xs uppercase tracking-[0.22em] text-slate-400 lg:grid">
              <span>MSP</span>
              <span>Tenant</span>
              <span>Current stage</span>
              <span>Progress</span>
              <span>Owner / waiting on</span>
              <span>Submitted apps</span>
              <span>Sales Engineer</span>
              <span>Last activity</span>
              <span>Action</span>
            </div>

            <div className="grid">
              {onboardingCases.map((item) => (
                <div
                  key={item.planId}
                  className="grid gap-4 border-b border-white/10 px-5 py-4 last:border-b-0 lg:grid-cols-[1.4fr_1fr_1.1fr_0.9fr_1fr_0.8fr_1fr_1fr_0.8fr] lg:items-center"
                >
                  <div>
                    <p className="font-medium text-white">{item.mspName}</p>
                    <p className="mt-1 text-sm text-slate-400 lg:hidden">Tenant: {item.tenantSlug}</p>
                  </div>
                  <p className="hidden text-sm text-slate-300 lg:block">{item.tenantSlug}</p>
                  <div>
                    <p className="text-sm text-slate-300">{item.currentStage}</p>
                    <p className="mt-1 text-sm text-slate-400 lg:hidden">Last activity: {item.lastActivity}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{item.progress}%</p>
                    <div className="mt-2 h-2 rounded-full bg-white/10">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge status={item.status}>{formatStatusLabel(item.status)}</Badge>
                  </div>
                  <p className="text-sm text-slate-300">{item.submittedSaasAppCount}</p>
                  <p className="text-sm text-slate-300">{item.salesEngineer}</p>
                  <p className="hidden text-sm text-slate-300 lg:block">{item.lastActivity}</p>
                  <Link
                    href={item.actionHref}
                    className="inline-flex items-center gap-2 text-sm font-medium text-blue-200 transition-colors hover:text-blue-100"
                  >
                    Open demo
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="border-white/10 bg-[#101a2d]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Filter className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Reporting note</h3>
              <p className="mt-1 text-sm text-slate-300">
                Filter chips are static UI for now. They are ready to become interactive once live onboarding data is wired in.
              </p>
            </div>
          </div>
        </Card>
      </main>
    </PortalShell>
  );
}
