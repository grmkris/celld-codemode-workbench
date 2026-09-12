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

async function login(page: Page, baseURL: string | undefined) {
  await page.goto(baseURL ?? "/");
  const enter = page.getByRole("button", { name: "Enter" });
  if (await enter.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await enter.click();
  }
  await expect(page.getByRole("navigation", { name: "Chats" })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("team state stream", () => {
  test("rename appears in second tab without reload", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    if (process.env.STREAMS_E2E_REQUIRED === "1") {
      const ok = await streamsHealthy();
      if (!ok) {
        testInfo.skip(true, "STREAMS_E2E_REQUIRED=1 but streams sidecar is not reachable");
      }
    }

    const context = await browser.newContext();
    const pageA = await context.newPage();
    await login(pageA, baseURL);

    const token = await pageA.evaluate(() => localStorage.getItem("celld_token"));
    expect(token).toBeTruthy();

    const boot = await pageA.request.post("/api/teams/bootstrap-personal", {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    });
    expect(boot.ok()).toBeTruthy();
    const bootBody = (await boot.json()) as { team?: { id?: string } };
    const teamId = String(bootBody.team?.id ?? "");
    expect(teamId).toBeTruthy();

    const seedTitle = `Stream rename seed ${Date.now()}`;
    const created = await pageA.request.post(`/api/teams/${teamId}/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: seedTitle },
    });
    expect(created.ok()).toBeTruthy();
    const createdBody = (await created.json()) as { conversation?: { id?: string } };
    const conversationId = String(createdBody.conversation?.id ?? "");
    expect(conversationId).toBeTruthy();

    const teamPath = `/t/${encodeURIComponent(teamId)}/c/${encodeURIComponent(conversationId)}`;
    await pageA.goto(teamPath);
    await expect(pageA.getByRole("navigation", { name: "Chats" })).toBeVisible({
      timeout: 20_000,
    });
    const chatNavA = pageA.getByRole("navigation", { name: "Chats" });
    await expect(chatNavA.getByRole("button", { name: seedTitle })).toBeVisible({
      timeout: 20_000,
    });

    const pageB = await context.newPage();
    await pageB.goto(teamPath);
    await expect(pageB.getByRole("navigation", { name: "Chats" })).toBeVisible({
      timeout: 20_000,
    });
    const chatNavB = pageB.getByRole("navigation", { name: "Chats" });
    await expect(chatNavB.getByRole("button", { name: seedTitle })).toBeVisible({
      timeout: 20_000,
    });

    const renamed = `Renamed live ${Date.now()}`;
    pageA.once("dialog", async (dialog) => {
      await dialog.accept(renamed);
    });
    await chatNavA.getByRole("button", { name: seedTitle }).dblclick();

    await expect(chatNavB.getByRole("button", { name: renamed })).toBeVisible({
      timeout: 20_000,
    });
  });
});
