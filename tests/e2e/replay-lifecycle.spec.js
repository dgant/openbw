const { test, expect } = require("@playwright/test");
const path = require("node:path");

const replayPath = path.join(__dirname, "../fixtures/elimination-0145.rep");

test.beforeEach(async ({ page }) => {
  page.lifecycleErrors = [];
  page.on("pageerror", error => page.lifecycleErrors.push(String(error)));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) page.lifecycleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.viewerToggleSettings = JSON.stringify({ observerEnabled: true, fowEnabled: true, forceRedBlueEnabled: true });
    localStorage.volumeSettings = JSON.stringify({ level: 0, muted: true });
    localStorage.audioCategorySettings = JSON.stringify({ combat: { enabled: false }, acknowledgements: { enabled: false }, music: { enabled: false } });
    localStorage.zoomLevel = "0";
  });
  await page.setViewportSize({ width: 1280, height: 900 });
});

test.afterEach(async ({ page }) => {
  expect(page.lifecycleErrors).toEqual([]);
});

async function loadReplay(page) {
  await page.goto("/");
  await expect(page.locator("#select_replay_label")).not.toHaveClass(/disabled/, { timeout: 30000 });
  await page.setInputFiles("#select_rep_file", replayPath);
  await expect.poll(() => page.evaluate(() => _replay_get_value(4)), { timeout: 30000 }).toBeGreaterThan(0);
}

async function seekEnd(page) {
  await page.evaluate(() => {
    _replay_set_value(1, 1);
    _replay_set_value(3, _replay_get_value(4));
    resume_viewer_main_loop();
  });
  await expect.poll(() => page.evaluate(() => _replay_get_value(2) === _replay_get_value(4)), { timeout: 180000 }).toBe(true);
}

test("elimination preserves colors and manual camera control through replay end and rewind", async ({ page }) => {
  test.setTimeout(240000);
  await loadReplay(page);
  expect(await page.evaluate(() => players.map(player => _player_get_value(player, C_COLOR)))).toEqual([0, 1]);
  await seekEnd(page);
  const terminal = await page.evaluate(() => ({
    active: players.map(player => _player_get_value(player, C_PLAYER_ACTIVE)),
    colors: players.map(player => _player_get_value(player, C_COLOR))
  }));
  expect(terminal.active).toContain(0);
  expect.soft(terminal.colors).toEqual([0, 1]);
  await page.screenshot({ path: "test-results/terminal-replay-colors.png" });
  const minimapColors = await page.evaluate(() => {
    const pixels = Module.canvas.getContext("2d").getImageData(4, Module.canvas.height - 132, 128, 128).data;
    let red = 0, blue = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 244 && pixels[i + 1] === 4 && pixels[i + 2] === 4) red++;
      if (pixels[i] === 12 && pixels[i + 1] === 72 && pixels[i + 2] === 204) blue++;
    }
    return { red, blue };
  });
  expect.soft(minimapColors.red).toBeGreaterThan(0);
  expect.soft(minimapColors.blue).toBeGreaterThan(0);
  await page.locator("#rv-rc-force-colors").click();
  const naturalColors = await page.evaluate(() => players.map(player => _player_get_value(player, C_COLOR)));
  expect(naturalColors).not.toEqual([0, 1]);
  await page.locator("#rv-rc-force-colors").click();
  expect.soft(await page.evaluate(() => players.map(player => _player_get_value(player, C_COLOR)))).toEqual([0, 1]);
  for (const forcedColors of [true, false]) {
    if (!forcedColors) await page.locator("#rv-rc-force-colors").click();
    await page.waitForTimeout(800);
    const canvas = await page.locator("#canvas").boundingBox();
    const camera = () => page.evaluate(() => ({ x: _ui_get_screen_pos(0), y: _ui_get_screen_pos(1) }));
    await page.mouse.click(canvas.x + 15, canvas.y + canvas.height - 110);
    await page.waitForTimeout(300);
    const first = await camera();
    await page.mouse.click(canvas.x + 110, canvas.y + canvas.height - 20);
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.waitForTimeout(300);
    const moved = await camera();
    expect.soft(moved.x, `manual camera movement with forced colors ${forcedColors}`).toBeGreaterThan(first.x + 500);
    await page.waitForTimeout(3500);
    expect.soft(await camera()).toEqual(moved);
    expect(await page.evaluate(() => _replay_get_value(2))).toBe(await page.evaluate(() => _replay_get_value(4)));
  }
  await page.locator("#rv-rc-force-colors").click();
  await page.evaluate(() => { _replay_set_value(3, 0); resume_viewer_main_loop(); });
  await expect.poll(() => page.evaluate(() => _replay_get_value(2))).toBe(0);
  expect(await page.evaluate(() => players.map(player => _player_get_value(player, C_COLOR)))).toEqual([0, 1]);
});

for (const width of [1280, 1920]) {
test(`first URL replay shows a complete status bar at frame zero before playback at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/replay?game=GAME_PB_4701EDE9CB_0145", route => route.fulfill({ path: replayPath, contentType: "application/octet-stream" }));
  await page.route("**/v1.4/start.js*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + `
      const originalStartReplayForTest = start_replay;
      start_replay = function(buffer, length) {
        originalStartReplayForTest(buffer, length);
        _replay_set_value(1, 1);
        window.initialStatusFrame = _replay_get_value(2);
      };
    ` });
  });
  await page.goto("/?rep=%2Fapi%2Freplay%3Fgame%3DGAME_PB_4701EDE9CB_0145");
  await page.waitForFunction(() => window.initialStatusFrame !== undefined);
  expect(await page.evaluate(() => initialStatusFrame)).toBe(0);
  const expected = await page.evaluate(() => ({
    map: UTF8ToString(_replay_get_value(5)),
    players: players.map(player => ({ nick: UTF8ToString(_player_get_value(player, C_NICK)), minerals: String(_player_get_value(player, C_CURRENT_MINERALS)) }))
  }));
  expect(expected.players).toHaveLength(2);
  await expect(page.locator("#map2")).toBeVisible();
  await expect(page.locator("#map2")).toHaveText(expected.map);
  for (const [index, player] of expected.players.entries()) {
    await expect(page.locator(`#nick${index + 1}`)).toBeVisible();
    await expect(page.locator(`#nick${index + 1}`)).toHaveText(player.nick);
    await expect(page.locator(`#minerals${index + 1}`)).toBeVisible();
    await expect(page.locator(`#minerals${index + 1}`)).toHaveText(player.minerals);
  }
  await page.screenshot({ path: `test-results/initial-replay-status-${width}.png` });
  expect(await page.evaluate(() => _replay_get_value(2))).toBe(0);
});
}
