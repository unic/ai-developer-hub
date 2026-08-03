import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
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
 */
export function SyncManagedBadge({
  tooltip,
  className,
}: {
  tooltip: string;
  className?: string;
}) {
  return (
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
  );
}
