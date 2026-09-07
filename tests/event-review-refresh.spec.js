import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const fixtureEvents = [
  {
    id: "fixture-old-artist",
    date: "2026-09-08",
    venue: "Fixture Hall",
    venueId: "fixture-hall",
    showType: "artist",
    title: "Original Artist",
    displayName: "",
    details: "",
    artists: [{ name: "Original Artist", confidence: "review", tags: ["unknown"], locality: "unknown", links: [] }],
    eventTypes: [],
    themes: [],
    source: { name: "KALX", url: "https://kalx.berkeley.edu/event/fixture-old-artist/" },
    sources: [{ name: "KALX", url: "https://kalx.berkeley.edu/event/fixture-old-artist/" }]
  },
  {
    id: "fixture-duplicate-a",
    date: "2026-09-09",
    venue: "Fixture Hall",
    venueId: "fixture-hall",
    showType: "artist",
    title: "Merge Band",
    displayName: "",
    details: "",
    artists: [{ name: "Merge Band", confidence: "review", tags: ["unknown"], locality: "unknown", links: [] }],
    eventTypes: [],
    themes: [],
    source: { name: "The List", url: "https://example.com/merge-band-a" },
    sources: [{ name: "The List", url: "https://example.com/merge-band-a" }]
  },
  {
    id: "fixture-duplicate-b",
    date: "2026-09-09",
    venue: "Fixture Hall",
    venueId: "fixture-hall",
    showType: "artist",
    title: "Merge Band",
    displayName: "",
    details: "",
    artists: [{ name: "Merge Band", confidence: "review", tags: ["unknown"], locality: "unknown", links: [] }],
    eventTypes: [],
    themes: [],
    source: { name: "KALX", url: "https://kalx.berkeley.edu/event/merge-band-b/" },
    sources: [{ name: "KALX", url: "https://kalx.berkeley.edu/event/merge-band-b/" }]
  }
];

const fixtureVenues = {
  venues: {
    "fixture-hall": {
      id: "fixture-hall",
      name: "Fixture Hall",
      displayName: "Fixture Hall",
      confidence: "verified",
      status: "active",
      venueType: "music"
    }
  }
};

async function loadReviewPage(page, options = {}) {
  const [html, script] = await Promise.all([readFile("event-review.html", "utf8"), readFile("assets/event-review.js", "utf8")]);
  let serverEvents = JSON.parse(JSON.stringify(fixtureEvents));
  await page.addInitScript(() => {
    localStorage.removeItem("bay-area-show-explorer-events");
    localStorage.removeItem("bay-area-show-explorer-recent-events");
  });

  await page.route("http://mikeslist.test/event-review.html", async (route) => {
    await route.fulfill({ contentType: "text/html", body: html });
  });
  await page.route(/http:\/\/mikeslist\.test\/data\/imported-events\.js.*/, async (route) => {
    await route.fulfill({ contentType: "text/javascript", body: `window.SHOW_EXPLORER_EVENTS = ${JSON.stringify(serverEvents)};` });
  });
  await page.route("http://mikeslist.test/data/venues.js", async (route) => {
    await route.fulfill({ contentType: "text/javascript", body: `window.SHOW_EXPLORER_VENUES = ${JSON.stringify(fixtureVenues)};` });
  });
  await page.route("http://mikeslist.test/assets/event-review.js", async (route) => {
    await route.fulfill({ contentType: "text/javascript", body: script });
  });
  await page.route(/http:\/\/mikeslist\.test\/assets\/(auth|nav|theme)\.js/, async (route) => {
    await route.fulfill({ contentType: "text/javascript", body: "" });
  });
  await page.route("http://mikeslist.test/assets/styles.css", async (route) => {
    await route.fulfill({ contentType: "text/css", body: "" });
  });
  await page.route("http://mikeslist.test/api/events", async (route) => {
    const payload = await route.request().postDataJSON();
    if (options.onSave) await options.onSave(route.request());
    if (options.delaySave) await options.delaySave();
    if (!options.keepStaleStore) serverEvents = payload;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, count: payload.length, savedAt: new Date().toISOString() })
    });
  });
  await page.goto("http://mikeslist.test/event-review.html");
  await page.locator("#fromDateInput").fill("2026-09-01");
  await page.locator("#toDateInput").fill("2026-09-30");
  await expect(page.locator("#eventTotal")).toHaveText("3");
}

