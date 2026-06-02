export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Decorative side panel — neutral surface + dot-matrix, NOT an accent fill */}
      <div className="nd-dot-grid hidden flex-col justify-between border-r border-border bg-card p-10 lg:flex">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-destructive" aria-hidden="true" />
          <span className="font-mono text-sm tracking-[0.14em] uppercase text-ink">
            AI·HUB
          </span>
        </div>
        <blockquote className="space-y-3">
          <p className="text-lg leading-relaxed text-foreground">
            &ldquo;Centralise your AI tool budgets, licences, and usage data in
            one place — so your team can focus on building.&rdquo;
          </p>
          <footer className="font-mono text-[11px] tracking-[0.1em] uppercase text-muted-foreground">
            Budget Tracker · Licence Manager · Usage Reports
          </footer>
        </blockquote>
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint">
          © {new Date().getFullYear()} AI Developer Hub
        </p>
      </div>

      {/* Main content area */}
      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
