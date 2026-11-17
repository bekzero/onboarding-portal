"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  ChevronDown,
  FileText,
  Home,
  KeyRound,
  LogOut,
  Menu,
  PlusCircle,
  Settings,
  UserRound,
  Workflow,
  X
} from "lucide-react";
import { signOutSharedAdmin, signOutStaff } from "@/app/admin/staff/actions";
import { KzeroLogo } from "@/components/kzero-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { StaffIdentityView } from "@/components/staff-identity-control";

type AdminDashboardHeaderProps = {
  onEnroll: () => void;
  onNotifications: () => void;
  onReports: () => void;
  staffIdentity: StaffIdentityView | null;
  unreadNotificationCount: number;
};

const navItemClass =
  "inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";

export function AdminDashboardHeader({
  onEnroll,
  onNotifications,
  onReports,
  staffIdentity,
  unreadNotificationCount
}: AdminDashboardHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (headerRef.current?.contains(event.target as Node)) return;
      setMobileMenuOpen(false);
      setProfileMenuOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const returnFocusTo = profileMenuOpen ? profileButtonRef.current : mobileMenuButtonRef.current;
      setMobileMenuOpen(false);
      setProfileMenuOpen(false);
      returnFocusTo?.focus();
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen, profileMenuOpen]);

  const displayName = staffIdentity?.name || staffIdentity?.email || "Shared administrator";
  const displayRole = staffIdentity?.role.replaceAll("_", " ") || "Shared access";
  const notificationLabel = unreadNotificationCount > 0
    ? `Open notifications, ${unreadNotificationCount} unread`
    : "Open notifications";

  function closeMenus() {
    setMobileMenuOpen(false);
    setProfileMenuOpen(false);
  }

  function openReports() {
    closeMenus();
    onReports();
  }

  function openNotifications() {
    closeMenus();
    onNotifications();
  }

  function openEnroll() {
    closeMenus();
    onEnroll();
  }

  return (
    <header
      className="relative overflow-visible rounded-2xl border border-[#20395f] bg-[#0b1730] text-white shadow-[0_18px_50px_rgba(2,8,23,0.24)]"
      ref={headerRef}
    >
      <div className="flex min-h-[72px] items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <KzeroLogo
            className="shrink-0"
            imageClassName="!w-[132px] ![filter:brightness(0)_invert(1)] sm:!w-[156px]"
          />
          <div className="min-w-0 border-l border-white/15 pl-3 sm:pl-4">
            <p className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-blue-200">KZero Portal</p>
            <h1 className="truncate text-base font-semibold tracking-tight text-white sm:text-lg">Sales Engineer Dashboard</h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label={notificationLabel}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 text-slate-100 transition hover:border-white/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            onClick={openNotifications}
            type="button"
          >
            <Bell aria-hidden="true" className="h-4 w-4" />
            {unreadNotificationCount > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white ring-2 ring-[#0b1730]">
                {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
              </span>
            ) : null}
          </button>

          <div className="relative">
            <button
              aria-controls="admin-profile-menu"
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              className="flex h-10 items-center gap-2 rounded-xl border border-white/15 px-2 text-left transition hover:border-white/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:px-3"
              onClick={() => {
                setProfileMenuOpen((open) => !open);
                setMobileMenuOpen(false);
              }}
              ref={profileButtonRef}
              type="button"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/20 text-blue-100">
                <UserRound aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block max-w-36 truncate text-xs font-semibold text-white">{displayName}</span>
                <span className="block text-[10px] uppercase tracking-[0.12em] text-slate-300">{displayRole}</span>
              </span>
              <ChevronDown aria-hidden="true" className="hidden h-4 w-4 text-slate-300 sm:block" />
            </button>

            {profileMenuOpen ? (
              <div
                aria-label="User profile menu"
                className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-surface p-2 text-foreground shadow-2xl"
                id="admin-profile-menu"
                role="group"
              >
                <div className="border-b border-border px-3 py-2.5">
                  <p className="truncate text-sm font-semibold">{displayName}</p>
                  <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.12em] text-muted">{displayRole}</p>
                  {staffIdentity?.email && staffIdentity.email !== displayName ? (
                    <p className="mt-1 truncate text-xs text-secondary">{staffIdentity.email}</p>
                  ) : null}
                </div>
                <Link
                  className="mt-1 flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  href="/"
                  onClick={closeMenus}
                >
                  <Home aria-hidden="true" className="h-4 w-4" />
                  Back to Main Page
                </Link>
                {!staffIdentity ? (
                  <Link
                    className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    href="/admin/staff-login"
                    onClick={closeMenus}
                  >
                    <KeyRound aria-hidden="true" className="h-4 w-4" />
                    Staff sign in
                  </Link>
                ) : null}
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-1.5" role="group">
                  <span className="text-sm font-medium">Appearance</span>
                  <ThemeToggle className="h-9 w-9" />
                </div>
                <form action={staffIdentity ? signOutStaff : signOutSharedAdmin}>
                  <button
                    className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-danger transition hover:bg-danger-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    type="submit"
                  >
                    <LogOut aria-hidden="true" className="h-4 w-4" />
                    Logout
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 px-3 py-2.5 sm:px-5">
        <div className="hidden items-center justify-between gap-4 md:flex">
          <nav aria-label="Sales Engineer Dashboard navigation" className="flex min-w-0 items-center gap-1">
            <Link className={`${navItemClass} bg-white/10 text-white`} href="/admin" aria-current="page">Overview</Link>
            <button className={navItemClass} onClick={openReports} type="button"><FileText aria-hidden="true" className="mr-2 h-4 w-4" />Reports</button>
            <Link className={navItemClass} href="/admin/zoho"><Workflow aria-hidden="true" className="mr-2 h-4 w-4" />Zoho Automation</Link>
            <Link className={navItemClass} href="/admin/settings/sso"><Settings aria-hidden="true" className="mr-2 h-4 w-4" />Staff SSO</Link>
          </nav>
          <Button className="h-10 shrink-0 whitespace-nowrap rounded-xl px-4" onClick={openEnroll}>
            <PlusCircle aria-hidden="true" className="mr-2 h-4 w-4" />Enroll MSP
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 md:hidden">
          <button
            aria-controls="admin-mobile-navigation"
            aria-expanded={mobileMenuOpen}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            onClick={() => {
              setMobileMenuOpen((open) => !open);
              setProfileMenuOpen(false);
            }}
            ref={mobileMenuButtonRef}
            type="button"
          >
            {mobileMenuOpen ? <X aria-hidden="true" className="h-4 w-4" /> : <Menu aria-hidden="true" className="h-4 w-4" />}
            Menu
          </button>
          <Button className="h-10 whitespace-nowrap rounded-xl px-4" onClick={openEnroll}>
            <PlusCircle aria-hidden="true" className="mr-2 h-4 w-4" />Enroll MSP
          </Button>
        </div>

        {mobileMenuOpen ? (
          <nav
            aria-label="Mobile Sales Engineer Dashboard navigation"
            className="mt-2 grid gap-1 rounded-xl border border-white/10 bg-[#0f203e] p-2 md:hidden"
            id="admin-mobile-navigation"
          >
            <Link className={`${navItemClass} bg-white/10 text-white`} href="/admin" onClick={closeMenus} aria-current="page">Overview</Link>
            <button className={`${navItemClass} w-full`} onClick={openReports} type="button"><FileText aria-hidden="true" className="mr-2 h-4 w-4" />Reports</button>
            <Link className={navItemClass} href="/admin/zoho" onClick={closeMenus}><Workflow aria-hidden="true" className="mr-2 h-4 w-4" />Zoho Automation</Link>
            <Link className={navItemClass} href="/admin/settings/sso" onClick={closeMenus}><Settings aria-hidden="true" className="mr-2 h-4 w-4" />Staff SSO</Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
