// Spec 045 — how a cost figure was produced, said in words.
//
// Deliberately quiet: `billed` gets NO badge, because it is the expected state
// and badging every figure on the page would be noise. Only the two cases a
// reader should treat differently are marked, and the marking is text (plus a
// title), never colour alone.

import type { AttributionMethodLabel } from "@/types";

const COPY: Record<
  Exclude<AttributionMethodLabel, "billed">,
  { label: string; title: string }
> = {
  apportioned: {
    label: "apportioned",
    title:
      "This workspace has more than one owner, so Anthropic's billed total for it is split between them in proportion to their measured usage. The parts add up to the workspace's bill exactly, but no single person's share is separately billed.",
  },
  estimated: {
    label: "estimate",
    title:
      "Derived from token counts and the Hub's price table, not from Anthropic's bill. Expected for the current UTC day, which Anthropic does not bill until it completes; on a completed day it means the cost report had no figure for this workspace.",
  },
  mixed: {
    label: "mixed",
    title:
      "This period combines Anthropic's billed cost for completed days with an estimate for the current day. The two are reported separately as well.",
  },
};

export function AttributionBadge({
  method,
  className = "",
}: {
  method: AttributionMethodLabel | null | undefined;
  className?: string;
}) {
  // `billed` is the expected state and carries no badge.
  if (!method || method === "billed") return null;

  const copy = COPY[method];
  if (!copy) return null;

  return (
    <span
      className={`inline-flex items-center rounded border border-dashed border-muted-foreground/60 bg-muted px-1.5 py-0 text-[10px] font-medium text-muted-foreground ${className}`}
      title={copy.title}
    >
      {copy.label}
    </span>
  );
}

/** One-line provenance for a figure, for captions and tooltips. */
export function attributionCaption(
  method: AttributionMethodLabel | null | undefined,
): string {
  switch (method) {
    case "billed":
      return "Anthropic's billed cost for this workspace.";
    case "apportioned":
      return "A share of a shared workspace's billed cost, split by measured usage.";
    case "estimated":
      return "Estimated from token counts — not Anthropic's billed figure.";
    case "mixed":
      return "Billed for completed days, estimated for today.";
    default:
      return "";
  }
}
