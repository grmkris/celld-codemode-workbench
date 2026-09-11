import { Badge } from "@/components/ui/badge";

interface Props {
  connected: boolean;
  live: boolean;
  provider: string;
  runStatus: string;
  model?: string;
}

export function StatusPills({ connected, live, provider, runStatus, model }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={connected ? "default" : "destructive"}>
          {connected ? "connected" : "disconnected"}
        </Badge>
        <Badge variant={live ? "secondary" : "default"}>
          {live ? `live ${provider}` : "fixture"}
        </Badge>
        <Badge variant={runStatus === "failed" ? "destructive" : "outline"}>{runStatus}</Badge>
      </div>
      {model ? <p className="font-mono text-xs text-muted-foreground">model {model}</p> : null}
      <p className="font-mono text-xs text-muted-foreground">
        Disconnect keeps the run. Stop cancels new host work.
      </p>
    </div>
  );
}
