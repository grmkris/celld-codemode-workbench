import { expect, test } from "@playwright/test";

/**
 * Skeleton coverage for Part I multi-tab scenarios. Full Caddy h2 five-tab
 * matrix is documented in docs/STREAMS.md; this file keeps a cheap Chromium
 * smoke that exercises shared REST snapshot convergence without requiring the
 * streams sidecar.
 */
test.describe("multi-tab skeleton", () => {
  test("five tabs share one conversation id after create", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(
      process.env.MULTI_TAB_E2E !== "1",
      "Set MULTI_TAB_E2E=1 for the five-tab directory convergence smoke",
    );
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const pages = await Promise.all(Array.from({ length: 5 }, () => context.newPage()));

    for (const page of pages) {
      await page.goto(baseURL ?? "/");
      await page.getByRole("button", { name: "Enter" }).click();
      await expect(page.getByRole("navigation", { name: "Chats" })).toBeVisible({
        timeout: 20_000,
      });
    }

    const lead = pages[0];
    const nav = lead.getByRole("navigation", { name: "Chats" });
    await expect(nav.getByRole("button").first()).toBeVisible();
    const before = await nav.getByRole("button").count();
    const created = lead.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/chats\/?$/.test(new URL(response.url()).pathname) &&
        response.ok(),
    );
    await lead.getByRole("button", { name: /New chat/i }).click();
    await created;
    await expect(nav.getByRole("button")).toHaveCount(before + 1, { timeout: 20_000 });

    const active = nav.locator('[aria-current="page"]');
    await expect(active).toBeVisible();
    const title = (await active.innerText()).trim();
    expect(title.length).toBeGreaterThan(0);

    // Other tabs refresh the directory on an interval; force a reload so the
    // new chat appears without waiting on the 5s poll.
    for (const page of pages.slice(1)) {
      await page.reload();
      await expect(
        page.getByRole("navigation", { name: "Chats" }).getByRole("button", {
          name: new RegExp(title.slice(0, 8), "i"),
        }),
      ).toBeVisible({ timeout: 20_000 });
    }

    await context.close();
  });
});
