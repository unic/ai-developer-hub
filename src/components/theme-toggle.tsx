"use client";

import { useEffect, useState } from "react";
import { useThemePreference } from "@/hooks/use-theme-preference";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
] as const;

// Nothing segmented theme toggle wired to next-themes (via useThemePreference,
// which persists to the DB). Three states retained: light / dark / system.
export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useThemePreference();

  useEffect(() => setMounted(true), []);

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center rounded-full border border-input p-0.5",
        className
      )}
    >
      {OPTIONS.map((opt) => {
        const active = mounted && theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            aria-pressed={active}
            className={cn(
              "rounded-full px-3 py-1.5 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
