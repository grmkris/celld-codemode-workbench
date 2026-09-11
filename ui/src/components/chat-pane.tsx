import { TriangleAlertIcon } from "lucide-react";
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
import { ChatMessage } from "@/components/chat-message";
import { GateCards } from "@/components/gate-cards";
import { Suggestions } from "@/components/suggestions";
import type { Snapshot, SnapshotMessage } from "@/lib/types";

interface Props {
  messages: SnapshotMessage[];
  approvals: Snapshot["approvals"];
  runStatus: string;
  runError: string;
  error: string | null;
  onPickSuggestion: (text: string) => void;
  onDecide: (id: string, decision: "approve" | "deny") => void;
}

export function ChatPane({
  messages,
  approvals,
  runStatus,
  runError,
  error,
  onPickSuggestion,
  onDecide,
}: Props) {
  const streaming = runStatus === "running" || runStatus === "queued";

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-auto">
        <GateCards approvals={approvals} onDecide={onDecide} />
        <div className="flex flex-1 items-center justify-center p-6">
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
          <div className="px-5 pb-4">
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
    <div className="flex min-h-0 flex-1 flex-col">
      <GateCards approvals={approvals} onDecide={onDecide} />
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="px-5 py-5">
            <MessageScrollerContent className="gap-6">
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  id={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatMessage message={message} />
                </MessageScrollerItem>
              ))}
              {streaming ? (
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
