import { ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TeamRecord } from "@/lib/state-schema";

interface Props {
  teams: TeamRecord[];
  activeTeamId: string;
  onSelect: (teamId: string) => void;
}

export function TeamSwitcher({ teams, activeTeamId, onSelect }: Props) {
  const active = teams.find((team) => team.id === activeTeamId);

  if (teams.length <= 1) {
    return <span className="truncate text-sm font-medium">{active?.name ?? "Team"}</span>;
  }

  return (
    <Select
      value={activeTeamId}
      onValueChange={(value) => {
        if (value) onSelect(value);
      }}
    >
      <SelectTrigger className="h-8 w-full max-w-[12rem] border-border bg-[var(--inset)]">
        <SelectValue placeholder="Team">{active?.name ?? "Team"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {teams.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name}
            {team.personal ? " (personal)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TeamSwitcherCompact({ teams, activeTeamId, onSelect }: Props) {
  return (
    <div className="hidden items-center gap-2 lg:flex">
      <TeamSwitcher teams={teams} activeTeamId={activeTeamId} onSelect={onSelect} />
      <Button type="button" size="icon-sm" variant="ghost" aria-hidden="true" tabIndex={-1}>
        <ChevronsUpDownIcon />
      </Button>
    </div>
  );
}
