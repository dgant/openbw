const { test, expect } = require("./fixtures");
const path = require("node:path");

const tauReplay = "/workspace/replays/PurpleWave vs Monster Tau Cross CTR_41B69CB9.rep";
const gladiatorReplay = path.join(__dirname, "../fixtures/elimination-0145.rep");

async function cameraAtStart(page, start) {
  return page.evaluate(({ x, y }) => {
    const view = JSON.parse(Module.get_observer_debug_summary());
    return {
      actual: [_ui_get_screen_pos(0), _ui_get_screen_pos(1)],
      expected: [
        Math.max(0, Math.min(4096 - view.viewWidth, x - Math.floor(view.viewWidth / 2))),
        Math.max(0, Math.min(4096 - view.viewHeight, y - Math.floor(view.viewHeight / 2)))
      ],
      frame: _replay_get_value(2)
    };
  }, start);
}

async function expectRenderedCamera(page) {
  await expect.poll(() => page.evaluate(() => {
    // Read a copy so test-only pixel sampling does not alter the live context
    // or trigger Chromium's repeated-readback performance warning.
    const canvas = document.createElement("canvas");
    canvas.width = Module.canvas.width;
    canvas.height = Module.canvas.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(Module.canvas, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0, samples = 0;
    for (let i = 0; i < pixels.length; i += 256) {
      samples++;
      if (pixels[i + 3] === 255 && (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240)) painted++;
    }
    return painted / samples;
  })).toBeGreaterThan(0.9);
}

for (const settings of [
  { observerEnabled: false, zoom: 0, width: 1280 },
  { observerEnabled: true, zoom: 0, width: 1280 },
  { observerEnabled: false, zoom: 4, width: 1920 }
]) {
  test(`loads at first player's start: auto-camera ${settings.observerEnabled}, zoom ${settings.zoom}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => {
      if (["error", "warning"].includes(message.type())) errors.push(message.text());
    });
    await page.setViewportSize({ width: settings.width, height: 900 });
    await page.addInitScript(settings => {
      localStorage.viewerToggleSettings = JSON.stringify({ observerEnabled: settings.observerEnabled, fowEnabled: true, forceRedBlueEnabled: true });
      localStorage.zoomLevel = String(settings.zoom);
      localStorage.volumeSettings = JSON.stringify({ level: 0, muted: true });
      localStorage.audioCategorySettings = JSON.stringify({ combat: { enabled: false }, acknowledgements: { enabled: false }, music: { enabled: false } });
    }, settings);
    await page.route(url => url.pathname === "/start-camera.rep", route => route.fulfill({ path: tauReplay, contentType: "application/octet-stream" }));
    await page.route("**/v1.4/start.js*", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()) + `
        const originalStartReplayForCameraTest = start_replay;
        start_replay = function(buffer, length) {
          originalStartReplayForCameraTest(buffer, length);
          _replay_set_value(1, 1);
          window.startCameraLoads = (window.startCameraLoads || 0) + 1;
          window.firstCameraY = _ui_get_screen_pos(1);
        };
      ` });
    });
    await page.goto("/?rep=/start-camera.rep");
    await page.waitForFunction(() => window.startCameraLoads === 1);
    // Tau Cross's first player starts at (288, 1456), not the map origin.
    expect(await page.evaluate(() => firstCameraY)).toBeGreaterThan(500);
    await expect.poll(() => page.evaluate(() => zoomLevel)).toBe(settings.zoom);
    await page.waitForTimeout(500);
    let camera = await cameraAtStart(page, { x: 288, y: 1456 });
    expect(camera.frame).toBe(0);
    expect(camera.actual).toEqual(camera.expected);
    expect(await page.evaluate(() => _observer_get_value())).toBe(Number(settings.observerEnabled));
    await expectRenderedCamera(page);
    await page.screenshot({ path: `test-results/start-camera-${settings.observerEnabled}-${settings.zoom}.png` });

    // Loading while paused must discard the old manual camera position.
    await page.evaluate(() => _ui_set_screen_center_manual(3000, 3000));
    await page.setInputFiles("#select_rep_file", gladiatorReplay);
    await page.waitForFunction(() => window.startCameraLoads === 2);
    await page.waitForTimeout(500);
    camera = await cameraAtStart(page, { x: 512, y: 272 });
    expect(camera.frame).toBe(0);
    expect(camera.actual).toEqual(camera.expected);
    await expectRenderedCamera(page);

    // Startup positioning must not keep recentering later manual movement.
    await page.evaluate(() => _ui_set_screen_center_manual(3000, 3000));
    const manual = await page.evaluate(() => [_ui_get_screen_pos(0), _ui_get_screen_pos(1)]);
    await page.waitForTimeout(3500);
    expect(await page.evaluate(() => [_ui_get_screen_pos(0), _ui_get_screen_pos(1)])).toEqual(manual);
    expect(errors).toEqual([]);
  });
}
