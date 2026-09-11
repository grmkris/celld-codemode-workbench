import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="mx-auto mt-[12vh] w-full max-w-md p-4">
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-2xl">Application agent</CardTitle>
          <CardDescription className="font-mono text-xs">
            Owner-scoped Celld workbench. Disconnect is not Stop.
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge variant={connected ? "default" : "secondary"}>
              {connected ? "Celld reachable" : "Waiting for Celld on this origin"}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {health?.live ? "Live model" : "Fixture model"} · {health?.provider ?? "unknown"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
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
            <label className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
              Owner
              <Input value={ownerId} onChange={(event) => setOwnerId(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
              Shared secret
              <Input
                type="password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Login failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={busy}>
              Enter
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
