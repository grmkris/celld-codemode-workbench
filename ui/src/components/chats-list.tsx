import { MessageSquareIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatSummary } from "@/lib/types";

interface Props {
  chats: ChatSummary[];
  activeId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function ChatsList({ chats, activeId, busy, onSelect, onCreate }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
          <MessageSquareIcon className="size-4" />
          Chats
        </CardTitle>
        <Button size="sm" disabled={busy} onClick={onCreate}>
          <PlusIcon />
          New chat
        </Button>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-64">
          <div className="flex flex-col gap-1.5 pr-2">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelect(chat.id)}
                className={cn(
                  "rounded-xl border border-border bg-muted/30 p-2.5 text-left transition-colors hover:bg-muted/60",
                  chat.id === activeId && "border-primary/60 bg-primary/10",
                )}
              >
                <div className="truncate text-sm font-medium">{chat.title}</div>
                <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <Badge
                    variant={chat.runStatus === "failed" ? "destructive" : "secondary"}
                    className="shrink-0"
                  >
                    {chat.runStatus}
                  </Badge>
                  {chat.lastMessage ? (
                    <span className="truncate">{chat.lastMessage.slice(0, 48)}</span>
                  ) : null}
                </div>
              </button>
            ))}
            {!chats.length && (
              <p className="font-mono text-xs text-muted-foreground">No chats yet.</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
