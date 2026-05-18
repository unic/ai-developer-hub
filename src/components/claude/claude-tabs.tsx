"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Tab = {
  href: string;
  label: string;
};

const TABS: Tab[] = [
  { href: "/claude", label: "Workspaces" },
  { href: "/claude/users", label: "Users" },
];

/**
 * Tab strip rendered directly under the Claude Console page header. The
 * sub-page nav, not the sidebar, is what flips between the workspace and
 * user pivots of the same data — sidebar stays a single "Claude Console"
 * entry whose active state is prefix-matched against `/claude` already.
 */
export function ClaudeTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Claude Console sections"
      className="flex gap-2 border-b"
    >
      {TABS.map((tab) => {
        // Workspaces tab must NOT match `/claude/users` — exact match for
        // the bare `/claude`, prefix match otherwise.
        const isActive =
          tab.href === "/claude"
            ? pathname === "/claude" ||
              (pathname.startsWith("/claude/") &&
                !pathname.startsWith("/claude/users"))
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
