import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  { label: "Remember priority", text: "Remember that this project's priority is reliability." },
  { label: "Create tasks", text: "Create three maintenance tasks." },
  { label: "Write a snippet", text: "Write a snippet that summarizes open tasks." },
];

export function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {SUGGESTIONS.map((item) => (
        <Button
          key={item.label}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPick(item.text)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
