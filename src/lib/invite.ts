import { randomBytes, createHash } from "crypto";
import { env } from "@/lib/env";

export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function buildInviteUrl(raw: string): string {
  const baseUrl =
    env.NEXTAUTH_URL ||
    (env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : "http://localhost:3000");
  return `${baseUrl}/setup-password/${raw}`;
}
