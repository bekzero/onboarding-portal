import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PortalShell({
  title,
  eyebrow,
  children,
  showActions = true
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  showActions?: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 md:px-10">
      <header className="mb-10 flex flex-col gap-4 rounded-[2rem] border border-border bg-card/80 px-6 py-5 shadow-panel md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-200">{eyebrow}</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white">{title}</h1>
              <p className="text-sm text-muted">KZero Passwordless onboarding workspace</p>
            </div>
          </div>
        </div>
        {showActions ? (
          <div className="flex flex-wrap gap-3">
            <Link href="/">
              <Button variant="outline">Overview</Button>
            </Link>
            <Link href="/portal/northwind-nfr">
              <Button variant="secondary">MSP Portal</Button>
            </Link>
            <Link href="/admin">
              <Button>Admin Dashboard</Button>
            </Link>
          </div>
        ) : null}
      </header>
      {children}
    </div>
  );
}
