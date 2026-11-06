const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const fixtures = path.join(__dirname, "../fixtures");
const legacy = { file: "elimination-0145.rep", frames: 33378, names: ["PurpleProtoss", "krasi0"] };
const remastered = { file: "remastered-zvz.rep", frames: 12518, names: ["getoutchobo", "vvvvooo!"] };
const terran = { file: "remastered-tvp.rep", frames: 7333, names: ["lIlIlIIIllIlIlI", "454553455"] };
const backrooms = { file: "remastered-backrooms-desync.rep", frames: 14036, names: ["scloader", "20YY"] };

async function dropReplays(page, replays) {
  const data = replays.map(replay => ({ name: replay.file, bytes: [...fs.readFileSync(path.join(fixtures, replay.file))] }));
  const transfer = await page.evaluateHandle(files => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name));
    return transfer;
  }, data);
  await page.dispatchEvent("body", "drop", { dataTransfer: transfer });
  await transfer.dispose();
}

async function seek(page, frame) {
  await page.evaluate(frame => {
    _replay_set_value(1, 1);
    _replay_set_value(3, frame);
    resume_viewer_main_loop();
  }, frame);
  await expect.poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 60000 }).toBe(frame);
}

async function stats(page) {
  return page.evaluate(() => players.map(player => [
    _player_get_value(player, C_CURRENT_MINERALS),
    _player_get_value(player, C_CURRENT_GAS),
    _player_get_value(player, C_CURRENT_WORKERS),
    _player_get_value(player, C_CURRENT_ARMY_SIZE)
  ]));
}

async function expectPaintedCanvas(page) {
  await expect.poll(() => page.evaluate(() => {
    const copy = document.createElement("canvas");
    copy.width = Module.canvas.width;
    copy.height = Module.canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true });
    context.drawImage(Module.canvas, 0, 0);
    const rgba = context.getImageData(0, 0, copy.width, copy.height).data;
    const colors = new Set();
    for (let i = 0; i < rgba.length; i += 64) {
      if (rgba[i + 3] === 255) colors.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    }
    return colors.size;
  })).toBeGreaterThan(32);
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 667 }]) {
  test(`reported Backrooms replay uses extended terrain at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => {
      if (["error", "warning"].includes(message.type())) errors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.volumeSettings = JSON.stringify({ level: 0, muted: true });
      localStorage.audioCategorySettings = JSON.stringify({ combat: { enabled: false }, acknowledgements: { enabled: false }, music: { enabled: false } });
    });
    await page.goto("/");
    await expect(page.locator("#select_replay_label")).not.toHaveClass(/disabled/, { timeout: 30000 });
    await dropReplays(page, [backrooms]);
    await expect.poll(() => page.evaluate(() => main_has_been_called && _replay_get_value(4))).toBe(backrooms.frames);
    expect(await page.evaluate(() => Module.replayFormat)).toBe("remastered");
    for (const [frame, resources] of [
      [2233, [[10, 0], [58, 0]]],
      [5000, [[270, 88], [166, 0]]],
      [14035, [[296, 293], [168, 324]]],
      [5000, [[270, 88], [166, 0]]]
    ]) {
      await seek(page, frame);
      expect((await stats(page)).map(player => player.slice(0, 2))).toEqual(resources);
      await expectPaintedCanvas(page);
    }
    await page.evaluate(() => {
      _observer_set_value(0);
      _fog_of_war_set_value(0);
      _ui_set_screen_center(3808, 272);
      _ui_force_static_redraw();
    });
    await page.screenshot({ path: `test-results/remastered-backrooms-${viewport.width}.png` });
    expect(errors).toEqual([]);
  });

  test(`dragging and alternating replay formats at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => {
      if (["error", "warning"].includes(message.type())) errors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.volumeSettings = JSON.stringify({ level: 0, muted: true });
      localStorage.audioCategorySettings = JSON.stringify({ combat: { enabled: false }, acknowledgements: { enabled: false }, music: { enabled: false } });
    });
    await page.route("**/v1.4/start.js*", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()) + `
        const startForFormatTest = start_replay;
        start_replay = function(buffer, length) {
          startForFormatTest(buffer, length);
          _replay_set_value(1, 1);
          window.formatTestLoads = (window.formatTestLoads || 0) + 1;
        };
      ` });
    });
    await page.goto("/");
    await expect(page.locator("#select_replay_label")).not.toHaveClass(/disabled/, { timeout: 30000 });
    let loads = 0;
    const firstStats = new Map();
    for (const replay of [legacy, remastered, legacy, terran, remastered, legacy]) {
      await dropReplays(page, [replay]);
      await page.waitForFunction(count => window.formatTestLoads === count, ++loads);
      expect(await page.evaluate(() => _replay_get_value(4))).toBe(replay.frames);
      expect(await page.evaluate(() => Module.replayFormat)).toBe(replay === legacy ? "classic" : "remastered");
      expect(await page.evaluate(() => players.map(p => UTF8ToString(_player_get_value(p, C_NICK))))).toEqual(replay.names);
      await expectPaintedCanvas(page);
      await seek(page, 2400);
      const initial = await stats(page);
      expect(initial.some(player => player[2] > 4), "replay commands must develop the starting economy").toBe(true);
      if (firstStats.has(replay.file)) expect(initial).toEqual(firstStats.get(replay.file));
      firstStats.set(replay.file, initial);
      await seek(page, 3600);
      await seek(page, 2400);
      expect(await stats(page)).toEqual(initial);
      await expectPaintedCanvas(page);
      if (replay === remastered && loads === 2) {
        await page.screenshot({ path: `test-results/remastered-${viewport.width}.png` });
        const downloadPromise = page.waitForEvent("download");
        await page.locator("#rv-rc-download-replay").click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe(replay.file);
        expect(fs.readFileSync(await download.path())).toEqual(fs.readFileSync(path.join(fixtures, replay.file)));
      }
      await page.locator("#rv-rc-play").click();
      await expect.poll(() => page.evaluate(() => _replay_get_value(2))).toBeGreaterThan(2424);
      await page.locator("#rv-rc-play").click();
      expect(await page.evaluate(() => _replay_get_value(1))).toBe(1);
      await page.keyboard.press("Space");
      expect(await page.evaluate(() => _replay_get_value(1))).toBe(0);
      await page.keyboard.press("Space");
      expect(await page.evaluate(() => _replay_get_value(1))).toBe(1);
      expect(errors).toEqual([]);
    }
    await dropReplays(page, [legacy, terran, remastered]);
    await page.waitForFunction(count => window.formatTestLoads === count, ++loads);
    await expect(page.locator("#playlist-position")).toHaveText("#1 of 3");
    for (const replay of [terran, remastered, legacy]) {
      await page.locator("#playlist-next").click();
      await page.waitForFunction(count => window.formatTestLoads === count, ++loads);
      expect(await page.evaluate(() => _replay_get_value(4))).toBe(replay.frames);
      await seek(page, 2400);
      expect(await stats(page)).toEqual(firstStats.get(replay.file));
      await expectPaintedCanvas(page);
    }
    expect(errors).toEqual([]);
  });
}
