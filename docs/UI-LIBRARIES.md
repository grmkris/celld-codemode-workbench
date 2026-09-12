# UI libraries

This workbench UI is a Vite + React SPA under `ui/`. Components come from the
shadcn CLI (source-copied into `ui/src/components/ui/`) on top of Base UI, with
chat scrolling from `@shadcn/react`. TanStack AI runs the agent on the worker;
only the DEV chat preview uses `@tanstack/ai-react`.

## Stack

| Layer       | Choice                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| App shell   | React 19 + Vite 7                                                      |
| Components  | shadcn CLI v4, style `base-rhea`, preset code `b27GcrRo`               |
| Primitives  | Base UI (`@base-ui/react`) — use `render`, not Radix `asChild`         |
| Chat scroll | `@shadcn/react` `MessageScroller`                                      |
| Styling     | Tailwind CSS v4; tokens in [`ui/src/styles.css`](../ui/src/styles.css) |
| Icons       | `lucide-react`                                                         |
| Markdown    | `react-markdown` + `remark-gfm`                                        |

Config lives in [`components.json`](../components.json). Refresh project
context with:

```sh
npx shadcn@latest info
npx shadcn@latest docs input-group textarea empty scroll-area
```

Official docs (Base UI variants):

- [Input Group](https://ui.shadcn.com/docs/components/base/input-group)
- [Textarea](https://ui.shadcn.com/docs/components/base/textarea)
- [Empty](https://ui.shadcn.com/docs/components/base/empty)
- [Scroll Area](https://ui.shadcn.com/docs/components/base/scroll-area)

`message-scroller` has no hosted docs page; the contract below is taken from
`node_modules/@shadcn/react/dist/message-scroller/index.d.ts`.

## Viewport height (required)

The chat transcript must scroll **inside** `MessageScroller`, not the document.
That only works when the Root sits in a bounded-height flex chain:

1. `html, body, #root { height: 100% }`
2. App shell: `h-dvh overflow-hidden`
3. `main` / chat column: `min-h-0 flex-1 flex-col`
4. `MessageScroller` root: `flex-1 min-h-0` (via `size-full` + parent height)

If any ancestor only has `min-height` (no definite height), the page grows with
messages, the prompt is pushed below the fold, and the scroller never settles
its initial scroll (see `data-pending-scroll` below).

## MessageScroller (`@shadcn/react`)

Composition (wrappers in [`ui/src/components/ui/message-scroller.tsx`](../ui/src/components/ui/message-scroller.tsx)):

```tsx
<MessageScrollerProvider autoScroll defaultScrollPosition="end">
  <MessageScroller className="flex-1">
    <MessageScrollerViewport>
      <MessageScrollerContent>
        {messages.map((m) => (
          <MessageScrollerItem key={m.id} id={m.id} scrollAnchor={m.role === "user"}>
            …
          </MessageScrollerItem>
        ))}
      </MessageScrollerContent>
    </MessageScrollerViewport>
    <MessageScrollerButton direction="end" />
  </MessageScroller>
</MessageScrollerProvider>
```

| Piece      | Role                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `Provider` | `autoScroll`, `defaultScrollPosition` (`"start" \| "end" \| "last-anchor"`), edge threshold / margin |
| `Root`     | Flex column; may set `data-pending-scroll` until initial position applies                            |
| `Viewport` | The scrollport (`overflow-y-auto`); also may set `data-pending-scroll` / `data-autoscrolling`        |
| `Content`  | Message column; observes mutations for auto-scroll                                                   |
| `Item`     | Optional `scrollAnchor` / `messageId` for jump / last-anchor                                         |
| `Button`   | Jump to start/end; `data-active` when that edge is not already visible                               |

Hooks: `useMessageScroller()`, `useMessageScrollerScrollable()`,
`useMessageScrollerVisibility()`.

State attributes our CSS depends on:

- `data-pending-scroll` — set while the default scroll position has not been
  applied. Our viewport styles use `data-pending-scroll:invisible`, so a broken
  height chain looks like a blank transcript.
- `data-autoscrolling` — set during programmatic scroll; we hide the scrollbar
  thumb/track while it is present.

## InputGroup

Docs: [base/input-group](https://ui.shadcn.com/docs/components/base/input-group).

Rules:

- Always put `InputGroupInput` / `InputGroupTextarea` inside `InputGroup` (they
  set `data-slot="input-group-control"`).
- Buttons and helper text live in `InputGroupAddon` with `align`:
  `inline-start` | `inline-end` | `block-start` | `block-end`.
- The prompt uses `block-end` so the send row sits under the textarea.
- Clicking an addon focuses `[data-slot=input-group-control]` (input or
  textarea), not only `input`.

Prompt wiring: [`ui/src/components/prompt-form.tsx`](../ui/src/components/prompt-form.tsx).

## TanStack AI (not a chat widget)

| Package                                                                      | Where it runs                                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `@tanstack/ai`, `ai-code-mode`, `ai-openai`, `ai-grok`, `ai-isolate-quickjs` | Worker / host — `chat()`, Code Mode, QuickJS                    |
| `@tanstack/ai-client`, `@tanstack/ai-react`                                  | Workbench `useChat` + DEV `?preview=1` ChatPreview              |
| `@durable-streams/tanstack-ai-transport`                                     | `durableStreamConnection` read path; Celld `/commands` for send |

Production workbench transport is `useChat` + Durable Streams (`useAgentChat`),
with SQLite `/snapshot` as the hydrate seed. Panels still use `useWorkbench`
REST for approvals, memory, and stop.

## Related docs

- Operator chrome and visual language: [`docs/UI.md`](UI.md)
- Host / isolate architecture: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
