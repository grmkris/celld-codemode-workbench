import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const shots = "docs/screenshots";
mkdirSync(shots, { recursive: true });

async function chatCount(page: Page): Promise<number> {
  return page.getByRole("navigation", { name: "Chats" }).getByRole("button").count();
}

async function waitForNewChat(page: Page) {
  const nav = page.getByRole("navigation", { name: "Chats" });
  await expect(nav.getByRole("button").first()).toBeVisible({ timeout: 20_000 });
  const before = await chatCount(page);

  await page.getByRole("button", { name: /New chat/i }).click();
  await expect.poll(async () => chatCount(page), { timeout: 20_000 }).toBe(before + 1);

  await expect(page.getByText("What should we do?")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/chat not found/i)).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeEnabled({ timeout: 10_000 });
  return composer;
}

test("workbench login and fixture chat", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Application agent" })).toBeVisible();
  await expect(page.getByText(/fixture model|live model/i)).toBeVisible();
  await page.screenshot({ path: `${shots}/01-login.png`, fullPage: true });

  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page.getByText(/fixture|live/i).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Chats" })).toBeVisible();
  await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Stop/i })).toBeVisible();
  // Wait until directory bootstrap finished (New chat enabled, ≥1 chat).
  await expect(page.getByRole("button", { name: /New chat/i })).toBeEnabled({
    timeout: 20_000,
  });
  await expect.poll(async () => chatCount(page), { timeout: 20_000 }).toBeGreaterThan(0);

  const composer = await waitForNewChat(page);
  await page.screenshot({ path: `${shots}/02-empty-workbench.png`, fullPage: true });

  await composer.click();
  await composer.fill("Inspect current state.");
  const send = page.getByRole("button", { name: /^Send$/i });
  await expect(send).toBeEnabled({ timeout: 10_000 });
  await send.click();
  await expect(
    page.getByText(/idle|running|completed|queued|finished|sending/i).first(),
  ).toBeVisible();
  await expect(page.getByText("Inspect current state.").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(composer).toBeInViewport();
  await page.screenshot({ path: `${shots}/03-fixture-chat.png`, fullPage: true });

  await waitForNewChat(page);
  await expect(composer).toBeInViewport();

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
