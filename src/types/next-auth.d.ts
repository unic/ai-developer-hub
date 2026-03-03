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
    };
  }

  interface User {
    role?: string;
    preferences?: UserPreferences;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    preferences?: UserPreferences;
  }
}
