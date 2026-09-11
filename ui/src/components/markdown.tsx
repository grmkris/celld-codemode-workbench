import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeText } from "@/lib/events";

export function Markdown({ content }: { content: string }) {
  const text = safeText(content);
  // Plain text without markdown markers renders faster as-is.
  if (!/(\*\*|##|```|\[.+?\]\(|^\s*[-*]|\d+\.\s)/m.test(text)) {
    return <div className="whitespace-pre-wrap">{text}</div>;
  }
  return (
    <div className="typeset">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
