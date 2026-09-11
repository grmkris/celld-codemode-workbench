import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const shots = "docs/screenshots";
mkdirSync(shots, { recursive: true });

test("workbench login and fixture chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Application agent" })).toBeVisible();
  await expect(page.getByText(/Fixture model|Live model/)).toBeVisible();
  await page.screenshot({ path: `${shots}/01-login.png`, fullPage: true });

  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page.getByText(/fixture|live/i)).toBeVisible();
  await expect(page.getByText("Chats", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
  await expect(page.getByText(/None pending|No approvals/i)).toBeVisible();
  await page.screenshot({ path: `${shots}/02-empty-workbench.png`, fullPage: true });

  await page.getByRole("textbox").fill("Inspect current state.");
  await page.getByRole("button", { name: /Send/i }).click();
  await expect(page.getByText(/idle|running|completed|queued/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Stop/i })).toBeVisible();
  await expect(page.getByText(/user|Inspect current state/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.screenshot({ path: `${shots}/03-fixture-chat.png`, fullPage: true });

  await page.getByRole("button", { name: /New chat/i }).click();
  await expect(page.getByText(/Each chat is its own cell|What are we working on/i)).toBeVisible({
    timeout: 10_000,
  });

  await page
    .getByRole("tab", { name: /Snippets|State|Schedules|Trace/i })
    .first()
    .click();
  await page.screenshot({ path: `${shots}/04-trace.png`, fullPage: true });
});
