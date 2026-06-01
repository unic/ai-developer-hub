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

export function MonthPicker({ value, onChange, months }: MonthPickerProps) {
  // Always make the selected value selectable. On the 1st of a month the data
  // source may not yet contain the current month (no synced rows for day 0),
  // which would otherwise leave `value` with no matching SelectItem and render
  // a blank trigger. Prepend it when missing (newest-first ordering).
  const options = months.includes(value) ? months : [value, ...months];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[200px]">
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
