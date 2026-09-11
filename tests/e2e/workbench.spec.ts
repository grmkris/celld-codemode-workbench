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
  await expect(page.getByText(/fixture|live/)).toBeVisible();
  await expect(page.getByText("None pending.")).toBeVisible();
  await expect(page.getByText("No memory yet.")).toBeVisible();
  await page.screenshot({ path: `${shots}/02-empty-workbench.png`, fullPage: true });

  await page.getByLabel("Message").fill("Inspect current state.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/idle|running|completed|queued/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByText("user", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${shots}/03-fixture-chat.png`, fullPage: true });

  await page.getByRole("button", { name: "Snippets" }).click();
  await expect(page.getByRole("heading", { name: "Saved programs" })).toBeVisible();
  await page.getByRole("button", { name: "Schedules" }).click();
  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible();
  await page.getByRole("button", { name: "Trace" }).click();
  await expect(page.getByRole("heading", { name: "Observable actions" })).toBeVisible();
  await page.screenshot({ path: `${shots}/04-trace.png`, fullPage: true });
});
