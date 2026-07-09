"use client";

// Copy-to-clipboard for license-request messages (032-v2): the Hub no longer
// posts to Teams — the admin copies the rendered markdown and pastes it into
// the request's Teams thread / group chat themselves.

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopySnippetButton({
  getTextAction,
  label = "Copy message",
  size = "sm",
  variant = "outline",
}: {
  /** Returns the text to copy — async so callers can decrypt on demand. */
  getTextAction: () => string | Promise<string>;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function handleCopy() {
    try {
      const text = await getTextAction();
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("error");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <Button type="button" size={size} variant={variant} onClick={handleCopy}>
      {state === "copied" ? (
        <>
          <Check className="size-3.5" /> Copied
        </>
      ) : state === "error" ? (
        "Copy failed"
      ) : (
        <>
          <Copy className="size-3.5" /> {label}
        </>
      )}
    </Button>
  );
}
