# Workbench UI

The operator workbench is a Vite + React 19 SPA under `ui/`. It talks to the
Worker over REST; it does not run a second AI engine in the browser.

## Stack

| Layer       | Library                         | Notes                                                    |
| ----------- | ------------------------------- | -------------------------------------------------------- |
| Bundler     | Vite 7                          | Root `ui/`, output `dist/ui`                             |
| UI          | React 19                        | Mounted from `ui/src/main.tsx`                           |
| Styling     | Tailwind CSS v4                 | `@tailwindcss/vite`, theme in `ui/src/styles.css`        |
| Components  | shadcn (`base-rhea`)            | Config in `components.json`                              |
| Primitives  | `@base-ui/react`                | Button, Input, Dialog, Select, ScrollArea, Tabs, Tooltip |
| Chat kit    | `@shadcn/react`                 | `MessageScroller` and related chatbot-template pieces    |
| Class merge | `cn`                            | Used by generated `ui/src/components/ui/*`               |
| Icons       | `lucide-react`                  |                                                          |
| Markdown    | `react-markdown` + `remark-gfm` | Message bodies                                           |

Installed from the [chatbot template](https://github.com/shadcn-ui/chatbot-template)
and customized in-repo. Re-run `npx shadcn add …` carefully; local copies under
`ui/src/components/ui/` may already diverge (borders, focus targets, height).

Library contracts (MessageScroller height chain, InputGroup rules, TanStack AI
roles): [`docs/UI-LIBRARIES.md`](UI-LIBRARIES.md).

### Used in production

- `InputGroup` / `InputGroupTextarea` — composer in `prompt-form.tsx`
- `MessageScroller*` — transcript in `chat-pane.tsx`
- `Empty`, `Alert`, `Button`, `Tabs`, `ScrollArea`, `Badge`, `Switch`

### Installed but unused in production

- `Bubble`, `Message`, `Questionnaire`, `Attachment`, `Marker` — kept for the
  DEV preview / future ports; do not wire a second chat stack around them.

## Chat transport

**Production** (`App` → `useWorkbench`):

1. `POST /api/agents/:id/chat`
2. `GET /api/agents/:id/snapshot`
3. Long-poll style `GET /api/agents/:id/events?after=&wait=1`

There is no client `useChat` on the workbench path.

**Server AI** stays in `worker/runtime.ts` via TanStack `chat()`. Do not add a
second AI/workflow engine beside that loop (`AGENTS.md`).

**Preview only** (`?preview=1` in DEV): `ui/src/preview/ChatPreview.tsx` uses
`@tanstack/ai-react` + `@shadcn/helpers/tanstack-ai` with a scripted local
transport. It is for UI development, not the live celld lease.

## Layout contract

`MessageScroller` fills its parent. The parent chain must be height-locked:

```
html, body, #root → height 100%
shell → h-dvh max-h-dvh overflow-hidden flex
rail / main / inspector → min-h-0
chat column → flex-1 min-h-0 flex-col
PromptForm → shrink-0 sibling under the chat column
```

Do not use `min-h-screen` alone for the shell. Unbounded flex growth pushes the
composer below the viewport. Until MessageScroller applies its initial scroll
position, the viewport may carry `data-pending-scroll` (styled `invisible`); a
missing height lock makes that look like a blank or missing input area.

The inspector is a drawer: fixed overlay below `lg`, in-flow beside `main` at
`lg+`. Default open only on large screens so mobile does not cover the composer.
Below `lg` the drawer includes a Close control (the header toggle can sit under
the overlay).

## Composer

`PromptForm` wraps shadcn `InputGroup`. Always mounted when authenticated.
Visible `border-border`, capped textarea height (`max-h-40`), Enter to send
(Shift+Enter newline). Addon clicks focus `[data-slot=input-group-control]`.
