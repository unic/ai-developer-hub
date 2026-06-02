"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", href: "/copilot" },
  { label: "Seats", href: "/copilot/seats" },
  { label: "Billing", href: "/copilot/billing" },
  { label: "Analytics", href: "/copilot/analytics" },
];

export function CopilotTabBar() {
  const pathname = usePathname();

  return (
    <div
      className="flex gap-1 border-b overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Copilot sections"
    >
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/copilot"
            ? pathname === "/copilot"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={isActive}
            className={cn(
              "shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
