import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";

interface Props {
  value: string;
  busy: boolean;
  live: boolean;
  provider: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}

export function PromptForm({ value, busy, live, provider, onChange, onSend, onStop }: Props) {
  return (
    <form
      className="border-t border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && value.trim()) onSend();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          rows={3}
          value={value}
          aria-label="Message"
          placeholder="Ask the agent to remember something, create tasks, or write a snippet…"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <InputGroupAddon align="block-end">
          <span className="font-mono text-xs text-muted-foreground">
            {live ? `live ${provider}` : "fixture"} · ⌘/Ctrl+Enter to send
          </span>
          <div className="ml-auto flex gap-1.5">
            <InputGroupButton
              type="submit"
              size="sm"
              variant="default"
              disabled={busy || !value.trim()}
              aria-label="Send"
            >
              <ArrowUpIcon />
              Send
            </InputGroupButton>
            <InputGroupButton
              type="button"
              size="sm"
              variant="ghost"
              onClick={onStop}
              aria-label="Stop"
            >
              <SquareIcon />
              Stop
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
      <div className="mt-2 flex gap-2 lg:hidden">
        <Button type="submit" disabled={busy || !value.trim()} className="flex-1">
          Send
        </Button>
        <Button type="button" variant="outline" onClick={onStop}>
          Stop
        </Button>
      </div>
    </form>
  );
}
