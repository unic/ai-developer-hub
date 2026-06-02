import { cn } from "@/lib/utils";

/**
 * Nothing loading indicator — replaces skeleton shimmer. A hardware-style
 * segmented spinner + bracketed `[LOADING…]` mono text. Used in route
 * `loading.tsx` files and inline async regions.
 */
export function LoadingState({
  label = "LOADING",
  className,
  inline = false,
}: {
  label?: string;
  className?: string;
  inline?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        inline
          ? "inline-flex items-center gap-3"
          : "flex min-h-[40vh] flex-col items-center justify-center gap-4",
        className
      )}
    >
      <span className="nd-seg-spinner" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="font-mono text-xs tracking-[0.1em] uppercase text-muted-foreground">
        [{label}…]
      </span>
    </div>
  );
}

/** Compact inline spinner without text, for buttons / tight rows. */
export function InlineSpinner({ className }: { className?: string }) {
  return (
    <span className={cn("nd-seg-spinner", className)} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
