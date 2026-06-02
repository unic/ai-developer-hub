import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ReportsNav } from "./reports-nav";

export default async function ReportsLayout({
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
        <h1 className="text-3xl font-medium tracking-tight text-ink">Reports</h1>
        <p className="text-muted-foreground">
          Tool adoption, license utilization, and spending insights
        </p>
      </div>
      <ReportsNav />
      {children}
    </div>
  );
}
