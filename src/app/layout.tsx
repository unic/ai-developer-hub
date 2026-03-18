import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isPublicPath } from "@/lib/routes";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { SessionProvider } from "@/components/session-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
export const metadata: Metadata = {
  title: "AI Developer Hub",
  description: "AI Tool Access & Budget Tracker",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const pathname = (headerStore.get("x-pathname") ?? "/").split("?")[0];
  const showSidebar = !isPublicPath(pathname);
  const session = showSidebar ? await auth() : null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SessionProvider session={session}>
            {showSidebar ? (
              <SidebarProvider>
                <AppSidebar
                  userName={session?.user?.name ?? null}
                  userRole={session?.user?.role ?? null}
                />
                <SidebarInset>
                  <header className="flex h-14 items-center gap-2 border-b px-4">
                    <SidebarTrigger />
                  </header>
                  <main className="flex-1 p-4 sm:p-6">{children}</main>
                </SidebarInset>
              </SidebarProvider>
            ) : (
              children
            )}
            <Toaster />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
