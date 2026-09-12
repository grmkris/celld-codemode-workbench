import { LogOutIcon, PlusIcon, ServerIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TeamSwitcher } from "@/components/team-switcher";
import type { ConversationSummary, TeamRecord } from "@/lib/state-schema";
import { cn } from "@/lib/utils";

const RUN_DOT: Record<string, string> = {
  idle: "bg-[var(--run-idle)]",
  queued: "bg-[var(--run-queued)]",
  running: "bg-[var(--run-running)]",
  failed: "bg-[var(--run-failed)]",
  completed: "bg-[var(--run-completed)]",
};

interface Props {
  teams: TeamRecord[];
  teamId: string;
  conversations: ConversationSummary[];
  activeConversationId: string;
  busy: boolean;
  approvalCount: number;
  onTeamSelect: (teamId: string) => void;
  onSelect: (conversationId: string) => void;
  onCreate: () => void;
  onMachines: () => void;
  onMembers: () => void;
  onLeave: () => void;
  membersOpen?: boolean;
}

export function TeamRail({
  teams,
  teamId,
  conversations,
  activeConversationId,
  busy,
  approvalCount,
  onTeamSelect,
  onSelect,
  onCreate,
  onMachines,
  onMembers,
  onLeave,
  membersOpen,
}: Props) {
  return (
    <aside className="flex h-full min-h-0 w-[4.5rem] shrink-0 flex-col overflow-hidden border-r border-border bg-[var(--raised)] lg:w-56">
      <div className="border-b border-border px-3 py-3">
        <div className="hidden lg:block">
          <TeamSwitcher teams={teams} activeTeamId={teamId} onSelect={onTeamSelect} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onCreate}
            className="w-full justify-start gap-2 px-2"
            aria-label="New chat"
          >
            <PlusIcon />
            <span className="hidden lg:inline">New chat</span>
          </Button>
          {approvalCount > 0 ? (
            <span
              className="machine flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--run-failed)] text-[0.65rem] text-white"
              title={`${approvalCount} pending approval${approvalCount === 1 ? "" : "s"}`}
            >
              {approvalCount}
            </span>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-0.5 p-2" aria-label="Chats">
          {conversations.map((chat) => {
            const active = chat.id === activeConversationId;
            const dot = RUN_DOT[chat.runStatus] ?? RUN_DOT.idle;
            return (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelect(chat.id)}
                className={cn(
                  "group relative flex w-full flex-col gap-0.5 rounded-[var(--radius-well)] px-2.5 py-2 text-left transition-colors",
                  "hover:bg-muted/50 focus-visible:outline-none",
                  active && "bg-muted/60",
                )}
                aria-current={active ? "page" : undefined}
              >
                {active ? (
                  <span
                    className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--ember)]"
                    aria-hidden="true"
                  />
                ) : null}
                <div className="flex items-center gap-2">
                  <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden="true" />
                  <span className="hidden truncate text-sm font-medium lg:inline">
                    {chat.title || chat.id.slice(0, 8)}
                  </span>
                  <span className="machine truncate lg:hidden">{chat.id.slice(0, 4)}</span>
                </div>
                {chat.lastMessage ? (
                  <span className="machine hidden truncate pl-3.5 text-muted-foreground lg:block">
                    {chat.lastMessage.slice(0, 42)}
                  </span>
                ) : null}
              </button>
            );
          })}
          {!conversations.length && (
            <p className="px-2 py-3 text-sm text-muted-foreground">No chats yet</p>
          )}
        </nav>
      </ScrollArea>

      <div className="flex flex-col gap-1 border-t border-border p-2">
        <Button
          type="button"
          size="sm"
          variant={membersOpen ? "secondary" : "ghost"}
          onClick={onMembers}
          className="w-full justify-start gap-2 px-2"
          aria-label="Team members"
        >
          <UsersIcon />
          <span className="hidden lg:inline">Members</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onMachines}
          className="w-full justify-start gap-2 px-2"
          aria-label="Machines"
        >
          <ServerIcon />
          <span className="hidden lg:inline">Machines</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onLeave}
          className="w-full justify-start gap-2 px-2"
          aria-label="Leave"
        >
          <LogOutIcon />
          <span className="hidden lg:inline">Leave</span>
        </Button>
      </div>
    </aside>
  );
}
