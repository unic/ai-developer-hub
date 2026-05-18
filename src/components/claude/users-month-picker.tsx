"use client";

import { useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MonthPicker } from "@/components/profile/month-picker";

type UsersMonthPickerProps = {
  value: string;
  months: string[];
};

/**
 * Thin client wrapper around `MonthPicker` for `/claude/users`. The month
 * lives in the URL (`?month=YYYY-MM`) so the entire server-rendered page
 * re-fetches when changed — no client-side state to keep in sync with the
 * KPIs, chart, distribution, top-movers, or table.
 */
export function UsersMonthPicker({ value, months }: UsersMonthPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("month", next);
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <MonthPicker value={value} onChange={handleChange} months={months} />
      {isPending && (
        <span className="animate-pulse text-sm text-muted-foreground">
          Loading…
        </span>
      )}
    </div>
  );
}
