import Link from "next/link";
import { ArrowRight, CalendarDays, ShieldCheck, Users } from "lucide-react";
import { KzeroLogo } from "@/components/kzero-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const onboardingCards = [
  {
    title: "Book Your Kickoff",
    body: "Schedule the first session with your KZero Passwordless Sales Engineer.",
    icon: CalendarDays
  },
  {
    title: "Prepare Your NFR Tenant",
    body: "Add admins, invite users, and prepare your team for passwordless rollout.",
    icon: ShieldCheck
  },
  {
    title: "Launch Your First Customer Pilot",
    body: "Apply the validated onboarding process to your first customer tenant.",
    icon: Users
  }
];

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 md:px-10 md:py-8">
      <header className="rounded-[1.6rem] border border-white/10 bg-[#101a2d] px-5 py-4 shadow-panel md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <KzeroLogo className="w-fit shrink-0" imageClassName="h-auto w-[210px]" priority surface="dark" />
          <Link href="/admin-login">
            <Button className="h-10 px-4" variant="outline">
              Admin Sign In
            </Button>
          </Link>
        </div>
      </header>

      <main className="mt-5 grid gap-6">
        <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(64,109,191,0.35),transparent_34%),linear-gradient(135deg,#1d376d_0%,#111d32_54%,#09111d_100%)] p-0">
          <div className="grid gap-8 px-6 py-8 md:px-8 md:py-10 xl:grid-cols-[1.25fr_0.75fr] xl:items-center">
            <div className="space-y-5">
              <div className="inline-flex rounded-full border border-blue-200/15 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-blue-100/80">
                Guided Onboarding Workspace
              </div>
              <div className="space-y-4">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-5xl xl:text-[3.5rem]">
                  KZero Passwordless Onboarding Portal
                </h1>
                <p className="max-w-3xl text-base leading-7 text-blue-100/78 md:text-lg">
                  A guided workspace for MSP onboarding, NFR tenant setup, SaaS app review, and first customer rollout.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href="/start">
                  <Button className="h-11 px-5">
                    Start Onboarding
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <p className="text-sm leading-6 text-slate-300">
                  Enter the MSP or tenant name provided by your KZero Passwordless Sales Engineer.
                </p>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-[#0b1424]/88 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-white">Your Onboarding Workspace</p>
                  <p className="text-sm text-slate-300">Everything needed to move onboarding forward in one place.</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3">
                {[
                  "Follow your onboarding plan step by step.",
                  "Submit SaaS applications for KZero Passwordless review.",
                  "Access rollout guides, meetings, and implementation milestones."
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-sm leading-6 text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <section className="grid gap-6 md:grid-cols-3">
          {onboardingCards.map(({ title, body, icon: Icon }) => (
            <Card key={title} className="flex h-full flex-col justify-between border-white/10 bg-[#101a2d] p-5">
              <div className="space-y-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#0b1424] text-primary">
                  <Icon className="h-6 w-6" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-white">{title}</h2>
                  <p className="text-sm leading-6 text-slate-300">{body}</p>
                </div>
              </div>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}
