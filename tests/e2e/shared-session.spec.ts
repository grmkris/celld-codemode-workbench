import { expect, test, type Page } from "@playwright/test";

async function streamsHealthy(): Promise<boolean> {
  const base = process.env.STREAMS_BASE_URL ?? "http://127.0.0.1:4437";
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_500) });
    return response.ok || response.status === 404;
  } catch {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1_500) });
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  }
}

async function ensureWorkbench(page: Page, baseURL: string | undefined) {
  await page.goto(baseURL ?? "/");
  const enter = page.getByRole("button", { name: "Enter" });
  if (await enter.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await enter.click();
  }
  await expect(page.getByRole("navigation", { name: "Chats" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled({
    timeout: 20_000,
  });
}

async function activeChatId(page: Page): Promise<string> {
  const active = page.getByRole("navigation", { name: "Chats" }).locator('[aria-current="page"]');
  await expect(active).toBeVisible({ timeout: 10_000 });
  const text = (await active.innerText()).trim();
  return text.split("\n")[0]?.trim() ?? text;
}

test.describe("shared session (multi-tab)", () => {
  test("two tabs see the same assistant reply", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    if (process.env.STREAMS_E2E_REQUIRED === "1") {
      const ok = await streamsHealthy();
      if (!ok) {
        testInfo.skip(true, "STREAMS_E2E_REQUIRED=1 but streams sidecar is not reachable");
      }
    }

    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await ensureWorkbench(pageA, baseURL);
    await ensureWorkbench(pageB, baseURL);

    // Force both tabs onto A's active conversation (URL/`localStorage` can lag).
    const chatId = await activeChatId(pageA);
    await pageA.goto(`/?c=${encodeURIComponent(chatId)}`);
    await pageB.goto(`/?c=${encodeURIComponent(chatId)}`);
    await expect(pageA.getByRole("heading", { name: chatId })).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByRole("heading", { name: chatId })).toBeVisible({ timeout: 15_000 });

    const prompt = `Shared session probe ${Date.now()}`;
    const composerA = pageA.getByRole("textbox", { name: "Message" });
    await composerA.click();
    await composerA.fill(prompt);
    const sendA = pageA.getByRole("button", { name: /^Send$/i });
    await expect(sendA).toBeEnabled({ timeout: 10_000 });
    await sendA.click();

    await expect(pageA.getByText(prompt).first()).toBeVisible({ timeout: 20_000 });
    // Live stream should deliver the user echo to the second tab without a reload.
    await expect(pageB.getByText(prompt).first()).toBeVisible({ timeout: 30_000 });

    const assistantPattern =
      /fixture|Inspect|idle|running|completed|finished|maintenance|Code Mode finished/i;
    await expect(pageA.getByText(assistantPattern).first()).toBeVisible({ timeout: 45_000 });
    await expect(pageB.getByText(assistantPattern).first()).toBeVisible({ timeout: 45_000 });

    await context.close();
  });
});
