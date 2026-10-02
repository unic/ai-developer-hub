"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ErrorPopoverProps {
  errorMessage: string | null;
  /** The sync run's outcome, when the caller has one. */
  outcome?: string | null;
}

export function ErrorPopover({ errorMessage, outcome }: ErrorPopoverProps) {
  if (!errorMessage) return <span className="text-muted-foreground">-</span>;

  // Spec 045: the cost sync records non-fatal WARNINGS through the same field
  // — billed/computed divergence, spend in a workspace with no owner, a model
  // missing from the price table. The sync still succeeded; calling those
  // "errors" would train an admin to ignore the column.
  //
  // A run that ended `success` and still carries a message can only be
  // carrying warnings — errors would have made it partial or failed — so the
  // outcome is the reliable signal. The prefix is the fallback for callers
  // with no outcome to pass (the ingestion history, which never warns).
  const isWarning =
    outcome != null ? outcome === "success" : errorMessage.startsWith("Warning:");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="max-w-[200px] truncate text-xs text-muted-foreground text-left cursor-pointer hover:text-foreground transition-colors"
        >
          {errorMessage}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="max-h-60 overflow-y-auto">
          {isWarning && (
            <p className="mb-2 text-xs font-medium text-warning">
              Warning — the sync completed; this is something to look at, not a
              failure.
            </p>
          )}
          <p className="text-sm whitespace-pre-wrap break-words">
            {errorMessage}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
