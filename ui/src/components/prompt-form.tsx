import { ArrowUpIcon } from "lucide-react";
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
}

export function PromptForm({ value, busy, live, provider, onChange, onSend }: Props) {
  return (
    <form
      className="border-t border-border bg-[var(--raised)]/40 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && value.trim()) onSend();
      }}
    >
      <InputGroup className="rounded-[var(--radius-card)] border-border bg-[var(--inset)]">
        <InputGroupTextarea
          rows={3}
          value={value}
          aria-label="Message"
          placeholder="Ask the agent…"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="justify-between">
          <span className="machine text-muted-foreground">
            {live ? `live ${provider}` : "fixture"} — ⌘/Ctrl+Enter
          </span>
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
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
