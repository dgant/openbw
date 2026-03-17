const { test, expect } = require("@playwright/test");
const fs = require("fs/promises");

const replayName = "PurpleWave vs Monster Tau Cross CTR_41B69CB9.rep";
const replayPath = `/workspace/replays/${replayName}`;

async function createReplayDrop(page) {
  const replayBuffer = await fs.readFile(replayPath);
  return page.evaluateHandle(
    ({ name, mimeType, bytes }) => {
      const dataTransfer = new DataTransfer();
      const file = new File([new Uint8Array(bytes)], name, { type: mimeType });
      dataTransfer.items.add(file);
      return dataTransfer;
    },
    {
      name: replayName,
      mimeType: "application/octet-stream",
      bytes: [...replayBuffer]
    }
  );
}

async function createLogCollectors(page) {
  const pageErrors = [];
  const consoleProblems = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });

  return { pageErrors, consoleProblems };
}

async function loadReplay(page) {
  await page.goto("/");
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  const drop = await createReplayDrop(page);
  await page.dispatchEvent("body", "drop", { dataTransfer: drop });
  await expect(page.locator("#top")).toBeHidden({ timeout: 30000 });
  await expect
    .poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 30000 })
    .toBeGreaterThan(0);
  await expect(page.locator("#nick1")).toContainText("PurpleWave");
}

function assertCleanLogs({ pageErrors, consoleProblems }) {
  expect(pageErrors).toEqual([]);
  expect(consoleProblems).toEqual([]);
}

test("boots with bundled MPQs and starts a replay from drag and drop", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await loadReplay(page);

  await expect(page.locator("#map1")).toContainText("Tau Cross");
  await expect(page.locator("#nick2")).toContainText("Monster");
  await expect(page.locator("#rv-rc-timer")).toContainText("time:");
  await expect(page.locator("#rv-rc-speed")).toContainText("speed:");
  await expect(page.locator("#viewport-export")).toBeVisible();
  assertCleanLogs(logs);
});

test("existing buttons and hotkeys work during replay playback", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await loadReplay(page);

  await page.keyboard.press("h");
  await expect(page.locator("#quick_help")).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.locator("#quick_help")).toBeHidden();

  await expect(page.locator("#rv-rc-observer")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _observer_get_value())).toBe(1);
  await page.click("#rv-rc-observer");
  await expect(page.locator("#rv-rc-observer")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _observer_get_value())).toBe(0);
  await page.click("#rv-rc-observer");
  await expect(page.locator("#rv-rc-observer")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _observer_get_value())).toBe(1);

  await expect(page.locator("#rv-rc-sound")).toHaveClass(/rv-rc-sound/);
  await page.keyboard.press("s");
  await expect(page.locator("#rv-rc-sound")).toHaveClass(/rv-rc-muted/);
  await page.click("#rv-rc-sound");
  await expect(page.locator("#rv-rc-sound")).toHaveClass(/rv-rc-sound/);

  await expect.poll(() => page.evaluate(() => _replay_get_value(0))).toBe(1);
  await page.click("#rv-rc-faster");
  await expect.poll(() => page.evaluate(() => _replay_get_value(0))).toBe(2);
  await page.keyboard.press("z");
  await expect.poll(() => page.evaluate(() => _replay_get_value(0))).toBe(1);

  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(0);
  await page.click("#rv-rc-play");
  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(1);
  await page.keyboard.press("p");
  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(0);

  const frameBeforeJump = await page.evaluate(() => _replay_get_value(2));
  await page.keyboard.press("c");
  await expect
    .poll(() => page.evaluate(() => _replay_get_value(3)), { timeout: 5000 })
    .toBeLessThan(frameBeforeJump);

  await page.keyboard.press("g");
  await expect(page.locator("#goto")).toBeVisible();
  await page.fill("#goto-frame-value", "1500");
  await page.click("#goto-frame-submit");
  await expect(page.locator("#goto")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 30000 })
    .toBeGreaterThan(1400);

  await expect(page.locator("#info_tab")).toBeVisible();
  await expect(page.locator("#info_tab_panel1")).toBeVisible();
  await expect(page.locator("#info_tab_panel2")).toBeVisible();
  await expect(page.locator("#info_tab_panel3")).toBeVisible();
  await expect(page.locator("#info_tab_panel4")).toBeHidden();
  await page.keyboard.press("2");
  await expect(page.locator("#info_tab_panel1")).toBeVisible();
  await expect(page.locator("#info_tab_panel2")).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.locator("#info_tab_panel3")).toBeVisible();
  await page.keyboard.press("4");
  await expect(page.locator("#info_tab_panel3")).toBeVisible();

  await expect(page.locator("#graphs_tab")).toBeHidden();
  await page.keyboard.press("5");
  await expect(page.locator("#graphs_tab")).toBeVisible();
  await page.keyboard.press("5");
  await expect(page.locator("#graphs_tab")).toBeHidden();

  await expect.poll(() => page.evaluate(() => localStorage.zoomLevel || "0")).toBe("0");
  await page.keyboard.press("y");
  await expect.poll(() => page.evaluate(() => localStorage.zoomLevel)).toBe("1");
  await page.click("#zoom-out");
  await expect.poll(() => page.evaluate(() => localStorage.zoomLevel)).toBe("0");

  const progressBarVisibleBefore = await page.locator(".rv-rc-progress-bar > div").first().isVisible();
  expect(progressBarVisibleBefore).toBe(true);
  await page.keyboard.press("n");
  await expect(page.locator(".rv-rc-progress-bar > div")).toBeHidden();
  await page.keyboard.press("n");
  await expect(page.locator(".rv-rc-progress-bar > div")).toBeVisible();

  assertCleanLogs(logs);
});

