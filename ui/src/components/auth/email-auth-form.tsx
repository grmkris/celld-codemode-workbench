import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInEmail, signUpEmail } from "@/lib/auth-client";

interface Props {
  mode: "login" | "signup";
  onToken: (token: string) => void;
  onSwitchMode: () => void;
}

export function EmailAuthForm({ mode, onToken, onSwitchMode }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-8 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const action =
          mode === "login"
            ? signInEmail(email, password)
            : signUpEmail(email, password, name || email.split("@")[0] || "User");
        void action
          .then((token) => {
            localStorage.setItem("celld_token", token);
            onToken(token);
          })
          .catch((err: Error) => setError(err.message))
          .finally(() => setBusy(false));
      }}
    >
      {mode === "signup" ? (
        <label className="flex flex-col gap-1.5 text-sm">
          Name
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="border-border bg-[var(--inset)]"
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1.5 text-sm">
        Email
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="border-border bg-[var(--inset)]"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Password
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="border-border bg-[var(--inset)]"
        />
      </label>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{mode === "login" ? "Sign in failed" : "Sign up failed"}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
        <Button type="button" variant="ghost" onClick={onSwitchMode}>
          {mode === "login" ? "Need an account?" : "Already have an account?"}
        </Button>
      </div>
    </form>
  );
}
