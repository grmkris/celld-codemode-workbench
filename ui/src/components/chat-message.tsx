import { Markdown } from "@/components/markdown";
import type { SnapshotMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChatMessage({ message }: { message: SnapshotMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            "max-w-[min(68ch,85%)] rounded-[var(--radius-card)] border border-[var(--ember)]/35",
            "bg-[var(--ember)]/15 px-3.5 py-2.5 text-[15px] leading-relaxed",
          )}
        >
          <Markdown content={message.content} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[68ch] text-[15px] leading-relaxed">
      <Markdown content={message.content} />
    </div>
  );
}
