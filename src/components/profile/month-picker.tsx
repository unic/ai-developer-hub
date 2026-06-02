"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MonthPickerProps = {
  value: string; // "YYYY-MM"
  onChange: (month: string) => void;
  months: string[]; // Available months in "YYYY-MM" format, newest first
};

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

/**
 * Build the selectable month options, guaranteeing the selected `value` is
 * always present so the trigger never renders blank. On the 1st of a month the
 * data source may not yet contain the current month (no synced rows for day 0),
 * and a URL-supplied `?month=` can reference an arbitrary month. We dedupe and
 * re-sort newest-first ("YYYY-MM" sorts chronologically as a string) so an
 * injected value lands in its correct chronological position, not at the head.
 */
export function buildMonthOptions(value: string, months: string[]): string[] {
  return [...new Set([value, ...months])].sort().reverse();
}

export function MonthPicker({ value, onChange, months }: MonthPickerProps) {
  const options = buildMonthOptions(value, months);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-[200px]">
        <SelectValue placeholder="Select month" />
      </SelectTrigger>
      <SelectContent>
        {options.map((month) => (
          <SelectItem key={month} value={month}>
            {formatMonthLabel(month)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
