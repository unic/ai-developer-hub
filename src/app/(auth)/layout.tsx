import { Bot } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Decorative side panel — visible on large screens */}
      <div className="hidden lg:flex flex-col justify-between bg-primary p-10 text-primary-foreground">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Bot className="size-6" />
          <span>AI Developer Hub</span>
        </div>
        <blockquote className="space-y-2">
          <p className="text-lg leading-relaxed">
            &ldquo;Centralise your AI tool budgets, licences, and usage data in
            one place — so your team can focus on building.&rdquo;
          </p>
          <footer className="text-sm text-primary-foreground/70">
            Budget Tracker &middot; Licence Manager &middot; Usage Reports
          </footer>
        </blockquote>
        <p className="text-xs text-primary-foreground/50">
          &copy; {new Date().getFullYear()} AI Developer Hub
        </p>
      </div>

      {/* Main content area */}
      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
