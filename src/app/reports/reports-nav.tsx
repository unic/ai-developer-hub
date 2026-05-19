"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", href: "/reports" },
  { label: "Budget", href: "/reports/budget" },
];

export function ReportsNav() {
  const pathname = usePathname();

  return (
    <div
      className="flex gap-1 border-b"
      role="tablist"
      aria-label="Reports sections"
    >
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/reports"
            ? pathname === "/reports"
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={isActive}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
