import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Admin gate for the whole /scenarios subtree (mirrors the copilot/reports
 * section layouts). Individual pages render their own headers.
 */
export default async function ScenariosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login");
  }

  return <>{children}</>;
}
