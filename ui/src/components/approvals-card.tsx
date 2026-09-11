import { ShieldAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Snapshot } from "@/lib/types";

interface Props {
  approvals: Snapshot["approvals"];
  onDecide: (id: string, decision: "approve" | "deny") => void;
}

export function ApprovalsCard({ approvals, onDecide }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
          <ShieldAlertIcon className="size-4" />
          Approvals
          {approvals.length > 0 ? <Badge variant="secondary">{approvals.length}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {approvals.map((item) => (
          <div key={item.id} className="rounded-xl border border-border bg-muted/30 p-2.5">
            <div className="font-mono text-xs text-muted-foreground">{item.capability}</div>
            <pre className="mt-1 max-h-24 overflow-auto font-mono text-xs">{item.args_json}</pre>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => onDecide(item.id, "approve")}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDecide(item.id, "deny")}>
                Deny
              </Button>
            </div>
          </div>
        ))}
        {approvals.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground">None pending.</p>
        )}
      </CardContent>
    </Card>
  );
}
