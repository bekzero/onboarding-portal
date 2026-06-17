import Link from "next/link";
import { CalendarDays, Rocket, ShieldCheck, Users } from "lucide-react";
import { KzeroLogo } from "@/components/kzero-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const onboardingCards = [
  {
    title: "Book Your Kickoff",
    body: "Schedule your first session with a KZero Sales Engineer and get your onboarding plan moving.",
    icon: CalendarDays
  },
  {
    title: "Prepare Your Tenant",
    body: "Set up admins, add users, and work through the steps needed for your MSP rollout.",
    icon: ShieldCheck
  },
  {
    title: "Roll Out to Customers",
    body: "Follow the same guided process for customer tenants once your NFR environment is ready.",
    icon: Users
  }
];

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 md:px-10">
      <div className="relative z-10 mb-4 flex justify-end">
        <Link
          href="/admin-login"
          className="inline-flex rounded-md text-sm text-slate-400 transition-colors hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          Admin
        </Link>
      </div>
      <main className="grid gap-6">
        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(135deg,#1e3a75_0%,#111d32_52%,#09111d_100%)] p-0">
          <div className="grid gap-8 px-6 py-8 md:px-8 md:py-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <KzeroLogo className="h-auto w-[220px]" priority />
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
                  Welcome to your KZero onboarding portal
                </h1>
                <p className="max-w-2xl text-base leading-7 text-blue-100/78">
                  Track your setup, book kickoff and SSO meetings, submit SaaS apps for review, and follow your rollout
                  plan from first deployment through customer onboarding.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/start">
                  <Button>Start Onboarding</Button>
                </Link>
                <Link href="/demo/abcmsp-nfr">
                  <Button variant="outline">View Setup Checklist</Button>
                </Link>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-[#0b1424]/80 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">What You Can Do Here</p>
                  <p className="text-sm text-slate-300">A guided view of your onboarding progress</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  Follow your onboarding plan and see the next step at a glance.
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  Keep app submissions, meetings, and rollout milestones in one place.
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  Reuse the process for customer tenants as you expand KZero deployment.
                </div>
              </div>
            </div>
          </div>
        </Card>

        <section className="grid gap-6 md:grid-cols-3">
          {onboardingCards.map(({ title, body, icon: Icon }) => (
            <Card key={title} className="flex flex-col gap-4 border-white/10 bg-[#101a2d]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Icon className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-white">{title}</h2>
                <p className="text-sm leading-6 text-slate-300">{body}</p>
              </div>
            </Card>
          ))}
        </section>

        <p className="text-center text-sm text-slate-400">KZero Passwordless onboarding</p>
      </main>
    </div>
  );
}
