import "next-auth";
import type { UserPreferences } from "@/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
      preferences: UserPreferences;
      isAgent: boolean;
    };
  }

  interface User {
    role?: string;
    preferences?: UserPreferences;
    isAgent?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    preferences?: UserPreferences;
    isAgent?: boolean;
  }
}
