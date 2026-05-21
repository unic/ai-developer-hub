import type { ReactNode } from "react";

export interface TimelineItem {
  id: string;
  dotClass: string;
  primary: ReactNode;
  secondary: ReactNode;
}

interface TimelineProps {
  items: TimelineItem[];
  emptyMessage?: string;
}

/**
 * Vertical timeline used by both dashboards' activity feeds. Renders a
 * single-rail list with colored dots; consumers control the dot color and the
 * row content. Returns an empty-state paragraph when items is empty.
 */
export function Timeline({ items, emptyMessage = "No recent activity." }: TimelineProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <div className="relative pl-5">
      <span
        className="pointer-events-none absolute inset-y-1 left-[7px] w-px bg-border"
        aria-hidden
      />
      <ul>
        {items.map((item) => (
          <li key={item.id} className="relative pb-4 last:pb-0">
            <span
              aria-hidden
              className={`absolute -left-[18px] top-[6px] size-3 rounded-full ring-2 ring-background ${item.dotClass}`}
            />
            <p className="text-sm">{item.primary}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{item.secondary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
