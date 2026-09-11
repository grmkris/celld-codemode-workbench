import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { eventLabel, interesting } from "@/lib/events";
import type { EventRow, Panel, Snapshot } from "@/lib/types";

interface Props {
  snapshot: Snapshot | null;
  events: EventRow[];
  executions: EventRow[];
  openTasks: Snapshot["tasks"];
  doneTasks: Snapshot["tasks"];
  activeByName: Map<string, string>;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  base: string;
  token: string;
  onRefresh: () => void;
  onClearWorkspace: () => void;
}

export function StatePanels({
  snapshot,
  events,
  executions,
  openTasks,
  doneTasks,
  activeByName,
  panel,
  onPanel,
  base,
  token,
  onRefresh,
  onClearWorkspace,
}: Props) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <Tabs value={panel} onValueChange={(value) => onPanel(value as Panel)} className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="memory">State</TabsTrigger>
        <TabsTrigger value="snippets">Snippets</TabsTrigger>
        <TabsTrigger value="schedules">Schedules</TabsTrigger>
        <TabsTrigger value="trace">Trace</TabsTrigger>
      </TabsList>

      <TabsContent value="memory" className="flex flex-col gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Memory
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(snapshot?.memory ?? []).map((item) => (
              <div key={item.key} className="rounded-xl border border-border bg-muted/30 p-2.5">
                <strong className="font-mono text-xs">{item.key}</strong>
                <pre className="mt-1 font-mono text-xs whitespace-pre-wrap">{item.value}</pre>
              </div>
            ))}
            {!snapshot?.memory.length && (
              <p className="font-mono text-xs text-muted-foreground">No memory yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Tasks
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {openTasks.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-2.5 text-sm"
              >
                <Badge variant="secondary">{item.status}</Badge>
                <span>{item.title}</span>
              </div>
            ))}
            {openTasks.length === 0 && (
              <p className="font-mono text-xs text-muted-foreground">No open tasks.</p>
            )}
            {doneTasks.length > 0 && (
              <p className="font-mono text-xs text-muted-foreground">
                {doneTasks.length} completed (still stored). Clearing the workspace deletes them.
              </p>
            )}
            {doneTasks.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-xl border border-border p-2.5 text-sm"
              >
                <Badge variant="default">done</Badge>
                <span>{item.title}</span>
              </div>
            ))}
            <Button variant="outline" onClick={onClearWorkspace}>
              Clear application state
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Code Mode
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {executions.length === 0 && (
              <p className="font-mono text-xs text-muted-foreground">No executions this session.</p>
            )}
            {executions.map((item) => (
              <Marker key={item.id}>
                <MarkerContent className="font-mono text-xs">{eventLabel(item)}</MarkerContent>
              </Marker>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="snippets">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Saved programs
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(snapshot?.snippets ?? []).map((item) => {
              const tests = item.test_results ? JSON.parse(item.test_results) : null;
              const active = activeByName.get(item.name) === String(item.id);
              return (
                <div key={item.id} className="rounded-xl border border-border bg-muted/30 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="font-medium">
                      {item.name} v{item.version}
                    </span>
                    {active ? <Badge variant="default">active</Badge> : null}
                    <Badge variant={tests?.passed ? "default" : "secondary"}>
                      {tests ? (tests.passed ? "tested" : "failed test") : "untested"}
                    </Badge>
                  </div>
                  {item.description ? (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                  <ScrollArea className="mt-2 max-h-40 rounded-lg border border-border bg-background p-2">
                    <pre className="font-mono text-xs">{item.source}</pre>
                  </ScrollArea>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() =>
                      void api(`${base}/snippets/invoke`, {
                        method: "POST",
                        token,
                        body: JSON.stringify({ name: item.name, version: item.version }),
                      }).then(onRefresh)
                    }
                  >
                    Invoke without model
                  </Button>
                </div>
              );
            })}
            {!snapshot?.snippets.length && (
              <p className="font-mono text-xs text-muted-foreground">No snippets saved.</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="schedules">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Schedules
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(snapshot?.schedules ?? []).map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-border bg-muted/30 p-2.5 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span>{item.name}</span>
                  <Badge variant={item.status === "paused" ? "secondary" : "default"}>
                    {item.status}
                  </Badge>
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  due {new Date(item.next_due_at).toISOString()}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() =>
                    void api(`${base}/schedules/pause`, {
                      method: "POST",
                      token,
                      body: JSON.stringify({ id: item.id, paused: item.status !== "paused" }),
                    }).then(onRefresh)
                  }
                >
                  {item.status === "paused" ? "Resume" : "Pause"}
                </Button>
              </div>
            ))}
            {(snapshot?.occurrences ?? []).map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-border p-2.5 font-mono text-xs"
              >
                {item.status} @ {new Date(item.due_at).toISOString()}
              </div>
            ))}
            {!snapshot?.schedules.length && (
              <p className="font-mono text-xs text-muted-foreground">No schedules.</p>
            )}
            <Button
              variant="outline"
              onClick={() =>
                void api(`${base}/schedules`, {
                  method: "POST",
                  token,
                  body: JSON.stringify({
                    name: "maintenance-tick",
                    snippetName: "maintenance_summary",
                    delaySeconds: 3,
                  }),
                }).then(onRefresh)
              }
            >
              Schedule active snippet
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="trace">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Observable actions
            </CardTitle>
            <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <Switch checked={showRaw} onCheckedChange={setShowRaw} />
              Show raw payloads
            </label>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ScrollArea className="max-h-[60vh]">
              <div className="flex flex-col gap-2 pr-2">
                {events.filter(interesting).map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-muted/30 p-2.5">
                    <div className="font-mono text-xs">
                      {item.id} {eventLabel(item)}
                    </div>
                    {showRaw ? (
                      <pre className="mt-1 max-h-32 overflow-auto font-mono text-xs">
                        {item.payload.slice(0, 800)}
                      </pre>
                    ) : null}
                  </div>
                ))}
                {!events.length && (
                  <p className="font-mono text-xs text-muted-foreground">No events yet.</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
