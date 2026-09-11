import { LogOutIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatSummary } from "@/lib/types";

const RUN_DOT: Record<string, string> = {
  idle: "bg-[var(--run-idle)]",
  queued: "bg-[var(--run-queued)]",
  running: "bg-[var(--run-running)]",
  failed: "bg-[var(--run-failed)]",
  completed: "bg-[var(--run-completed)]",
};

interface Props {
  chats: ChatSummary[];
  activeId: string;
  busy: boolean;
  approvalCount: number;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onLeave: () => void;
}

export function SessionRail({
  chats,
  activeId,
  busy,
  approvalCount,
  onSelect,
  onCreate,
  onLeave,
}: Props) {
  return (
    <aside className="flex h-full min-h-0 w-[4.5rem] shrink-0 flex-col overflow-hidden border-r border-border bg-[var(--raised)] lg:w-56">
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
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

      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-0.5 p-2" aria-label="Chats">
          {chats.map((chat) => {
            const active = chat.id === activeId;
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
          {!chats.length && <p className="px-2 py-3 text-sm text-muted-foreground">No chats yet</p>}
        </nav>
      </ScrollArea>

      <div className="border-t border-border p-2">
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
