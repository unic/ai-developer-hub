"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ErrorPopoverProps {
  errorMessage: string | null;
}

export function ErrorPopover({ errorMessage }: ErrorPopoverProps) {
  if (!errorMessage) return <span className="text-muted-foreground">-</span>;

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
          <p className="text-sm whitespace-pre-wrap break-words">
            {errorMessage}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
