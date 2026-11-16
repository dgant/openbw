const { test, expect } = require("./fixtures");
const path = require("node:path");
const fs = require("node:fs");

const fixture = name => path.join(__dirname, "../fixtures", name);
const classic = fixture("elimination-0145.rep");
const modern = fixture("remastered-backrooms-desync.rep");
const tvp = fixture("remastered-tvp.rep");

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    const text = message.text();
    // Firefox repairs these legacy font bounds before rendering:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1851623#c3
    // Keep this exception specific to the existing font, not other font/load warnings.
    if (message.type() === "warning" && text.includes("downloadable font: Glyph bbox was incorrect (glyph ids ") &&
        text.includes('font-family: "FontAwesome"') &&
        text.includes("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.5.0/fonts/fontawesome-webfont.woff2?v=4.5.0")) return;
    if (["error", "warning"].includes(message.type())) errors.push(text);
  });
  return errors;
}

async function paintedPixels(page) {
  return page.evaluate(() => {
    const copy = document.createElement("canvas");
    copy.width = Module.canvas.width;
    copy.height = Module.canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true });
    context.drawImage(Module.canvas, 0, 0);
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 256) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return colors.size;
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.volumeSettings = JSON.stringify({ level: 0, muted: true });
    localStorage.audioCategorySettings = JSON.stringify({ combat: { enabled: false }, acknowledgements: { enabled: false }, music: { enabled: false } });
  });
  await page.route("**/v1.4/start.js*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + `
      const originalStartForFormatTest = start_replay;
      start_replay = function(buffer, length) {
        originalStartForFormatTest(buffer, length);
        _replay_set_value(1, 1);
        window.formatTestLoads = (window.formatTestLoads || 0) + 1;
      };
    ` });
  });
});

test.afterEach(async ({ page, browserName }) => {
  if (browserName === "firefox") {
    expect(await page.evaluate(async () => {
      const fonts = await document.fonts.load("16px FontAwesome");
      return fonts.length > 0 && fonts.every(font => font.status === "loaded");
    })).toBe(true);
  }
});

test("switches classic and Remastered engines without losing controls or settings", async ({ page }) => {
  test.setTimeout(180000);
  const errors = collectErrors(page);
  const engineAssets = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (/\.(?:wasm|mpq)$/i.test(url.pathname)) engineAssets.push(url);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.waitForFunction(() => mpq_data_ready);

  let loads = 0;
  for (const [file, format] of [[classic, "classic"], [modern, "remastered"], [tvp, "remastered"], [classic, "classic"], [modern, "remastered"]]) {
    await page.setInputFiles("#select_rep_file", file);
    await page.waitForFunction(count => window.formatTestLoads === count, ++loads);
    expect(await page.evaluate(() => Module.replayFormat)).toBe(format);
    expect(await page.evaluate(() => _replay_get_value(2))).toBe(0);
    await expect.poll(() => paintedPixels(page)).toBeGreaterThan(50);
    await page.screenshot({ path: `test-results/replay-format-${loads}-${format}.png` });
    await page.evaluate(() => { _replay_set_value(3, 500); resume_viewer_main_loop(); });
    await page.waitForFunction(() => _replay_get_value(2) === 500);
    await page.evaluate(() => { _replay_set_value(3, 0); resume_viewer_main_loop(); });
    await page.waitForFunction(() => _replay_get_value(2) === 0);
    await expect.poll(() => paintedPixels(page)).toBeGreaterThan(50);
    expect(await page.evaluate(() => JSON.parse(localStorage.volumeSettings))).toEqual({ level: 0, muted: true });
  }
  // Actual controls still operate after the old engine's event handlers are removed.
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => _replay_get_value(2))).toBeGreaterThan(0);
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => _replay_get_value(1))).toBe(1);
  expect(engineAssets.length).toBeGreaterThan(0);
  for (const url of engineAssets) expect(url.origin).toBe(new URL(page.url()).origin);
  expect(engineAssets.map(url => url.pathname)).toEqual(expect.arrayContaining([
    "/v1.4/openbw.wasm", "/v1.4/remastered/openbw.wasm", "/v1.4/remastered/terrain.mpq"
  ]));
  expect(errors).toEqual([]);
});

test("loads a Remastered URL, seeks to its requested frame and renders on mobile", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.route("**/remastered-test.rep", route => route.fulfill({ path: modern, contentType: "application/octet-stream" }));
  await page.goto("/?rep=/remastered-test.rep&frame=2233");
  await page.waitForFunction(() => window.formatTestLoads === 1 && _replay_get_value(2) === 2233);
  expect(await page.evaluate(() => Module.replayFormat)).toBe("remastered");
  await expect.poll(() => paintedPixels(page)).toBeGreaterThan(50);
  await page.screenshot({ path: "test-results/replay-format-mobile.png" });
  expect(errors).toEqual([]);
});

for (const [format, file] of [["classic", classic], ["remastered", modern]]) {
  test(`${format} rejects a truncated replay and can load the next replay`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForFunction(() => mpq_data_ready);
    await page.setInputFiles("#select_rep_file", {
      name: "truncated.rep", mimeType: "application/octet-stream", buffer: fs.readFileSync(file).subarray(0, 40)
    });
    await expect(page.locator(".replay-load-error")).toBeVisible();
    await expect(page.locator(".replay-load-error")).toContainText(/replay|data_reader/i);
    await page.setInputFiles("#select_rep_file", file);
    await page.waitForFunction(() => window.formatTestLoads === 1 && _replay_get_value(4) > 0);
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => _replay_get_value(2))).toBeGreaterThan(0);
    await expect.poll(() => paintedPixels(page)).toBeGreaterThan(50);
    expect(errors).toEqual([]);
  });
}

test("a failed Remastered terrain download can be retried without reloading", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  let attempts = 0;
  await page.route("**/remastered/terrain.mpq", async route => {
    if (++attempts === 1) await route.fulfill({ status: 503, body: "Unavailable" });
    else await route.continue();
  });
  await page.goto("/");
  await page.waitForFunction(() => mpq_data_ready);
  await page.setInputFiles("#select_rep_file", modern);
  await expect(page.locator(".replay-load-error")).toContainText("Could not load Remastered terrain: 503");
  await expect(page.locator(".replay-load-error")).toBeVisible();
  await page.setInputFiles("#select_rep_file", modern);
  await page.waitForFunction(() => window.formatTestLoads === 1 && _replay_get_value(4) > 0);
  await expect.poll(() => paintedPixels(page)).toBeGreaterThan(50);
  expect(attempts).toBe(2);
  expect(errors).toEqual([]);
});

test("a checksum failure after successful playback leaves the next replay usable", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await page.waitForFunction(() => mpq_data_ready);
  await page.setInputFiles("#select_rep_file", modern);
  await page.waitForFunction(() => window.formatTestLoads === 1);
  const corrupt = fs.readFileSync(modern);
  corrupt[20] ^= 1;
  await page.setInputFiles("#select_rep_file", { name: "checksum.rep", mimeType: "application/octet-stream", buffer: corrupt });
  await expect(page.locator(".replay-load-error")).toContainText("Replay checksum mismatch");
  await expect(page.locator(".replay-load-error")).toBeVisible();
  await page.setInputFiles("#select_rep_file", tvp);
  await page.waitForFunction(() => window.formatTestLoads === 2);
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => _replay_get_value(2))).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("snapshot caching preserves playback and rewind under WASM heap pressure", async ({ page }) => {
  test.setTimeout(120000);
  const errors = collectErrors(page);
  await page.goto("/");
  await page.waitForFunction(() => mpq_data_ready);
  await page.setInputFiles("#select_rep_file", modern);
  await page.waitForFunction(() => window.formatTestLoads === 1);
  const buffer = await page.evaluate(() => Module._malloc(48 * 1024 * 1024));
  expect(buffer).toBeGreaterThan(0);
  try {
    for (const frame of [14036, 2233, 14036]) {
      await page.evaluate(frame => { _replay_set_value(3, frame); resume_viewer_main_loop(); }, frame);
      await page.waitForFunction(frame => activeReplayEngine === null || _replay_get_value(2) === frame, frame);
      expect(await page.evaluate(() => activeReplayEngine)).toBe("remastered");
      expect(await page.evaluate(() => _replay_get_value(2))).toBe(frame);
      await expect.poll(() => paintedPixels(page)).toBeGreaterThan(50);
    }
  } finally {
    await page.evaluate(buffer => Module._free(buffer), buffer);
  }
  expect(errors).toEqual([]);
});