test("saving artist edits updates the visible queue immediately", async ({ page }) => {
  await loadReviewPage(page);

  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: /Original Artist/ }).click();
  await page.getByLabel("Artists").fill("Replacement Artist");
  await page.getByRole("button", { name: "Save Event" }).click();

  await expect(page.getByRole("button", { name: /Replacement Artist/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Original Artist/ })).toHaveCount(0);
});

test("merging a duplicate updates the current duplicate review section", async ({ page }) => {
  await loadReviewPage(page);

  await page.getByRole("button", { name: "Likely duplicates" }).click();
  await expect(page.locator("#eventQueue .queue-item")).toHaveCount(2);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".duplicate-card").filter({ hasText: "KALX" }).getByRole("button", { name: "Merge into this" }).click();

  await expect(page.locator("#eventQueue .queue-item")).toHaveCount(0);
  await expect(page.getByText("No shows match these filters.")).toBeVisible();
  await expect(page.locator("[data-review-filter='duplicates']")).toHaveClass(/active/);
});

test("a stale in-flight save cannot overwrite a later merge", async ({ page }) => {
  const savedPayloads = [];
  let saveCount = 0;
  await loadReviewPage(page, {
    onSave: async (request) => {
      savedPayloads.push(await request.postDataJSON());
      saveCount += 1;
    },
    delaySave: async () => {
      if (saveCount === 1) await new Promise((resolve) => setTimeout(resolve, 150));
    }
  });

  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: /Original Artist/ }).click();
  await page.getByLabel("Artists").fill("Replacement Artist");
  await page.getByRole("button", { name: "Save Event" }).click();

  await page.getByRole("button", { name: "Likely duplicates" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".duplicate-card").filter({ hasText: "KALX" }).getByRole("button", { name: "Merge into this" }).click();
  await expect(page.getByText("No shows match these filters.")).toBeVisible();
  await expect.poll(() => savedPayloads.length).toBe(2);

  const finalPayload = savedPayloads.at(-1);
  expect(finalPayload.map((event) => event.id)).not.toContain("fixture-duplicate-a");
  expect(finalPayload.map((event) => event.id)).toContain("fixture-duplicate-b");
  expect(finalPayload).toHaveLength(2);
});

test("a mismatched saved file leaves the merged browser copy intact", async ({ page }) => {
  await loadReviewPage(page, { keepStaleStore: true });

  await page.getByRole("button", { name: "Likely duplicates" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".duplicate-card").filter({ hasText: "KALX" }).getByRole("button", { name: "Merge into this" }).click();

  await expect(page.getByRole("complementary", { name: "Shows" }).getByText(/in browser only\. File save failed: Saved show file did not match/)).toBeVisible();
  const draftIds = await page.evaluate(() => JSON.parse(localStorage.getItem("bay-area-show-explorer-events")).map((event) => event.id));
  expect(draftIds).not.toContain("fixture-duplicate-a");
});

test("browser storage quota failure does not block the file save", async ({ page }) => {
  const savedPayloads = [];
  await loadReviewPage(page, {
    onSave: async (request) => {
      savedPayloads.push(await request.postDataJSON());
    }
  });
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === "bay-area-show-explorer-events") throw new DOMException("Quota exceeded", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    };
  });

  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: /Original Artist/ }).click();
  await page.getByLabel("Artists").fill("Replacement Artist");
  await page.getByRole("button", { name: "Save Event" }).click();

  await expect.poll(() => savedPayloads.length).toBe(1);
  expect(savedPayloads[0].find((event) => event.id === "fixture-old-artist").artists[0].name).toBe("Replacement Artist");
  await expect(page.locator("#saveStatus")).toContainText("Saved 3 shows");
});
