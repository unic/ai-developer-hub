import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The "Managed by sync" marker shown wherever GitHub owns a seat rather than the
 * Hub (spec 042).
 *
 * Shared because this badge existed in two places with two different
 * explanations for the same condition — the assignments table said the
 * assignment "cannot be edited or revoked manually", the assignment detail page
 * said to change the plan in GitHub. One component, one message per caller.
 *
 * Carries its own TooltipProvider deliberately. The assignments table only works
 * because DataTable happens to wrap its rows in one; the assignment detail page
 * has none, and a bare Tooltip there throws "`Tooltip` must be used within
 * `TooltipProvider`" — which crashed the whole page for exactly the sync-managed
 * seats this badge exists to mark. Nesting providers is harmless, so owning one
 * makes the component safe to drop anywhere.
 */
export function SyncManagedBadge({
  tooltip,
  className,
}: {
  tooltip: string;
  className?: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`cursor-default text-xs text-muted-foreground${className ? ` ${className}` : ""}`}
          >
            Managed by sync
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
