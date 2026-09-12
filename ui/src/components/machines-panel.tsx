import type { MachineRecord } from "@/lib/state-schema";
import { Badge } from "@/components/ui/badge";

interface Props {
  machines: MachineRecord[];
}

export function MachinesPanel({ machines }: Props) {
  if (!machines.length) {
    return <p className="text-sm text-muted-foreground">No machines enrolled yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {machines.map((machine) => (
        <li
          key={machine.id}
          className="rounded-[var(--radius-well)] border border-border bg-[var(--inset)] p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{machine.name}</span>
            <Badge variant="outline">{machine.status}</Badge>
          </div>
          <p className="machine mt-1 text-muted-foreground">{machine.id}</p>
        </li>
      ))}
    </ul>
  );
}
