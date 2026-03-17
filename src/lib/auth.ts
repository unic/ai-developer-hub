import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { loginSchema } from "@/lib/validators";
import type { UserPreferences } from "@/types";

const DEFAULT_PREFERENCES: UserPreferences = { theme: "system" };

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        if (!user || user.status !== "active") return null;

        if (user.mustChangePassword) {
          throw new Error(
            "Your account hasn't been set up yet. Please use the invite link sent to your email, or contact your administrator."
          );
        }

        const passwordMatch = await compare(password, user.passwordHash);
        if (!passwordMatch) return null;

        return {
          id: String(user.id),
          email: user.email,
          name: user.name,
          role: user.role,
          preferences: user.preferences ?? DEFAULT_PREFERENCES,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: string }).role;
        token.preferences = (user as { preferences?: UserPreferences }).preferences ?? DEFAULT_PREFERENCES;
      }
      if (trigger === "update" && session?.preferences) {
        token.preferences = session.preferences;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.preferences = (token.preferences as UserPreferences | undefined) ?? DEFAULT_PREFERENCES;
      }
      return session;
    },
  },
});
