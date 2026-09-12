import { TriangleAlertIcon } from "lucide-react";
import type { UIMessage } from "@tanstack/ai-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Markdown } from "@/components/markdown";
import { GateCards } from "@/components/gate-cards";
import { Suggestions } from "@/components/suggestions";
import type { Snapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  messages: UIMessage[];
  approvals: Snapshot["approvals"];
  isBusy: boolean;
  runError: string;
  error: string | null;
  onPickSuggestion: (text: string) => void;
  onDecide: (id: string, decision: "approve" | "deny") => void;
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => ("content" in part ? String(part.content ?? "") : ""))
    .join("");
}

export function ChatTranscript({
  messages,
  approvals,
  isBusy,
  runError,
  error,
  onPickSuggestion,
  onDecide,
}: Props) {
  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <GateCards approvals={approvals} onDecide={onDecide} />
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          <Empty className="border-0 bg-transparent p-0">
            <EmptyHeader>
              <EmptyTitle className="text-[1.75rem] font-semibold">What should we do?</EmptyTitle>
              <EmptyDescription className="max-w-[42ch] text-[15px] leading-relaxed">
                Ask the agent to remember something, create tasks, or write a contained program.
                Each chat is its own cell.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Suggestions onPick={onPickSuggestion} />
            </EmptyContent>
          </Empty>
        </div>
        {error ? (
          <div className="shrink-0 px-5 pb-4">
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Request failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <GateCards approvals={approvals} onDecide={onDecide} />
      <MessageScrollerProvider>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="px-5 py-5">
            <MessageScrollerContent className="gap-6">
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  id={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  {message.role === "user" ? (
                    <div className="flex justify-end">
                      <div
                        className={cn(
                          "max-w-[min(68ch,85%)] rounded-[var(--radius-card)] border border-[var(--ember)]/35",
                          "bg-[var(--ember)]/15 px-3.5 py-2.5 text-[15px] leading-relaxed",
                        )}
                      >
                        <Markdown content={messageText(message)} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full max-w-[68ch] flex-col gap-2 text-[15px] leading-relaxed">
                      {message.parts.map((part, index) => {
                        if (part.type === "text") {
                          return (
                            <Markdown
                              key={index}
                              content={"content" in part ? String(part.content ?? "") : ""}
                            />
                          );
                        }
                        if (part.type === "thinking") {
                          return (
                            <p key={index} className="text-sm text-muted-foreground italic">
                              {"content" in part ? String(part.content ?? "") : ""}
                            </p>
                          );
                        }
                        if (part.type === "tool-call") {
                          return (
                            <div
                              key={index}
                              className="machine rounded-[var(--radius-well)] border border-border bg-[var(--inset)] px-3 py-2 text-muted-foreground"
                            >
                              tool: {"name" in part ? String(part.name) : "tool"}
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </MessageScrollerItem>
              ))}
              {isBusy ? (
                <div className="max-w-[68ch] text-[15px] text-muted-foreground" role="status">
                  Working
                  <span className="streaming-caret" aria-hidden="true" />
                </div>
              ) : null}
              {runError ? (
                <Alert variant="destructive" className="max-w-[68ch]">
                  <TriangleAlertIcon />
                  <AlertTitle>Run failed</AlertTitle>
                  <AlertDescription>{runError}</AlertDescription>
                </Alert>
              ) : null}
              {error ? (
                <Alert variant="destructive" className="max-w-[68ch]">
                  <TriangleAlertIcon />
                  <AlertTitle>Request failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton direction="end" />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}
