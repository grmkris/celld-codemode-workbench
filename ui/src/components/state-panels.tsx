import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  notifications: Snapshot["notifications"];
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
  notifications,
}: Props) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <Tabs
      value={panel}
      onValueChange={(value) => onPanel(value as Panel)}
      className="flex h-full min-h-0 w-full flex-col gap-3"
    >
      <TabsList className="grid w-full shrink-0 grid-cols-4">
        <TabsTrigger value="memory">State</TabsTrigger>
        <TabsTrigger value="snippets">Programs</TabsTrigger>
        <TabsTrigger value="schedules">Schedules</TabsTrigger>
        <TabsTrigger value="trace">Trace</TabsTrigger>
      </TabsList>

      <ScrollArea className="min-h-0 flex-1">
        <div className="pr-2 pb-4">
          <TabsContent value="memory" className="mt-0 flex flex-col gap-6">
            <section>
              <h2 className="mb-2 text-[15px] font-semibold">Memory</h2>
              <div className="flex flex-col divide-y divide-border rounded-[var(--radius-well)] border border-border bg-[var(--inset)]">
                {(snapshot?.memory ?? []).map((item) => (
                  <div key={item.key} className="px-3 py-2.5">
                    <div className="machine text-muted-foreground">{item.key}</div>
                    <pre className="machine mt-1 whitespace-pre-wrap text-foreground">
                      {item.value}
                    </pre>
                  </div>
                ))}
                {!snapshot?.memory.length && (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    Nothing stored yet. Ask the agent to remember a fact.
                  </p>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[15px] font-semibold">Tasks</h2>
              <div className="flex flex-col gap-1.5">
                {openTasks.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-[var(--radius-well)] border border-border px-3 py-2 text-sm"
                  >
                    <Badge variant="secondary">{item.status}</Badge>
                    <span>{item.title}</span>
                  </div>
                ))}
                {openTasks.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No open tasks. Ask the agent to create some.
                  </p>
                )}
                {doneTasks.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-[var(--radius-well)] border border-border/60 px-3 py-2 text-sm text-muted-foreground"
                  >
                    <Badge variant="outline">done</Badge>
                    <span>{item.title}</span>
                  </div>
                ))}
                {doneTasks.length > 0 && (
                  <p className="machine text-muted-foreground">
                    {doneTasks.length} completed — clear removes them
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 self-start"
                  onClick={onClearWorkspace}
                >
                  Clear memory and tasks
                </Button>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[15px] font-semibold">Code Mode</h2>
              <div className="rounded-[var(--radius-well)] border border-border bg-[var(--inset)]">
                {executions.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    No executions this session. Tool calls appear here as they run.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {executions.map((item) => (
                      <li key={item.id} className="machine px-3 py-2 text-muted-foreground">
                        {eventLabel(item)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[15px] font-semibold">Notifications</h2>
              <div className="flex flex-col gap-1.5">
                {notifications.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[var(--radius-well)] border border-border px-3 py-2 text-sm"
                  >
                    {item.message}
                  </div>
                ))}
                {notifications.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No delivered effects. Approved notifications land here.
                  </p>
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="snippets" className="mt-0 flex flex-col gap-3">
            {(snapshot?.snippets ?? []).map((item) => {
              const tests = item.test_results ? JSON.parse(item.test_results) : null;
              const active = activeByName.get(item.name) === String(item.id);
              return (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-[var(--radius-card)] border border-border"
                >
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-[var(--raised)] px-3 py-2">
                    <span className="text-sm font-medium">
                      {item.name}{" "}
                      <span className="machine text-muted-foreground">v{item.version}</span>
                    </span>
                    {active ? <Badge>active</Badge> : null}
                    <Badge variant={tests?.passed ? "default" : "secondary"}>
                      {tests ? (tests.passed ? "tested" : "failed test") : "untested"}
                    </Badge>
                  </div>
                  {item.description ? (
                    <p className="px-3 pt-2 text-sm text-muted-foreground">{item.description}</p>
                  ) : null}
                  <pre className="machine max-h-40 overflow-auto bg-[var(--inset)] px-3 py-2.5">
                    {item.source}
                  </pre>
                  <div className="border-t border-border px-3 py-2">
                    <Button
                      size="sm"
                      variant="outline"
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
                </article>
              );
            })}
            {!snapshot?.snippets.length && (
              <p className="text-sm text-muted-foreground">
                No programs saved. Ask the agent to write a snippet.
              </p>
            )}
          </TabsContent>

          <TabsContent value="schedules" className="mt-0 flex flex-col gap-2">
            {(snapshot?.schedules ?? []).map((item) => (
              <div
                key={item.id}
                className="rounded-[var(--radius-well)] border border-border px-3 py-2.5"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{item.name}</span>
                  <Badge variant={item.status === "paused" ? "secondary" : "default"}>
                    {item.status}
                  </Badge>
                </div>
                <div className="machine mt-1 text-muted-foreground">
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
                className="machine rounded-[var(--radius-well)] border border-border px-3 py-2 text-muted-foreground"
              >
                {item.status} @ {new Date(item.due_at).toISOString()}
              </div>
            ))}
            {!snapshot?.schedules.length && (
              <p className="text-sm text-muted-foreground">
                No schedules. Activate a snippet, then schedule it.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
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
          </TabsContent>

          <TabsContent value="trace" className="mt-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">Observable actions</h2>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={showRaw} onCheckedChange={setShowRaw} />
                Raw payloads
              </label>
            </div>
            <div className="rounded-[var(--radius-well)] border border-border bg-[var(--inset)]">
              {events.filter(interesting).length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  No events yet. Sends and tool calls show up here.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {events.filter(interesting).map((item) => (
                    <li key={item.id} className="px-3 py-2">
                      <div className="machine">
                        <span className="text-muted-foreground">{item.id}</span> {eventLabel(item)}
                      </div>
                      {showRaw ? (
                        <pre className="machine mt-1 max-h-28 overflow-auto text-muted-foreground">
                          {item.payload.slice(0, 800)}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>
        </div>
      </ScrollArea>
    </Tabs>
  );
}
