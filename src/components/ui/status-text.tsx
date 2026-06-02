"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Inline status text — the Nothing replacement for toast popups.
 *
 * Renders bracketed Space Mono status near the trigger: `[SAVED]`,
 * `[ERROR: …]`, `[SAVING…]`. Announces via aria-live so screen-reader users
 * still get feedback (toasts previously carried this). Pair with
 * `useInlineStatus` for transient set + auto-clear.
 */

export type InlineStatusKind = "idle" | "ok" | "error" | "info" | "pending";

export interface InlineStatusState {
  kind: InlineStatusKind;
  message: string;
}

const KIND_CLASS: Record<InlineStatusKind, string> = {
  idle: "text-muted-foreground",
  ok: "text-success",
  error: "text-destructive",
  info: "text-muted-foreground",
  pending: "text-muted-foreground",
};

export function StatusText({
  status,
  className,
}: {
  status: InlineStatusState;
  className?: string;
}) {
  const { kind, message } = status;
  // Reserve a live region even when idle so the announcement fires on change.
  return (
    <span
      role="status"
      aria-live={kind === "error" ? "assertive" : "polite"}
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-xs tracking-[0.06em] uppercase",
        KIND_CLASS[kind],
        className
      )}
    >
      {kind === "pending" ? (
        <span className="nd-seg-spinner" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {kind !== "idle" && message ? <span>[{message}]</span> : null}
    </span>
  );
}

export interface UseInlineStatusReturn {
  status: InlineStatusState;
  set: (
    kind: InlineStatusKind,
    message: string,
    opts?: { autoClearMs?: number }
  ) => void;
  ok: (message?: string) => void;
  error: (message?: string) => void;
  info: (message: string) => void;
  pending: (message?: string) => void;
  clear: () => void;
}

/**
 * Transient inline status with auto-clear. Success/info clear after
 * `autoClearMs`; errors linger longer; `pending` never auto-clears (caller
 * resolves it). Cleans its timer on unmount.
 */
export function useInlineStatus(autoClearMs = 4000): UseInlineStatusReturn {
  const [status, setStatus] = React.useState<InlineStatusState>({
    kind: "idle",
    message: "",
  });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const set = React.useCallback(
    (kind: InlineStatusKind, message: string, opts?: { autoClearMs?: number }) => {
      clearTimer();
      setStatus({ kind, message });
      const ms = opts?.autoClearMs ?? autoClearMs;
      if (kind !== "pending" && kind !== "idle" && ms > 0) {
        timer.current = setTimeout(
          () => setStatus({ kind: "idle", message: "" }),
          ms
        );
      }
    },
    [autoClearMs, clearTimer]
  );

  const ok = React.useCallback((message = "SAVED") => set("ok", message), [set]);
  const error = React.useCallback(
    (message = "ERROR") => set("error", message, { autoClearMs: 8000 }),
    [set]
  );
  const info = React.useCallback((message: string) => set("info", message), [set]);
  const pending = React.useCallback(
    (message = "WORKING…") => set("pending", message),
    [set]
  );
  const clear = React.useCallback(() => {
    clearTimer();
    setStatus({ kind: "idle", message: "" });
  }, [clearTimer]);

  React.useEffect(() => clearTimer, [clearTimer]);

  // Stable return identity (the methods are already useCallback'd, so this only
  // changes when `status` changes). Without this, the fresh object literal each
  // render makes consumers that list the hook result in a useCallback/useEffect
  // dependency array churn every render — which can spin into an infinite loop.
  return React.useMemo(
    () => ({ status, set, ok, error, info, pending, clear }),
    [status, set, ok, error, info, pending, clear]
  );
}
