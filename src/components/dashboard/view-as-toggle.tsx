import Link from "next/link";
import { Eye, ArrowLeft } from "lucide-react";

interface ViewAsToggleProps {
  /** Direction of the toggle. "to-viewer" shows on the admin view; "to-admin" shows on the viewer view in preview mode. */
  mode: "to-viewer" | "to-admin";
}

/**
 * Lets an admin preview the viewer dashboard (and jump back). Rendered as a
 * link, not a stateful switch, so it survives reloads and is safe across the
 * server/client boundary. The receiving page validates the actor is an admin
 * before honouring the `?as=viewer` switch — viewers cannot promote themselves.
 */
export function ViewAsToggle({ mode }: ViewAsToggleProps) {
  if (mode === "to-viewer") {
    return (
      <Link
        href="/?as=viewer"
        className="inline-flex items-center gap-1.5 rounded-full border bg-card/60 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Eye className="size-3" />
        Preview as viewer
      </Link>
    );
  }
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] text-primary transition-colors hover:bg-primary/15"
    >
      <ArrowLeft className="size-3" />
      Back to admin view
    </Link>
  );
}
