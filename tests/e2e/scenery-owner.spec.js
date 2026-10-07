const { test, expect } = require("@playwright/test");
const path = require("node:path");

test("Roadkill scenery with owner 12 renders without stopping replay playback", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.viewerToggleSettings = JSON.stringify({ observerEnabled: false, fowEnabled: true, forceRedBlueEnabled: false });
    localStorage.volumeSettings = JSON.stringify({ level: 0, muted: true });
    localStorage.zoomLevel = "0";
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator("#select_replay_label")).not.toHaveClass(/disabled/, { timeout: 30000 });
  await page.setInputFiles("#select_rep_file", path.join(__dirname, "../fixtures/roadkill-scenery-owner-12.rep"));
  await expect.poll(() => page.evaluate(() => _replay_get_value(4)), { timeout: 30000 }).toBeGreaterThan(0);
  await page.evaluate(() => {
    _replay_set_value(1, 1);
    _observer_set_value(0);
    // The failing map decoration is at (2624, 912), outside some initial views.
    _ui_set_screen_center(2624, 912);
    _ui_force_static_redraw();
  });
  for (const forcedColors of [0, 1]) {
    await page.evaluate(forced => {
      _force_red_blue_colors_set_value(forced);
      _ui_force_static_redraw();
    }, forcedColors);
    const before = await page.evaluate(() => _ui_get_present_count());
    await page.evaluate(() => _ui_force_static_redraw());
    expect(await page.evaluate(() => _ui_get_present_count())).toBeGreaterThan(before);
  }
  await page.screenshot({ path: "test-results/roadkill-scenery-render.png" });
  const frame = await page.evaluate(() => _replay_get_value(2));
  await page.evaluate(() => { _replay_set_value(1, 0); resume_viewer_main_loop(); });
  await expect.poll(() => page.evaluate(() => _replay_get_value(2))).toBeGreaterThan(frame + 24);
  expect(errors).toEqual([]);
});
