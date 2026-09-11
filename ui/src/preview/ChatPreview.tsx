import { useChat } from "@tanstack/ai-react";
import { ArrowUpIcon } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { useState } from "react";
import { previewChat, previewConnection, previewInitialMessages } from "./chat-fixture";

/**
 * DEV-only deterministic chat preview. Same Bubble/Message primitives as
 * prod ChatPane, but driven by @shadcn/helpers/tanstack-ai local transport.
 * Never ships in prod (guarded by import.meta.env.DEV + ?preview=1).
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
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Badge variant="secondary">preview</Badge>
        <span className="font-mono text-xs text-muted-foreground">
          Offline deterministic chat · no model, no network
        </span>
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
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="p-6">
            <MessageScrollerContent>
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  id={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <Message align={message.role === "user" ? "end" : "start"}>
                    <MessageContent>
                      <MessageHeader>{message.role}</MessageHeader>
                      {message.parts.map((part, index) => {
                        if (part.type === "text") {
                          return (
                            <Bubble
                              key={index}
                              variant={message.role === "user" ? "default" : "secondary"}
                            >
                              <BubbleContent>
                                <Markdown content={part.content} />
                              </BubbleContent>
                            </Bubble>
                          );
                        }
                        if (part.type === "thinking") {
                          return (
                            <Marker key={index}>
                              <MarkerIcon>💭</MarkerIcon>
                              <MarkerContent className="font-mono text-xs">
                                {part.content}
                              </MarkerContent>
                            </Marker>
                          );
                        }
                        if (part.type === "tool-call") {
                          return (
                            <Bubble key={index} variant="outline">
                              <BubbleContent>
                                <span className="font-mono text-xs">
                                  tool: {"name" in part ? String(part.name) : "tool"}
                                </span>
                              </BubbleContent>
                            </Bubble>
                          );
                        }
                        return null;
                      })}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
              {isBusy ? (
                <Marker role="status">
                  <MarkerContent>Streaming…</MarkerContent>
                </Marker>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton direction="end" />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        className="border-t border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() || isBusy) return;
          const next = input;
          setInput("");
          void sendMessage(next);
        }}
      >
        <InputGroup>
          <InputGroupTextarea
            rows={2}
            value={input}
            aria-label="Preview message"
            placeholder="Free input (uses fallback transport)…"
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
