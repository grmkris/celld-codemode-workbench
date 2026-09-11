import { BellIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Snapshot } from "@/lib/types";

export function NotificationsCard({ notifications }: { notifications: Snapshot["notifications"] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
          <BellIcon className="size-4" />
          Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {notifications.map((item) => (
          <div key={item.id} className="rounded-xl border border-border bg-muted/30 p-2.5 text-sm">
            {item.message}
          </div>
        ))}
        {notifications.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground">No delivered effects.</p>
        )}
      </CardContent>
    </Card>
  );
}
