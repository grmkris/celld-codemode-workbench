import { Badge } from "@/components/ui/badge";
import type { DelegatedTaskRecord } from "@/lib/state-schema";

interface Props {
  task: DelegatedTaskRecord;
  onOpen?: (taskId: string) => void;
}

export function TaskCard({ task, onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(task.id)}
      className="w-full rounded-[var(--radius-well)] border border-border bg-[var(--inset)] p-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{task.title}</span>
        <Badge variant="outline">{task.status}</Badge>
      </div>
      <p className="machine mt-1 text-muted-foreground">{task.conversationId}</p>
    </button>
  );
}
