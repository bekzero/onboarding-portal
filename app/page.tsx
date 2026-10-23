import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { KzeroLogo } from "@/components/kzero-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const onboardingSteps = [
  {
    number: "01",
    title: "Kickoff",
    body: "Meet with your KZero Passwordless Sales Engineer to begin onboarding."
  },
  {
    number: "02",
    title: "Tenant Setup",
    body: "Import your passwords, configure administrators, and prepare your MSP team."
  },
  {
    number: "03",
    title: "First Customer Pilot",
    body: "Apply your onboarding plan to your first customer deployment."
  }
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface/90">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 md:px-10">
          <KzeroLogo className="shrink-0" imageClassName="w-[168px] sm:w-[180px]" priority />
          <Link
            className="rounded-lg px-2 py-2 text-sm font-medium text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            href="/admin-login"
          >
            Admin Sign In
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 md:px-10 md:py-10">
        <section className="rounded-3xl border border-border bg-surface px-6 py-9 shadow-panel sm:px-8 sm:py-11 md:px-10 md:py-12">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-info">
              Your Onboarding Workspace
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Welcome to KZero Passwordless
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-secondary sm:text-lg sm:leading-8">
              Set up your MSP environment, review applications for SSO, and prepare for your first customer rollout — all in one place.
            </p>

            <div className="mt-7">
              <Link className="inline-flex" href="/start">
                <Button className="h-12 whitespace-nowrap rounded-xl px-5">
                  Start Onboarding
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              </Link>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
                Have your MSP or tenant name ready to access your onboarding plan.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-8" aria-labelledby="journey-heading">
          <h2 id="journey-heading" className="text-2xl font-semibold tracking-tight text-foreground">
            Your Onboarding Journey
          </h2>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {onboardingSteps.map((step) => (
              <Card
                key={step.number}
                className="h-full border-border bg-surface p-5 shadow-none sm:p-6"
              >
                <p className="text-xs font-semibold tracking-[0.16em] text-info">{step.number}</p>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-secondary">{step.body}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
