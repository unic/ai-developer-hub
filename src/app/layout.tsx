import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { auth } from "@/lib/auth";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { LeanModeProvider } from "@/contexts/lean-mode-context";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-retro",
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
  const session = await auth();

  return (
    <html lang="en" suppressHydrationWarning className={jetbrainsMono.variable}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem("lean-mode");if(l!=="true")document.documentElement.setAttribute("data-retro","")}catch(e){}})()`,
          }}
        />
      </head>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <LeanModeProvider>
            {session?.user ? (
              <SidebarProvider>
                <AppSidebar
                  userName={session.user.name ?? "User"}
                  userRole={session.user.role ?? "viewer"}
                />
                <SidebarInset>
                  <header className="flex h-14 items-center gap-2 border-b px-4">
                    <SidebarTrigger />
                  </header>
                  <main className="flex-1 p-4 sm:p-6 retro:scanlines">{children}</main>
                </SidebarInset>
              </SidebarProvider>
            ) : (
              children
            )}
            <Toaster />
          </LeanModeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
