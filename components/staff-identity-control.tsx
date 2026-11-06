"use client";

import { signOutStaff } from "@/app/admin/staff/actions";
import { Button } from "@/components/ui/button";

export type StaffIdentityView = { email: string | null; name: string | null; role: "ADMIN" | "SALES_ENGINEER" | "VIEWER" };

export function StaffIdentityControl({ identity }: { identity: StaffIdentityView | null }) {
  if (!identity) return <a className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-primary hover:underline" href="/admin/staff-login">Staff sign in</a>;
  return <div className="flex items-center gap-2 rounded-xl border border-border bg-input px-3 py-1.5"><div className="min-w-0"><p className="max-w-44 truncate text-xs font-medium text-foreground">{identity.name || identity.email || "KZero staff"}</p><p className="text-[10px] uppercase tracking-[0.12em] text-muted">{identity.role.replace("_", " ")}</p></div><form action={signOutStaff}><Button className="h-8 px-2.5 text-xs" type="submit" variant="outline">Logout</Button></form></div>;
}
