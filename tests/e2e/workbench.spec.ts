import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const shots = "docs/screenshots";
mkdirSync(shots, { recursive: true });

test("workbench login and fixture chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Application agent" })).toBeVisible();
  await expect(page.getByText(/fixture model|live model/i)).toBeVisible();
  await page.screenshot({ path: `${shots}/01-login.png`, fullPage: true });

  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page.getByText(/fixture|live/i).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Chats" })).toBeVisible();
  await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Stop/i })).toBeVisible();

  // Ensure an active bootstrapped cell before chatting.
  await page.getByRole("button", { name: /New chat/i }).click();
  await expect(page.getByText("What should we do?")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/chat not found/i)).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeInViewport();
  await page.screenshot({ path: `${shots}/02-empty-workbench.png`, fullPage: true });

  await composer.fill("Inspect current state.");
  await page.getByRole("button", { name: /^Send$/i }).click();
  await expect(page.getByText(/idle|running|completed|queued/i).first()).toBeVisible();
  await expect(page.getByText("Inspect current state.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(composer).toBeInViewport();
  await page.screenshot({ path: `${shots}/03-fixture-chat.png`, fullPage: true });

  await page.getByRole("button", { name: /New chat/i }).click();
  await expect(page.getByText("What should we do?")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/chat not found/i)).toHaveCount(0);
  await expect(composer).toBeInViewport();

  // Narrow viewport: close the drawer via its own Close control (header toggle can be covered).
  await page.setViewportSize({ width: 390, height: 844 });
  const closeInspector = page.getByRole("button", { name: /Close inspector/i });
  if (await closeInspector.isVisible()) {
    await closeInspector.click();
  }
  await expect(composer).toBeInViewport();

  await page.setViewportSize({ width: 1280, height: 720 });
  const showInspector = page.getByRole("button", { name: /Show inspector/i });
  if (await showInspector.isVisible()) {
    await showInspector.click();
  }
  await page.getByRole("tab", { name: "Trace" }).click();
  await page.screenshot({ path: `${shots}/04-trace.png`, fullPage: true });
});
