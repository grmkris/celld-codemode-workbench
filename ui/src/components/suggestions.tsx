import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "Remember that this project's priority is reliability.",
  "Create three maintenance tasks.",
  "Write a snippet that summarizes open tasks.",
];

export function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {SUGGESTIONS.map((text) => (
        <Button key={text} type="button" variant="outline" size="sm" onClick={() => onPick(text)}>
          {text}
        </Button>
      ))}
    </div>
  );
}
