import { BotIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { ChatMessage } from "@/components/chat-message";
import { Suggestions } from "@/components/suggestions";
import type { SnapshotMessage } from "@/lib/types";

interface Props {
  messages: SnapshotMessage[];
  runStatus: string;
  runError: string;
  error: string | null;
  onPickSuggestion: (text: string) => void;
}

export function ChatPane({ messages, runStatus, runError, error, onPickSuggestion }: Props) {
  const streaming = runStatus === "running" || runStatus === "queued";

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotIcon />
            </EmptyMedia>
            <EmptyTitle>What are we working on?</EmptyTitle>
            <EmptyDescription>
              Ask the agent to remember something, create tasks, or write a snippet. In fixture mode
              the interpreter and host capabilities are real. Each chat is its own cell.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Suggestions onPick={onPickSuggestion} />
          </EmptyContent>
        </Empty>
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <TriangleAlertIcon />
            <AlertTitle>Request failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    );
  }

  return (
    <MessageScrollerProvider>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport className="p-6">
          <MessageScrollerContent>
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
              <Marker role="status" aria-live="polite">
                <MarkerIcon>
                  <BotIcon className="animate-pulse" />
                </MarkerIcon>
                <MarkerContent>Thinking… ({runStatus})</MarkerContent>
              </Marker>
            ) : null}
            {runError ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Run failed</AlertTitle>
                <AlertDescription>{runError}</AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
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
  );
}
