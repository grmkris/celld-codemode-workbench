import { api } from "@/lib/api";
import type { HealthInfo } from "@/lib/types";

export type AuthMode = "fixture" | "email";

export async function detectAuthMode(): Promise<AuthMode> {
  try {
    const health = await api<HealthInfo & { authFixture?: boolean }>("/health");
    if (health.authFixture) return "fixture";
  } catch {
    // fall through
  }
  if (import.meta.env.VITE_AUTH_FIXTURE === "1") return "fixture";
  return "email";
}

export async function signInEmail(email: string, password: string): Promise<string> {
  const response = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await response.json()) as { token?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Sign in failed");
  }
  const token = data.token ?? response.headers.get("set-auth-token") ?? "";
  if (!token) throw new Error("Missing session token");
  return token;
}

export async function signUpEmail(email: string, password: string, name: string): Promise<string> {
  const response = await fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  const data = (await response.json()) as { token?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Sign up failed");
  }
  const token = data.token ?? response.headers.get("set-auth-token") ?? "";
  if (!token) throw new Error("Missing session token");
  return token;
}

export async function acceptInvitation(token: string, authToken: string): Promise<void> {
  await api("/api/invitations/accept", {
    method: "POST",
    token: authToken,
    body: JSON.stringify({ token }),
  });
}
