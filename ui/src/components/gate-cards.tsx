import { Button } from "@/components/ui/button";
import type { Snapshot } from "@/lib/types";

interface Props {
  approvals: Snapshot["approvals"];
  onDecide: (id: string, decision: "approve" | "deny") => void;
}

export function GateCards({ approvals, onDecide }: Props) {
  if (!approvals.length) return null;

  return (
    <div className="flex flex-col gap-2 px-5 pt-4" role="region" aria-label="Pending approvals">
      {approvals.map((item) => (
        <div
          key={item.id}
          className="rounded-[var(--radius-card)] border border-[var(--run-failed)]/50 bg-[var(--raised)] p-3.5"
        >
          <p className="text-sm font-medium">Approval needed</p>
          <p className="machine mt-1 text-muted-foreground">{item.capability}</p>
          <pre className="machine mt-2 max-h-28 overflow-auto rounded-[var(--radius-well)] border border-border bg-[var(--inset)] p-2.5">
            {item.args_json}
          </pre>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => onDecide(item.id, "approve")}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDecide(item.id, "deny")}>
              Deny
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
