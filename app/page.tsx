import Link from "next/link";
import { ArrowRight, Building2, ClipboardList, ShieldCheck } from "lucide-react";
import { PortalShell } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { plans } from "@/lib/mock-data";

const cards = [
  {
    title: "MSP onboarding workspace",
    body: "Track shared next steps, task ownership, waiting states, and KZero meeting checkpoints.",
    href: `/portal/${plans[0].id}`,
    icon: ClipboardList
  },
  {
    title: "Internal Sales Engineer view",
    body: "See active onboarding plans, apps pending review, and customer rollout readiness.",
    href: "/internal",
    icon: Building2
  }
];

export default function HomePage() {
  return (
    <PortalShell title="KZero Onboarding Portal" eyebrow="Skeleton">
      <main className="grid gap-6">
        <Card className="overflow-hidden">
          <div className="grid gap-8 md:grid-cols-[1.4fr_0.8fr]">
            <div className="space-y-5">
              <span className="inline-flex rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
                KZero-owned references pending
              </span>
              <div className="space-y-3">
                <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-white">
                  Clean onboarding skeleton for MSP and customer passwordless rollouts.
                </h2>
                <p className="max-w-2xl text-base leading-7 text-muted">
                  This initial scaffold keeps the UI intentionally conservative until partners.kzero.com
                  screenshots, brand assets, or exported patterns are available.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href={`/portal/${plans[0].id}`}>
                  <Button>Open sample MSP plan</Button>
                </Link>
                <Link href="/docs/design-brief.md">
                  <Button variant="outline">Review design brief</Button>
                </Link>
              </div>
            </div>
            <div className="rounded-[1.75rem] border border-border bg-[#07101d] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Portal scope</p>
                  <p className="text-sm text-muted">Auth scaffold, mock data, protected routes</p>
                </div>
              </div>
              <div className="mt-6 space-y-4 text-sm text-muted">
                <p>Auth.js Keycloak integration is scaffolded with safe local mock fallbacks.</p>
                <p>The onboarding flow models the full 10-step MSP-to-customer rollout path.</p>
                <p>Visual polish is intentionally deferred pending KZero source assets.</p>
              </div>
            </div>
          </div>
        </Card>

        <section className="grid gap-6 md:grid-cols-2">
          {cards.map(({ title, body, href, icon: Icon }) => (
            <Card key={title} className="flex flex-col gap-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Icon className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-white">{title}</h3>
                <p className="text-sm leading-6 text-muted">{body}</p>
              </div>
              <Link href={href} className="mt-auto inline-flex items-center gap-2 text-sm font-medium text-blue-200">
                Explore
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Card>
          ))}
        </section>
      </main>
    </PortalShell>
  );
}
