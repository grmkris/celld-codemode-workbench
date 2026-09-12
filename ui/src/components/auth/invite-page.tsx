import { useState } from "react";
import { EmailAuthForm } from "@/components/auth/email-auth-form";
import { LoginForm } from "@/components/login-form";
import { acceptInvitation, type AuthMode } from "@/lib/auth-client";
import type { HealthInfo } from "@/lib/types";

interface Props {
  token: string;
  authMode: AuthMode;
  health: HealthInfo | null;
  connected: boolean;
  onAuthed: (token: string) => void;
}

export function InvitePage({ token, authMode, health, connected, onAuthed }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const finish = (sessionToken: string) => {
    void acceptInvitation(token, sessionToken)
      .then(() => {
        setAccepted(true);
        onAuthed(sessionToken);
      })
      .catch((err: Error) => setError(err.message));
  };

  if (accepted) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm">Invitation accepted. Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bench)] p-6">
      <div className="w-full max-w-md">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Join team</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">Sign in to accept this invitation.</p>
        {error ? <p className="mt-3 text-sm text-[var(--run-failed)]">{error}</p> : null}
        {authMode === "fixture" ? (
          <LoginForm
            connected={connected}
            health={health}
            error={error}
            onError={setError}
            onToken={finish}
          />
        ) : (
          <EmailAuthForm mode="login" onToken={finish} onSwitchMode={() => undefined} />
        )}
      </div>
    </div>
  );
}
