"use client";

import { useEffect, useState } from "react";
import { KzeroLogo } from "@/components/kzero-logo";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const ADMIN_SESSION_UNAVAILABLE_MESSAGE =
  "Admin session unavailable. Open the dashboard in a new tab or sign in again.";

export function AdminSessionUnavailable() {
  const [isEmbedded, setIsEmbedded] = useState<boolean | null>(null);

  useEffect(() => {
    const embedded = window.self !== window.top;
    setIsEmbedded(embedded);

    if (!embedded) {
      window.location.replace("/admin-login");
    }
  }, []);

  if (isEmbedded === null || !isEmbedded) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-8">
        <p className="text-sm text-slate-300">Checking admin session...</p>
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-8">
      <Card className="w-full border-amber-400/20 bg-[#101a2d] px-6 py-7">
        <KzeroLogo className="w-fit" imageClassName="h-auto w-[176px]" surface="dark" />
        <h1 className="mt-6 text-2xl font-semibold text-white">
          Zoho embedded view could not access the admin session.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-200">{ADMIN_SESSION_UNAVAILABLE_MESSAGE}</p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Some browsers block third-party cookies in embedded apps. Opening the dashboard in a new tab uses the normal
          first-party session.
        </p>
        <div className="mt-6">
          <a className={buttonVariants()} href="/admin" rel="noopener noreferrer" target="_blank">
            Open Dashboard in New Tab
          </a>
        </div>
      </Card>
    </main>
  );
}
