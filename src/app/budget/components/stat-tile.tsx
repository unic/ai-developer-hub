interface Props {
  label: string;
  value: string;
  sub?: string | null;
  tone?: "default" | "danger" | "success";
}

export function StatTile({ label, value, sub, tone = "default" }: Props) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "success"
        ? "text-success"
        : "";
  return (
    <div className="rounded-[14px] border bg-card/60 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
