"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { signOut } from "next-auth/react";

import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";

type NavItem = {
  title: string;
  href: string;
  roles: UserRole[];
};

const navItems: NavItem[] = [
  { title: "Dashboard", href: "/", roles: ["admin", "viewer"] },
  { title: "Tools", href: "/tools", roles: ["admin", "viewer"] },
  { title: "Users", href: "/users", roles: ["admin"] },
  { title: "Assignments", href: "/assignments", roles: ["admin", "viewer"] },
  { title: "Requests", href: "/requests", roles: ["admin"] },
  { title: "Budget", href: "/budget", roles: ["admin"] },
  { title: "Reports", href: "/reports", roles: ["admin"] },
  { title: "Scenarios", href: "/scenarios", roles: ["admin"] },
  { title: "Copilot", href: "/copilot", roles: ["admin"] },
  { title: "Claude Console", href: "/claude", roles: ["admin"] },
  { title: "Invoices", href: "/invoices", roles: ["admin"] },
  {
    title: "Settings",
    href: "/settings/appearance",
    roles: ["admin", "viewer"],
  },
];

function initialsOf(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // Settings nav points at /settings/appearance; treat any /settings/* as active.
  if (href.startsWith("/settings")) return pathname.startsWith("/settings");
  return pathname === href || pathname.startsWith(href + "/");
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-2.5 rounded-full bg-destructive"
        aria-hidden="true"
      />
      <span className="font-mono text-sm tracking-[0.14em] uppercase text-ink">
        AI·HUB
      </span>
    </div>
  );
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-[4px] px-2 py-2.5 font-mono text-xs tracking-[0.1em] uppercase transition-colors",
              active
                ? "text-ink"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <span
                className="absolute -left-px top-1/2 h-[18px] w-0.5 -translate-y-1/2 bg-destructive"
                aria-hidden="true"
              />
            ) : null}
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}

function Footer({
  userName,
  userRole,
}: {
  userName: string | null;
  userRole: string | null;
}) {
  return (
    <div className="mt-auto flex flex-col gap-1 border-t border-border pt-6">
      <Link
        href="/profile"
        className="flex items-center gap-2 rounded-[4px] px-2 py-2 transition-colors hover:bg-accent"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-input font-mono text-xs text-foreground">
          {initialsOf(userName)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] text-foreground">
            {userName}
          </span>
          <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-muted-foreground capitalize">
            {userRole}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="rounded-[4px] px-2 py-2.5 text-left font-mono text-xs tracking-[0.1em] uppercase text-muted-foreground transition-colors hover:text-foreground"
      >
        Sign Out
      </button>
      <ThemeToggle className="mt-2 self-start" />
    </div>
  );
}

export function AppSidebar({
  userName,
  userRole,
}: {
  userName: string | null;
  userRole: string | null;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAuthenticated = userName !== null && userRole !== null;
  const items = isAuthenticated
    ? navItems.filter((item) => item.roles.includes(userRole as UserRole))
    : [];

  return (
    <>
      {/* Desktop fixed rail */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-sidebar px-6 py-8 md:flex">
        <div className="mb-12">
          <Brand />
        </div>
        {isAuthenticated ? (
          <>
            <NavLinks items={items} pathname={pathname} />
            <Footer userName={userName} userRole={userRole} />
          </>
        ) : (
          <Link
            href="/login"
            className="mt-auto rounded-full bg-primary px-6 py-3 text-center font-mono text-[13px] tracking-[0.06em] uppercase text-primary-foreground"
          >
            Sign In
          </Link>
        )}
      </aside>

      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-border bg-sidebar px-5 py-4 md:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="grid size-9 place-items-center rounded-[4px] text-foreground"
        >
          <Menu className="size-5" strokeWidth={1.5} />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/80"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[248px] max-w-[80%] flex-col border-r border-border bg-sidebar px-6 py-8">
            <div className="mb-8 flex items-center justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="grid size-9 place-items-center rounded-[4px] text-foreground"
              >
                <X className="size-5" strokeWidth={1.5} />
              </button>
            </div>
            {isAuthenticated ? (
              <>
                <NavLinks
                  items={items}
                  pathname={pathname}
                  onNavigate={() => setMobileOpen(false)}
                />
                <Footer userName={userName} userRole={userRole} />
              </>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
