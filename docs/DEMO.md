# Demo recipe

Use fixture mode unless a live key is configured. The interpreter and host
path are real either way.

1. `npm run dev` and open `http://127.0.0.1:9876`.
2. Log in as `operator` / `dev-change-me`.
3. Confirm the mode pill: `fixture` or `live`. The left rail lists chats; the
   first visit seeds `default`.
4. Click **New chat** to open a second cell (its own memory / snippets). Switch
   with the list or `?c=<chatId>`.
5. Send: "Remember that this project's priority is reliability. Create three maintenance tasks."
6. Open **State**. Memory and tasks should persist after refresh.
7. Send: "Write and test a reusable program that lists unfinished tasks and saves a maintenance summary. Activate it."
8. Open **Snippets**. Invoke the saved version without another model call.
9. Open **Schedules** and schedule the active snippet. Restart `celld dev`.
   Exactly one successful occurrence should appear; do not double-send.
10. Ask to deliver the summary to the demo integration. Approve or deny in the rail.
11. Ask for a broken revision, then a valid one, then roll back. Failed tests
    must not become active.
12. **Clear application state** (owner HTTP, not Code Mode) deletes memory and
    tasks, deactivates snippets, and cancels schedules for the **active chat**.
    Completing a task is not a reset; done tasks stay stored until you clear or
    `tasks_delete`.

Synthetic fixture screenshots (Playwright, no provider key):

- `docs/screenshots/01-login.png`
- `docs/screenshots/02-empty-workbench.png`
- `docs/screenshots/03-fixture-chat.png`
- `docs/screenshots/04-trace.png`
