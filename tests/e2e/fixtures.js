const { test: base, expect } = require("@playwright/test");
const remoteReplayUrl = "https://replays.example.test/long-game.rep";

// Exercise the real MPQ loader without repeatedly downloading 90 MB from Pages.
const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => { window.OPENBW_MPQ_BASE_URL = location.origin + "/bw"; });
    await page.route(remoteReplayUrl, route => route.fulfill({
      path: "/workspace/replays/Hannes Bredberg vs VOID La Mancha1.1 (Nukes).rep",
      contentType: "application/octet-stream",
      headers: { "access-control-allow-origin": "*" }
    }));
    await use(page);
  }
});

module.exports = { test, expect, remoteReplayUrl };
