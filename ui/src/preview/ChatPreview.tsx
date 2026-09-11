import { useChat } from "@tanstack/ai-react";
import { ArrowUpIcon } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";
import { previewChat, previewConnection, previewInitialMessages } from "./chat-fixture";

/**
 * DEV-only deterministic chat preview. Same voice as prod ChatPane,
 * driven by @shadcn/helpers/tanstack-ai local transport.
 * Guarded by import.meta.env.DEV + ?preview=1.
 */
export function ChatPreview() {
  const { messages, append, sendMessage, status } = useChat({
    initialMessages: previewInitialMessages,
    connection: previewConnection,
  });
  const [input, setInput] = useState("");
  const nextMessage = previewChat.next(messages);
  const isBusy = status === "submitted" || status === "streaming";

  return (
    <div className="mx-auto flex h-dvh max-h-dvh max-w-3xl flex-col overflow-hidden bg-[var(--bench)]">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span className="machine text-muted-foreground">preview — offline, no model</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!nextMessage || isBusy}
          onClick={() => {
            if (nextMessage && !isBusy) void append(nextMessage);
          }}
        >
          Send next scripted message
        </Button>
      </div>

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
                        {message.parts.map((part, index) =>
                          part.type === "text" ? (
                            <Markdown key={index} content={part.content} />
                          ) : null,
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full max-w-[68ch] flex-col gap-2 text-[15px] leading-relaxed">
                      {message.parts.map((part, index) => {
                        if (part.type === "text") {
                          return <Markdown key={index} content={part.content} />;
                        }
                        if (part.type === "thinking") {
                          return (
                            <p key={index} className="text-sm text-muted-foreground italic">
                              {part.content}
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
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton direction="end" />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        className="shrink-0 border-t border-border bg-[var(--raised)]/40 px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() || isBusy) return;
          const next = input;
          setInput("");
          void sendMessage(next);
        }}
      >
        <InputGroup className="rounded-[var(--radius-card)] border border-border bg-[var(--inset)]">
          <InputGroupTextarea
            rows={2}
            value={input}
            aria-label="Preview message"
            placeholder="Free input (uses fallback transport)…"
            className="max-h-40 overflow-y-auto"
            onChange={(event) => setInput(event.target.value)}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton type="submit" size="sm" disabled={!input.trim() || isBusy}>
              <ArrowUpIcon />
              Send
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
