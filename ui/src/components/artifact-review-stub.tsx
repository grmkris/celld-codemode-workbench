import { Button } from "@/components/ui/button";

interface Props {
  taskId: string;
  teamId: string;
}

/** Placeholder for delegated task artifact review — wired when TaskCell artifacts land. */
export function ArtifactReviewStub({ taskId, teamId }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Task review</h1>
      <p className="text-sm text-muted-foreground">
        Team <span className="machine">{teamId}</span> — task{" "}
        <span className="machine">{taskId}</span>
      </p>
      <p className="text-[15px] leading-relaxed">
        Artifact review UI will list attempt outputs and diffs here. For now this route confirms
        deep-linking into delegated work.
      </p>
      <Button type="button" variant="outline" className="self-start" disabled>
        Approve artifact (stub)
      </Button>
    </div>
  );
}
