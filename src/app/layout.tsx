import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono, Doto } from "next/font/google";
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
import { getActiveAlerts } from "@/actions/alerts";
import { AlertBanner } from "@/components/alert-banner";
import "./globals.css";

// Nothing three-family stack — self-hosted via next/font (auto fallback metrics),
// NOT the mockup's render-blocking Google @import. Space Grotesk is the UI/body
// default and the only preloaded family; Space Mono (data/labels) and Doto
// (36px+ hero only) are loaded but not preloaded.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
  preload: true,
});
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
  preload: false,
});
const doto = Doto({
  subsets: ["latin"],
  variable: "--font-doto",
  display: "swap",
  preload: false,
});

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
  const alerts = showSidebar && session?.user?.role === "admin"
    ? await getActiveAlerts().catch(() => null)
    : null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${spaceMono.variable} ${doto.variable} font-sans antialiased`}
      >
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
                  <AlertBanner alerts={alerts} />
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
