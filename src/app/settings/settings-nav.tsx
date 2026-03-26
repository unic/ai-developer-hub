"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const baseTabs = [
  { label: "Appearance", href: "/settings/appearance" },
];

const adminTabs = [
  { label: "Integrations", href: "/settings/integrations" },
  { label: "Sync Status", href: "/settings/sync" },
  { label: "API Preview", href: "/settings/api-preview" },
];

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = isAdmin ? [...baseTabs, ...adminTabs] : baseTabs;

  return (
    <nav className="flex gap-2 border-b" aria-label="Settings navigation">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            pathname === tab.href
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
