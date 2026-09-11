import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  ownerId: string;
  agentId: string;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

export function SessionHeader({
  title,
  ownerId,
  agentId,
  inspectorOpen,
  onToggleInspector,
}: Props) {
  return (
    <header className="flex items-start gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[1.75rem] leading-8 font-semibold tracking-tight">{title}</h1>
        <p className="machine mt-1 text-muted-foreground">
          {ownerId}/{agentId}
        </p>
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={onToggleInspector}
        aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"}
        aria-pressed={inspectorOpen}
        className="shrink-0"
      >
        {inspectorOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
      </Button>
    </header>
  );
}
