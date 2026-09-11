import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { Markdown } from "@/components/markdown";
import type { SnapshotMessage } from "@/lib/types";

export function ChatMessage({ message }: { message: SnapshotMessage }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <Message align="end">
        <MessageContent>
          <MessageHeader className="justify-end">{message.role}</MessageHeader>
          <Bubble variant="default" align="end">
            <BubbleContent>
              <Markdown content={message.content} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  return (
    <Message align="start">
      <MessageContent>
        <MessageHeader>{message.role}</MessageHeader>
        <Bubble variant="secondary" align="start" className="max-w-full">
          <BubbleContent className="max-w-full">
            <Markdown content={message.content} />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
