import { Badge } from "@/components/ui/badge";

interface OutcomeBadgeProps {
  outcome: string | null;
  nullLabel?: string;
}

export function OutcomeBadge({ outcome, nullLabel = "Never synced" }: OutcomeBadgeProps) {
  if (!outcome) return <Badge variant="secondary">{nullLabel}</Badge>;
  const variants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    success: "default",
    partial: "outline",
    failed: "destructive",
    filtered: "outline",
    in_progress: "secondary",
  };
  return <Badge variant={variants[outcome] ?? "secondary"}>{outcome}</Badge>;
}
