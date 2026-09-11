import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { HealthInfo } from "@/lib/types";

interface Props {
  connected: boolean;
  health: HealthInfo | null;
  error: string | null;
  onError: (message: string) => void;
  onToken: (token: string, ownerId: string) => void;
}

export function LoginForm({ connected, health, error, onError, onToken }: Props) {
  const [ownerId, setOwnerId] = useState("operator");
  const [secret, setSecret] = useState("dev-change-me");
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bench)] p-6">
      <div className="w-full max-w-md">
        <h1 className="text-[1.75rem] leading-8 font-semibold tracking-tight">Application agent</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Owner-scoped Celld workbench. Disconnect keeps the run; Stop cancels new host work.
        </p>
        <p className="machine mt-3 text-muted-foreground">
          {connected ? "Celld reachable" : "Waiting for Celld"}
          {" — "}
          {health?.live ? "live model" : "fixture model"}
          {health?.provider ? ` ${health.provider}` : ""}
        </p>

        <form
          className="mt-8 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void api<{ token: string }>("/api/login", {
              method: "POST",
              body: JSON.stringify({ ownerId, secret }),
            })
              .then((data) => {
                localStorage.setItem("celld_token", data.token);
                onToken(data.token, ownerId);
              })
              .catch((err: Error) => onError(err.message))
              .finally(() => setBusy(false));
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm">
            Owner
            <Input
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
              className="border-border bg-[var(--inset)]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Shared secret
            <Input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              className="border-border bg-[var(--inset)]"
            />
          </label>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Login failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={busy} className="self-start">
            Enter
          </Button>
        </form>
      </div>
    </div>
  );
}
