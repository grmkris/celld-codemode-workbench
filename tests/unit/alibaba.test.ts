import { describe, expect, it } from "vitest";
import { toOpenAIMessages } from "../../worker/alibaba";

describe("alibaba message conversion", () => {
  it("reads TanStack toolCalls.function.name on the follow-up turn", () => {
    const messages = toOpenAIMessages(
      ["sys"],
      [
        { role: "user", content: "store it" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1",
              function: {
                name: "execute_typescript",
                arguments: '{"typescriptCode":"return 1"}',
              },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call_1",
          content: '{"ok":true}',
        },
      ],
    );
    expect(messages[2].tool_calls?.[0].function.name).toBe("execute_typescript");
    expect(messages[3]).toMatchObject({
      role: "tool",
      name: "execute_typescript",
      tool_call_id: "call_1",
      content: '{"ok":true}',
    });
  });
});
