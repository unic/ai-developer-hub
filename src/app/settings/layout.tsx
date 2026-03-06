import { auth } from "@/lib/auth";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  return (
    <div className="space-y-6">
      <SettingsNav isAdmin={isAdmin} />
      {children}
    </div>
  );
}
