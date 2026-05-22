"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Wrench,
  Users,
  KeyRound,
  DollarSign,
  BarChart3,
  Bot,
  FileText,
  Inbox,
  Settings,
  LogOut,
  LogIn,
  UserCircle,
} from "lucide-react";
import { signOut } from "next-auth/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import type { UserRole } from "@/types";

type NavItem = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
};

const navItems: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["admin", "viewer"] },
  { title: "Tools", href: "/tools", icon: Wrench, roles: ["admin", "viewer"] },
  { title: "Users", href: "/users", icon: Users, roles: ["admin"] },
  { title: "Assignments", href: "/assignments", icon: KeyRound, roles: ["admin", "viewer"] },
  { title: "Requests", href: "/requests", icon: Inbox, roles: ["admin"] },
  { title: "Budget", href: "/budget", icon: DollarSign, roles: ["admin"] },
  { title: "Reports", href: "/reports", icon: BarChart3, roles: ["admin"] },
  { title: "Copilot", href: "/copilot", icon: Bot, roles: ["admin"] },
  { title: "Claude Console", href: "/claude", icon: Bot, roles: ["admin"] },
  { title: "Invoices", href: "/invoices", icon: FileText, roles: ["admin"] },
  { title: "Settings", href: "/settings/appearance", icon: Settings, roles: ["admin", "viewer"] },
];

export function AppSidebar({
  userName,
  userRole,
}: {
  userName: string | null;
  userRole: string | null;
}) {
  const pathname = usePathname();
  const isAuthenticated = userName !== null && userRole !== null;
  const filteredNavItems = isAuthenticated
    ? navItems.filter((item) => item.roles.includes(userRole as UserRole))
    : [];

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <h2 className="text-lg font-semibold">AI Developer Hub</h2>
      </SidebarHeader>
      <SidebarContent>
        {isAuthenticated ? (
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredNavItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href));
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Link href={item.href}>
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <SidebarGroup>
            <SidebarGroupContent>
              <div className="px-4 py-6">
                <p className="text-sm text-muted-foreground">
                  Sign in to access the application.
                </p>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t p-4">
        {isAuthenticated ? (
          <div className="flex items-center justify-between">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-left">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{userName}</p>
                    <p className="text-xs text-muted-foreground capitalize">{userRole}</p>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserCircle className="mr-2 size-4" />
                    My Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
                  <LogOut className="mr-2 size-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle />
          </div>
        ) : (
          <Button asChild className="w-full">
            <Link href="/login">
              <LogIn className="mr-2 size-4" />
              Sign In
            </Link>
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
