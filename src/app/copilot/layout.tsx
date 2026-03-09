import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CopilotTabBar } from "./copilot-tab-bar";

export default async function CopilotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Copilot</h1>
        <p className="text-muted-foreground">
          GitHub Copilot usage analytics, seat management, and billing insights.
        </p>
      </div>
      <CopilotTabBar />
      {children}
    </div>
  );
}
