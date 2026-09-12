import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

type Member = { userId: string; role: string; createdAt: number };

interface Props {
  teamId: string;
  token: string;
}

export function TeamMembersPanel({ teamId, token }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [emailHint, setEmailHint] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await api<{ members: Member[] }>(
      `/api/teams/${encodeURIComponent(teamId)}/members`,
      { token },
    );
    setMembers(data.members);
  }, [teamId, token]);

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Members</h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {members.map((member) => (
          <li key={member.userId} className="flex items-center justify-between gap-2">
            <span className="truncate">{member.userId}</span>
            <span className="machine text-muted-foreground">{member.role}</span>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2 border-t border-border pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void api<{ inviteUrl?: string }>(`/api/teams/${encodeURIComponent(teamId)}/invitations`, {
            method: "POST",
            token,
            body: JSON.stringify({ emailHint, role: "member" }),
          })
            .then((data) => {
              setInviteUrl(data.inviteUrl ?? null);
              setEmailHint("");
            })
            .catch((err: Error) => setError(err.message));
        }}
      >
        <label className="text-sm">
          Invite by email hint
          <Input
            value={emailHint}
            onChange={(event) => setEmailHint(event.target.value)}
            placeholder="colleague@example.com"
            className="mt-1 border-border bg-[var(--inset)]"
          />
        </label>
        <Button type="submit" size="sm" className="self-start">
          Create invite
        </Button>
        {inviteUrl ? <p className="machine break-all text-muted-foreground">{inviteUrl}</p> : null}
        {error ? <p className="text-sm text-[var(--run-failed)]">{error}</p> : null}
      </form>
    </div>
  );
}
