import { SquareIcon } from "lucide-react";
import type { ConnectionStatus } from "@tanstack/ai-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RUN_COLOR: Record<string, string> = {
  idle: "text-[var(--run-idle)]",
  queued: "text-[var(--run-queued)]",
  running: "text-[var(--run-running)]",
  failed: "text-[var(--run-failed)]",
  completed: "text-[var(--run-completed)]",
  reconnecting: "text-[var(--run-queued)]",
  synchronizing: "text-[var(--run-queued)]",
  sending: "text-[var(--run-running)]",
  "awaiting approval": "text-[var(--run-failed)]",
  cancelling: "text-[var(--run-queued)]",
  finished: "text-[var(--run-completed)]",
};

export type PlatformStatus =
  | "reconnecting"
  | "synchronizing"
  | "sending"
  | "queued"
  | "running"
  | "awaiting approval"
  | "cancelling"
  | "finished"
  | "idle"
  | "failed";

export function derivePlatformStatus(input: {
  runStatus: string;
  connectionStatus: ConnectionStatus;
  chatStatus: string;
  syncing?: boolean;
  pendingApprovals?: number;
}): PlatformStatus {
  if ((input.pendingApprovals ?? 0) > 0) return "awaiting approval";
  const connection = String(input.connectionStatus);
  if (connection === "reconnecting" || connection === "connecting") {
    return "reconnecting";
  }
  if (input.syncing) return "synchronizing";
  if (input.chatStatus === "submitted") return "sending";
  if (input.runStatus === "cancelling") return "cancelling";
  if (input.runStatus === "queued") return "queued";
  if (input.runStatus === "running" || input.chatStatus === "streaming") return "running";
  if (input.runStatus === "failed") return "failed";
  if (input.runStatus === "completed") return "finished";
  return "idle";
}

interface Props {
  platformStatus: PlatformStatus;
  runStatus: string;
  live: boolean;
  provider: string;
  model?: string;
  connected: boolean;
  onStop: () => void;
}

export function RunStrip({
  platformStatus,
  runStatus,
  live,
  provider,
  model,
  connected,
  onStop,
}: Props) {
  const status = platformStatus || runStatus || "idle";
  const color = RUN_COLOR[status] ?? RUN_COLOR.idle;
  const busy =
    status === "running" || status === "queued" || status === "sending" || status === "cancelling";

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-2.5"
      role="status"
      aria-live="polite"
    >
      <div className={cn("flex items-center gap-2 text-sm", color)}>
        <span className="run-dot" data-state={runStatus || status} aria-hidden="true" />
        <span className="capitalize">{status.replace(/-/g, " ")}</span>
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
