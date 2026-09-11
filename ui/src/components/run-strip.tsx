import { SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RUN_COLOR: Record<string, string> = {
  idle: "text-[var(--run-idle)]",
  queued: "text-[var(--run-queued)]",
  running: "text-[var(--run-running)]",
  failed: "text-[var(--run-failed)]",
  completed: "text-[var(--run-completed)]",
};

interface Props {
  runStatus: string;
  live: boolean;
  provider: string;
  model?: string;
  connected: boolean;
  onStop: () => void;
}

export function RunStrip({ runStatus, live, provider, model, connected, onStop }: Props) {
  const status = runStatus || "idle";
  const color = RUN_COLOR[status] ?? RUN_COLOR.idle;
  const busy = status === "running" || status === "queued";

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-2.5"
      role="status"
      aria-live="polite"
    >
      <div className={cn("flex items-center gap-2 text-sm", color)}>
        <span className="run-dot" data-state={status} aria-hidden="true" />
        <span className="capitalize">{status}</span>
      </div>

      <span className="machine text-muted-foreground">
        {connected ? (live ? `live ${provider}` : "fixture") : "disconnected"}
        {model ? ` ${model}` : ""}
      </span>

      <div className="ml-auto">
        <Button
          type="button"
          size="sm"
          variant={busy ? "destructive" : "ghost"}
          onClick={onStop}
          disabled={!busy}
          aria-label="Stop"
        >
          <SquareIcon />
          Stop
        </Button>
      </div>
    </div>
  );
}