test("bottom bar stays single-line and hides stats progressively on narrow viewports", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1000, height: 700 });
  await loadReplay(page);

  await page.setViewportSize({ width: 800, height: 700 });
  await expect(page.locator("#info-dock")).toBeHidden();
  await expect(page.locator("#race1")).toBeHidden();
  await expect(page.locator("#apm1")).toBeHidden();
  await expect(page.locator("#army1")).toBeVisible();
  await expect(page.locator("#workers1")).toBeVisible();
  await expect(page.locator("#supply1")).toBeVisible();
  await expect(page.locator("#nick1")).toContainText("PurpleWave");

  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.locator("#info-dock")).toBeHidden();
  await expect(page.locator("#race1")).toBeHidden();
  await expect(page.locator("#apm1")).toBeHidden();
  await expect(page.locator("#army1")).toBeHidden();
  await expect(page.locator("#workers1")).toBeHidden();
  await expect(page.locator("#minerals1")).toBeHidden();
  await expect(page.locator("#gas1")).toBeHidden();
  await expect(page.locator("#supply1")).toBeHidden();
  await expect(page.locator("#nick1")).toContainText("PurpleW.");
  await expect.poll(() =>
    page.evaluate(() => {
      const row = document.getElementById("infobar_row_player1");
      const map = document.getElementById("map2");
      return {
        rowWrapped: row.scrollHeight > row.clientHeight,
        mapWrapped: map.scrollHeight > map.clientHeight
      };
    })
  ).toEqual({ rowWrapped: false, mapWrapped: false });

  assertCleanLogs(logs);
});

test("export button records a WebM download flow", async ({ page }) => {
  await page.addInitScript(() => {
    window.__openbwTestExportFrameLimit = 48;
    window.__mockDownloads = [];

    URL.createObjectURL = (blob) => {
      window.__mockDownloads.push({ size: blob.size, type: blob.type });
      return "blob:mock-openbw";
    };
    URL.revokeObjectURL = () => {};

    HTMLAnchorElement.prototype.click = function() {
      window.__mockDownloadName = this.download;
      window.__mockDownloadHref = this.href;
    };

    HTMLCanvasElement.prototype.captureStream = () => ({
      getTracks() {
        return [{ stop() {} }];
      }
    });

    class MockMediaRecorder {
      constructor() {
        this.state = "inactive";
      }
      static isTypeSupported() {
        return true;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["openbw-export"], { type: "video/webm" }) });
        }
        if (this.onstop) {
          this.onstop();
        }
      }
    }

    window.MediaRecorder = MockMediaRecorder;
  });

  const logs = await createLogCollectors(page);
  await loadReplay(page);

  await page.click("#rv-rc-export");
  await expect(page.locator("#rv-rc-export")).toHaveClass(/is-exporting/);
  await expect(page.locator("#rv_modal")).toHaveClass(/rv-modal-bottom/);
  await expect
    .poll(() => page.evaluate(() => window.__mockDownloads.length), { timeout: 15000 })
    .toBe(1);
  await expect(page.locator("#rv-rc-export")).not.toHaveClass(/is-exporting/);
  await expect
    .poll(() => page.evaluate(() => window.__mockDownloadName))
    .toContain(".webm");
  await expect
    .poll(() => page.evaluate(() => window.__mockDownloads[0].size))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => _observer_get_value()))
    .toBe(1);

  assertCleanLogs(logs);
});
