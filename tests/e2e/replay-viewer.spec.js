const { test, expect } = require("@playwright/test");
const fs = require("fs/promises");

const defaultReplayName = "PurpleWave vs Monster Tau Cross CTR_41B69CB9.rep";
const defaultReplayPath = `/workspace/replays/${defaultReplayName}`;
const willyTReplayPath = "/workspace/replays/PurpleWave vs WillyT Icarus CTR_20B3F39.rep";
const nukeReplayPath = "/workspace/replays/Hannes Bredberg vs VOID La Mancha1.1 (Nukes).rep";
const basilReplayUrl = "https://data.basil-ladder.net/bots/Brainiac/Brainiac%20vs%20adias%20Roadrunner%20CTR_95D142E3.rep";

async function createReplayDrop(page, replayPath = defaultReplayPath) {
  const replayName = replayPath.split("/").pop();
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

async function createLogCollectors(page, options = {}) {
  const { disableAudio = true } = options;
  if (disableAudio) {
    await page.addInitScript(() => {
      if (!localStorage.volumeSettings) {
        localStorage.volumeSettings = JSON.stringify({ level: 0.5, muted: true });
      }
      if (!localStorage.audioCategorySettings) {
        localStorage.audioCategorySettings = JSON.stringify({
          combat: { enabled: false, level: 1 },
          acknowledgements: { enabled: false, level: 1 },
          music: { enabled: false, level: 0.25 }
        });
      }
    });
  }
  const logs = { pageErrors: [], consoleErrors: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      logs.consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    logs.pageErrors.push(String(err));
  });
  return logs;
}

async function loadReplay(page, replayPath = defaultReplayPath) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/");
    await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
    await page.setInputFiles("#select_rep_file", replayPath);
    try {
      await expect
        .poll(() => page.evaluate(() => _replay_get_value(4)), { timeout: 30000 })
        .toBeGreaterThan(0);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function waitForHomepageReady(page) {
  await page.goto("/");
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  await expect(page.locator("#select_replay_label")).not.toHaveClass(/disabled/, { timeout: 30000 });
  await expect(page.locator(".pregame-dropzone")).toContainText("Browse files");
}

async function collectIdlePerformanceMetrics(page, durationMs = 5000) {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const readMetrics = async () => {
    const response = await client.send("Performance.getMetrics");
    return Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value]));
  };
  const start = await readMetrics();
  await page.waitForTimeout(durationMs);
  const end = await readMetrics();
  return {
    taskDelta: (end.TaskDuration || 0) - (start.TaskDuration || 0),
    scriptDelta: (end.ScriptDuration || 0) - (start.ScriptDuration || 0),
    layoutDelta: (end.LayoutDuration || 0) - (start.LayoutDuration || 0),
    jsHeapUsed: end.JSHeapUsedSize || 0
  };
}

async function forceClick(page, selector) {
  await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) throw new Error(`Missing selector: ${sel}`);
    node.click();
  }, selector);
}

async function getFooterVolumeHandleTop(page) {
  return page.evaluate(() => {
    const slider = document.querySelector("#volume-slider");
    const handle = document.querySelector("#volume-slider-handle");
    if (!slider || !handle) {
      throw new Error("Footer volume slider geometry is unavailable");
    }
    const sliderRect = slider.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    return {
      handleTop: handleRect.top - sliderRect.top,
      sliderHeight: sliderRect.height
    };
  });
}

async function dragPlaybackScrubber(page, fraction) {
  const slider = page.locator("#game-slider");
  const handle = page.locator("#game-slider-handle");
  await expect(slider).toBeVisible();
  const sliderBox = await slider.boundingBox();
  const handleBox = await handle.boundingBox();
  if (!sliderBox || !handleBox) {
    throw new Error("Playback scrubber geometry is unavailable");
  }
  const handleX = handleBox.x + handleBox.width / 2;
  const handleY = handleBox.y + handleBox.height / 2;
  const targetX = sliderBox.x + sliderBox.width * fraction;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(targetX, handleY, { steps: 12 });
}

async function loadRemoteReplay(page, replayUrl) {
  await page.goto(`/?rep=${encodeURIComponent(replayUrl)}`);
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  await expect
    .poll(() => page.evaluate(() => (typeof _replay_get_value === "function" ? _replay_get_value(4) : 0)), { timeout: 120000 })
    .toBeGreaterThan(0);
}

async function loadRemoteReplayAtFrame(page, replayUrl, frame) {
  await page.goto(`/?rep=${encodeURIComponent(replayUrl)}&frame=${frame}`);
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  await expect
    .poll(() => page.evaluate(() => (typeof _replay_get_value === "function" ? _replay_get_value(4) : 0)), { timeout: 120000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => _replay_get_value(3)), { timeout: 30000 })
    .toBeGreaterThanOrEqual(frame);
}

async function expectStartupPlaybackToAdvance(page, options = {}) {
  const { durationMs = 5000, minFrameDelta = 1 } = options;
  const startFrame = await page.evaluate(() => _replay_get_value(2));
  await page.waitForTimeout(durationMs);
  const endFrame = await page.evaluate(() => _replay_get_value(2));
  expect(endFrame).toBeGreaterThan(startFrame + minFrameDelta);
}

function assertCleanLogs({ pageErrors }) {
  expect(pageErrors).toEqual([]);
}

function assertCleanConsoleErrors({ consoleErrors }) {
  expect(consoleErrors).toEqual([]);
}

function assertAllCleanLogs(logs) {
  assertCleanLogs(logs);
  assertCleanConsoleErrors(logs);
}

test("boots with bundled MPQs and starts a replay from drag and drop", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await loadReplay(page);
  await expectStartupPlaybackToAdvance(page);
  assertAllCleanLogs(logs);
});

test("remote replay loaded via rep query keeps advancing after startup", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await loadRemoteReplay(page, basilReplayUrl);
  await expectStartupPlaybackToAdvance(page);
  assertAllCleanLogs(logs);
});

test("local replay selection works even if chosen before MPQ buffers finish reading", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.goto("/");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#select_replay_label").click();
  const chooser = await chooserPromise;
  await chooser.setFiles(defaultReplayPath);
  await expect
    .poll(() => page.evaluate(() => (typeof _replay_get_value === "function" ? _replay_get_value(4) : 0)), { timeout: 30000 })
    .toBeGreaterThan(0);
  await expectStartupPlaybackToAdvance(page);
  assertAllCleanLogs(logs);
});

test("warmed homepage stays within the idle CPU budget", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const logs = await createLogCollectors(page);
  await waitForHomepageReady(page);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  await expect(page.locator("#select_replay_label")).not.toHaveClass(/disabled/, { timeout: 30000 });
  await page.waitForTimeout(1000);

  const metrics = await collectIdlePerformanceMetrics(page, 5000);
  expect(metrics.taskDelta).toBeLessThan(0.05);
  expect(metrics.scriptDelta).toBeLessThan(0.02);
  expect(metrics.layoutDelta).toBeLessThan(0.01);
  assertAllCleanLogs(logs);

  await context.close();
});

test("paused replay enters a low-CPU steady state and resumes cleanly on play", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page);
  await page.waitForTimeout(1500);

  await page.locator("#rv-rc-play").click();

  await expect
    .poll(() =>
      page.evaluate(() => ({
        paused: _replay_get_value(1),
        current: _replay_get_value(2),
        target: _replay_get_value(3),
        loopPaused: window.viewerMainLoopPausedForIdle === true
      })),
      { timeout: 10000 }
    )
    .toEqual({
      paused: 1,
      current: expect.any(Number),
      target: expect.any(Number),
      loopPaused: true
    });

  const pausedFrame = await page.evaluate(() => _replay_get_value(2));
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => _replay_get_value(2))).toBe(pausedFrame);
  await page.waitForTimeout(1000);

  const metrics = await collectIdlePerformanceMetrics(page, 5000);
  expect(metrics.taskDelta).toBeLessThan(0.02);
  expect(metrics.scriptDelta).toBeLessThan(0.01);
  expect(metrics.layoutDelta).toBeLessThan(0.01);

  await page.locator("#rv-rc-play").click();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        paused: _replay_get_value(1),
        current: _replay_get_value(2),
        loopPaused: window.viewerMainLoopPausedForIdle === true
      })),
      { timeout: 10000 }
    )
    .toEqual({
      paused: 0,
      current: expect.any(Number),
      loopPaused: false
    });
  await expect
    .poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 10000 })
    .toBeGreaterThan(pausedFrame);

  assertAllCleanLogs(logs);
});

test("paused replay keeps a visible scrubber track and dragging it resumes seeking", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page);
  await page.waitForTimeout(1500);
  await page.locator("#rv-rc-play").click();

  await expect
    .poll(() =>
      page.evaluate(() => ({
        paused: _replay_get_value(1),
        current: _replay_get_value(2),
        target: _replay_get_value(3),
        loopPaused: window.viewerMainLoopPausedForIdle === true
      })),
      { timeout: 10000 }
    )
    .toEqual({
      paused: 1,
      current: expect.any(Number),
      target: expect.any(Number),
      loopPaused: true
    });

  const trackState = await page.evaluate(() => {
    const slider = document.getElementById("game-slider");
    const rect = slider.getBoundingClientRect();
    const style = getComputedStyle(slider);
    return {
      width: rect.width,
      height: rect.height,
      backgroundColor: style.backgroundColor,
      opacity: style.opacity,
      visibility: style.visibility
    };
  });
  expect(trackState.width).toBeGreaterThan(100);
  expect(trackState.height).toBeGreaterThan(0);
  expect(trackState.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(trackState.opacity).toBe("1");
  expect(trackState.visibility).toBe("visible");

  const pausedFrame = await page.evaluate(() => _replay_get_value(2));
  await dragPlaybackScrubber(page, 0.75);
  const during = await page.evaluate(() => ({
    paused: _replay_get_value(1),
    current: _replay_get_value(2),
    target: _replay_get_value(3),
    loopPaused: window.viewerMainLoopPausedForIdle === true,
    timer: document.querySelector("#rv-rc-timer")?.textContent || ""
  }));
  expect(during.loopPaused).toBe(false);
  expect(during.target).toBeGreaterThan(pausedFrame);
  expect(during.timer).not.toContain("NaN");
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(() => ({
        paused: _replay_get_value(1),
        current: _replay_get_value(2),
        target: _replay_get_value(3),
        loopPaused: window.viewerMainLoopPausedForIdle === true
      })),
      { timeout: 10000 }
    )
    .toEqual({
      paused: 1,
      current: expect.any(Number),
      target: expect.any(Number),
      loopPaused: false
    });

  const after = await page.evaluate(() => ({
    current: _replay_get_value(2),
    target: _replay_get_value(3),
    timer: document.querySelector("#rv-rc-timer")?.textContent || ""
  }));
  expect(after.current).toBeGreaterThan(pausedFrame);
  expect(after.target).toBeGreaterThan(pausedFrame);
  expect(after.timer).not.toContain("NaN");

  assertAllCleanLogs(logs);
});

test("remote BASIL replay advances through the reported 21:18 local stall point", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadRemoteReplayAtFrame(page, basilReplayUrl, 30500);
  await page.evaluate(() => {
    _replay_set_value(1, 0);
    _replay_set_value(0, 1);
  });

  const requestedState = await page.evaluate(() => ({
    cur: _replay_get_value(2),
    target: _replay_get_value(3),
    paused: _replay_get_value(1),
    overlay: document.querySelector("#viewport-alert")?.textContent || ""
  }));
  expect(requestedState.target).toBeGreaterThanOrEqual(30500);
  expect(requestedState.paused).toBe(0);
  expect(requestedState.overlay).toContain("Fast-forwarding to");

  const startFrame = requestedState.cur;
  await page.waitForTimeout(3000);
  const endState = await page.evaluate(() => ({
    cur: _replay_get_value(2),
    target: _replay_get_value(3),
    paused: _replay_get_value(1),
    modalTitle: document.querySelector("#rv_modal h3")?.textContent || ""
  }));
  expect(endState.cur).toBeGreaterThan(startFrame);
  expect(endState.target).toBeGreaterThanOrEqual(30500);
  expect(endState.paused).toBe(0);
  expect(endState.modalTitle).not.toBe("Fatal error");
  assertAllCleanLogs(logs);
});

test("remote BASIL replay can scrub to the end without trapping", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadRemoteReplayAtFrame(page, basilReplayUrl, 43000);
  await page.evaluate(() => {
    const endFrame = _replay_get_value(4);
    _replay_set_value(3, endFrame);
    _replay_set_value(1, 0);
    _replay_set_value(0, 128);
  });

  const startFrame = await page.evaluate(() => _replay_get_value(2));
  await page.waitForTimeout(5000);
  const endState = await page.evaluate(() => ({
    cur: _replay_get_value(2),
    target: _replay_get_value(3),
    end: _replay_get_value(4),
    paused: _replay_get_value(1),
    modalTitle: document.querySelector("#rv_modal h3")?.textContent || ""
  }));
  expect(endState.target).toBe(endState.end);
  expect(endState.cur).toBeGreaterThan(startFrame);
  expect(endState.modalTitle).not.toBe("Fatal error");
  assertAllCleanLogs(logs);
});

test("real playback scrubber drag keeps a valid preview and jumps forward instead of resetting", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page);
  await page.waitForTimeout(1000);

  const before = await page.evaluate(() => ({
    current: _replay_get_value(2),
    end: _replay_get_value(4),
    timer: document.querySelector("#rv-rc-timer")?.textContent || "",
    sliderValue: document.querySelector("#sliderOutput")?.value || ""
  }));

  await dragPlaybackScrubber(page, 0.75);

  const during = await page.evaluate(() => ({
    current: _replay_get_value(2),
    target: _replay_get_value(3),
    timer: document.querySelector("#rv-rc-timer")?.textContent || "",
    sliderValue: document.querySelector("#sliderOutput")?.value || "",
    sliderAria: document.querySelector("#game-slider-handle")?.getAttribute("aria-valuenow") || ""
  }));

  expect(during.timer).not.toContain("NaN");
  expect(Number.isFinite(Number(during.sliderValue))).toBe(true);
  expect(Number.isFinite(Number(during.sliderAria))).toBe(true);

  await page.mouse.up();

  const after = await page.evaluate(() => ({
    current: _replay_get_value(2),
    target: _replay_get_value(3),
    end: _replay_get_value(4),
    timer: document.querySelector("#rv-rc-timer")?.textContent || "",
    sliderValue: Number(document.querySelector("#sliderOutput")?.value || "0")
  }));

  expect(after.timer).not.toContain("NaN");
  expect(after.target).toBeGreaterThan(before.end * 0.5);
  expect(after.current).toBeGreaterThan(before.current);
  expect(after.sliderValue).toBeGreaterThan(100);
  assertAllCleanLogs(logs);
});

test("basic HUD toggles and hotkeys work during replay playback", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page);
  await page.evaluate(() => {
    _observer_set_value(1);
    _fog_of_war_set_value(1);
    _force_red_blue_colors_set_value(0);
    _replay_set_value(0, 1);
    zoomLevel = 0;
    localStorage.zoomLevel = "0";
    resize_canvas(Module.canvas);
    for (const player of players) {
      _fog_of_war_player_set_value(player, 1);
    }
    update_observer_button();
    update_fow_button();
    update_force_red_blue_button();
    update_player_vision_buttons();
    update_zoom_buttons();
  });

  await expect(page.locator("#rv-rc-observer")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _observer_get_value())).toBe(1);
  await forceClick(page, "#rv-rc-observer");
  await expect(page.locator("#rv-rc-observer")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _observer_get_value())).toBe(0);
  await forceClick(page, "#rv-rc-observer");
  await expect(page.locator("#rv-rc-observer")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _observer_get_value())).toBe(1);
  await expect(page.locator("#rv-rc-fow")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(1);
  await expect(page.locator("#vision1")).toHaveClass(/is-enabled/);
  await expect(page.locator("#vision2")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[0]))).toBe(1);
  await forceClick(page, "#rv-rc-fow");
  await expect(page.locator("#rv-rc-fow")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(0);
  await forceClick(page, "#rv-rc-fow");
  await expect(page.locator("#rv-rc-fow")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(1);
  await forceClick(page, "#vision1");
  await expect(page.locator("#vision1")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[0]))).toBe(0);
  await forceClick(page, "#vision2");
  await expect(page.locator("#vision2")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[1]))).toBe(0);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[0]))).toBe(0);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(1);
  await forceClick(page, "#vision1");
  await expect(page.locator("#vision1")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[0]))).toBe(1);
  await forceClick(page, "#vision2");
  await expect(page.locator("#vision2")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[1]))).toBe(1);
  await expect(page.locator("#rv-rc-force-colors")).not.toHaveClass(/is-enabled/);
  await forceClick(page, "#rv-rc-force-colors");
  await expect(page.locator("#rv-rc-force-colors")).toHaveClass(/is-enabled/);
  await expect
    .poll(() =>
      page.evaluate(() => [
        getComputedStyle(document.querySelector("#nick1")).borderLeftColor,
        getComputedStyle(document.querySelector("#nick2")).borderLeftColor
      ])
    )
    .toEqual(["rgb(244, 4, 4)", "rgb(12, 72, 204)"]);
  await forceClick(page, "#rv-rc-force-colors");
  await expect(page.locator("#rv-rc-force-colors")).not.toHaveClass(/is-enabled/);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        controls: getComputedStyle(document.querySelector(".replay-control .rv-rc-controls")).backgroundColor,
        timer: getComputedStyle(document.querySelector(".replay-control .rv-rc-timer")).backgroundColor,
        progress: getComputedStyle(document.querySelector(".replay-control .rv-rc-progress-bar")).backgroundColor,
        dock: getComputedStyle(document.querySelector(".bottom-info-dock")).backgroundColor,
        infobar: getComputedStyle(document.querySelector(".infobar .infobar-player")).backgroundColor,
        eye: getComputedStyle(document.querySelector("#vision1")).color
      }))
    )
    .toEqual({
      controls: "rgb(24, 27, 34)",
      timer: "rgb(24, 27, 34)",
      progress: "rgb(24, 27, 34)",
      dock: "rgb(46, 46, 52)",
      infobar: "rgb(46, 46, 52)",
      eye: "rgb(33, 153, 232)"
    });
  await page.dispatchEvent("#volume-slider-handle", "mousedown");
  await page.dispatchEvent(".volume", "mouseleave");
  await expect(page.locator("#volume-slider-wrapper")).toBeVisible();
  await page.dispatchEvent("body", "mouseup");

  await expect(page.locator("#info_tab")).toBeVisible();
  await expect(page.locator("#info_tab_panel1")).toBeVisible();
  await expect(page.locator("#info_tab_panel2")).toBeVisible();
  await expect(page.locator("#info_tab_panel3")).toBeVisible();
  await expect(page.locator("#info_tab_panel4")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const icon = document.querySelector("#production_tab_content1 > div[style*='inline-block'] img");
        return icon ? icon.getAttribute("title") : "";
      })
    )
    .not.toBe("");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const row1Top = document.getElementById("infobar_row_player1").getBoundingClientRect().top;
        const row2Top = document.querySelector("#infobar .per-player-info2").getBoundingClientRect().top;
        const prod1Top = document.querySelector("#info_tab_panel1 .per-player-info1").getBoundingClientRect().top;
        const prod2Top = document.querySelector("#info_tab_panel1 .per-player-info2").getBoundingClientRect().top;
        return {
          row1Aligned: Math.abs(row1Top - prod1Top) <= 1,
          row2Aligned: Math.abs(row2Top - prod2Top) <= 1
        };
      })
    )
    .toEqual({
      row1Aligned: true,
      row2Aligned: true
    });

  await expect(page.locator("#graphs_tab")).toBeHidden();
  await page.evaluate(() => toggle_graphs(1));
  await expect(page.locator("#graphs_tab")).toBeVisible();
  await page.evaluate(() => toggle_graphs(1));
  await expect(page.locator("#graphs_tab")).toBeHidden();

  await expect.poll(() => page.evaluate(() => localStorage.zoomLevel || "0")).toBe("0");
  await expect(page.locator("#zoom-in")).not.toHaveClass(/zoom-active/);
  await expect(page.locator("#zoom-out")).not.toHaveClass(/zoom-active/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const metrics = Object.fromEntries(
          Array.from(document.querySelectorAll("#zoom-buttons button")).map((button) => [
            button.id,
            {
              left: Math.round(button.getBoundingClientRect().left),
              top: Math.round(button.getBoundingClientRect().top)
            }
          ])
        );
        return {
          zoomColumnLeftAligned: metrics["zoom-in"].left === metrics["zoom-out"].left,
          controlColumnLeftAligned:
            metrics["rv-rc-force-colors"].left === metrics["rv-rc-observer"].left &&
            metrics["rv-rc-observer"].left === metrics["rv-rc-fow"].left,
          zoomLeftOfControls: metrics["zoom-in"].left < metrics["rv-rc-force-colors"].left,
          rightColumnStacks:
            metrics["rv-rc-force-colors"].top < metrics["rv-rc-observer"].top &&
            metrics["rv-rc-observer"].top < metrics["rv-rc-fow"].top,
          zoomInAboveZoomOut: metrics["zoom-in"].top < metrics["zoom-out"].top,
          zoomRowsAdjacent: metrics["zoom-out"].top - metrics["zoom-in"].top === 48,
          bottomAligned: metrics["zoom-out"].top === metrics["rv-rc-fow"].top
        };
      })
    )
    .toEqual({
      zoomColumnLeftAligned: true,
      controlColumnLeftAligned: true,
      zoomLeftOfControls: true,
      rightColumnStacks: true,
      zoomInAboveZoomOut: true,
      zoomRowsAdjacent: true,
      bottomAligned: true
    });

  const timerBeforeScrub = await page.locator("#rv-rc-timer").textContent();
  await page.evaluate(() => {
    isDown = true;
    document.getElementById("sliderOutput").value = 150;
    $("#game-slider").trigger("moved.zf.slider");
  });
  await expect(page.locator("#rv-rc-timer")).toHaveClass(/scrub-preview/);
  await expect(page.locator("#rv-rc-timer")).not.toHaveText(timerBeforeScrub);
  await page.evaluate(() => {
    isDown = false;
    scrubPreviewFrame = null;
    update_timer(_replay_get_value(2));
  });
  await expect(page.locator("#rv-rc-timer")).not.toHaveClass(/scrub-preview/);

  assertCleanLogs(logs);
});

test("volume and mute settings persist across reloads", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page);

  await page.evaluate(() => {
    volumeSettings.level = 0.27;
    volumeSettings.muted = true;
    localStorage.volumeSettings = JSON.stringify(volumeSettings);
    update_sound_button_state();
    update_overall_volume_slider_ui();
    Module.set_volume(0);
  });
  await page.reload();
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        stored: JSON.parse(localStorage.volumeSettings || "{}"),
        mutedClass: document.querySelector("#rv-rc-sound")?.className || "",
        output: document.querySelector("#volumeOutput")?.value || ""
      }))
    )
    .toEqual({
      stored: { level: 0.27, muted: true },
      mutedClass: expect.stringContaining("rv-rc-muted"),
      output: "27"
    });

  assertCleanLogs(logs);
});

test("footer volume hover slider visibly tracks overall volume from settings", async ({ page }) => {
  const logs = await createLogCollectors(page, { disableAudio: false });

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page);

  await forceClick(page, "#rv-rc-export-settings");
  await forceClick(page, "#settings-tab-audio");
  await page.fill("#audio-overall-slider", "25");
  await page.dispatchEvent("#audio-overall-slider", "input");
  await forceClick(page, "#export_settings .close-button");
  await page.hover("#rv-rc-sound");
  await expect(page.locator("#volume-slider-wrapper")).toBeVisible();
  const lowVolume = await getFooterVolumeHandleTop(page);

  await forceClick(page, "#rv-rc-export-settings");
  await forceClick(page, "#settings-tab-audio");
  await page.fill("#audio-overall-slider", "75");
  await page.dispatchEvent("#audio-overall-slider", "input");
  await forceClick(page, "#export_settings .close-button");
  await page.hover("#rv-rc-sound");
  await expect(page.locator("#volume-slider-wrapper")).toBeVisible();
  const highVolume = await getFooterVolumeHandleTop(page);

  expect(lowVolume.sliderHeight).toBeGreaterThan(0);
  expect(lowVolume.handleTop - highVolume.handleTop).toBeGreaterThan(20);
  await expect(page.locator("#volumeOutput")).toHaveValue("75");
  await expect(page.locator("#volume-slider-handle")).toHaveAttribute("aria-valuenow", "75");

  assertCleanLogs(logs);
});

test("zoom out clamps to a safe render size on large viewports", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 2560, height: 1440 });
  await loadReplay(page);

  await page.evaluate(() => {
    for (let i = 0; i < 5; i += 1) zoomOut();
  });

  await expect
    .poll(() =>
      page.evaluate(() => ({
        zoomLevel: localStorage.zoomLevel,
        width: Module.canvas.width,
        height: Module.canvas.height,
        safe: typeof _ui_can_resize === "function" ? _ui_can_resize(Module.canvas.width, Module.canvas.height) : 1,
        fatalTitle: document.querySelector("#rv_modal h3")?.textContent || ""
      }))
    )
    .toMatchObject({
      zoomLevel: "-3",
      width: 3408,
      safe: 1,
      fatalTitle: "Loading files"
    });
  const clampedSize = await page.evaluate(() => ({
    width: Module.canvas.width,
    height: Module.canvas.height
  }));
  expect(clampedSize.height).toBeGreaterThanOrEqual(1700);
  expect(clampedSize.height).toBeLessThanOrEqual(1800);

  assertCleanLogs(logs);
});

test.fixme("manual camera movement suppresses auto camera for three seconds", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page);
  await page.waitForTimeout(1000);
  await page.evaluate(() => _replay_set_value(1, 1));

  const before = await page.evaluate(() => ({
    x: _ui_get_screen_pos(0),
    y: _ui_get_screen_pos(1)
  }));

  await page.evaluate(() => {
    _ui_set_screen_center_manual(Math.round(Module.canvas.width / 2), Math.round(Module.canvas.height / 2));
  });

  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => ({
    x: _ui_get_screen_pos(0),
    y: _ui_get_screen_pos(1)
  }));

  expect(Math.abs(after.x - 0)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - 0)).toBeLessThanOrEqual(2);
  expect(Math.abs(before.x - after.x) + Math.abs(before.y - after.y)).toBeGreaterThan(10);

  await page.evaluate(() => _replay_set_value(1, 0));
  await page.waitForTimeout(1500);
  const duringHold = await page.evaluate(() => ({
    x: _ui_get_screen_pos(0),
    y: _ui_get_screen_pos(1)
  }));
  expect(Math.abs(duringHold.x - after.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(duringHold.y - after.y)).toBeLessThanOrEqual(2);

  assertCleanLogs(logs);
});

test("bottom bar stays single-line and hides stats progressively on narrow viewports", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1100, height: 700 });
  await loadReplay(page);

  await expect(page.locator("#info-dock")).toBeHidden();
  await expect(page.locator("#race1")).toBeVisible();
  await expect(page.locator("#apm1")).toBeVisible();
  await expect(page.locator("#army1")).toBeVisible();
  await expect(page.locator("#workers1")).toBeVisible();
  await expect(page.locator("#minerals1")).toBeVisible();
  await expect(page.locator("#gas1")).toBeVisible();
  await expect(page.locator("#supply1")).toBeVisible();

  await page.setViewportSize({ width: 800, height: 700 });
  await expect(page.locator("#info-dock")).toBeHidden();
  await expect(page.locator("#race1")).toBeVisible();
  await expect(page.locator("#apm1")).toBeHidden();
  await expect(page.locator("#army1")).toBeVisible();
  await expect(page.locator("#workers1")).toBeVisible();
  await expect(page.locator("#supply1")).toBeVisible();
  await expect(page.locator("#minerals1")).toBeHidden();
  await expect(page.locator("#gas1")).toBeHidden();
  await expect(page.locator("#nick1")).toContainText("PurpleWave");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const nickRect = document.getElementById("nick1").getBoundingClientRect();
        const supplyRect = document.getElementById("supply1").getBoundingClientRect();
        return {
          nickWidth: Math.round(nickRect.width),
          supplyWidth: Math.round(supplyRect.width)
        };
      })
    )
    .toMatchObject({
      nickWidth: expect.any(Number),
      supplyWidth: expect.any(Number)
    });
  const widthChecks = await page.evaluate(() => {
    const nickRect = document.getElementById("nick1").getBoundingClientRect();
    const supplyRect = document.getElementById("supply1").getBoundingClientRect();
    return {
      nickWidth: Math.round(nickRect.width),
      supplyWidth: Math.round(supplyRect.width)
    };
  });
  expect(widthChecks.nickWidth).toBeGreaterThanOrEqual(224);
  expect(widthChecks.supplyWidth).toBeGreaterThanOrEqual(100);

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

test("zooming in and out stops at the configured +/-4 cap", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const zoomState = await page.evaluate(() => {
    zoomLevel = 0;
    localStorage.zoomLevel = "0";
    resize_canvas(Module.canvas);
    for (let i = 0; i < 10; ++i) {
      zoomOut();
    }
    const minZoomLevel = String(localStorage.zoomLevel || "0");
    zoomOut();
    const minZoomLevelAfterExtra = String(localStorage.zoomLevel || "0");
    for (let i = 0; i < 20; ++i) {
      zoomIn();
    }
    const maxZoomLevel = String(localStorage.zoomLevel || "0");
    zoomIn();
    const maxZoomLevelAfterExtra = String(localStorage.zoomLevel || "0");
    return {
      minZoomLevel,
      minZoomLevelAfterExtra,
      maxZoomLevel,
      maxZoomLevelAfterExtra
    };
  });

  expect(zoomState.minZoomLevel).toBe("-4");
  expect(zoomState.minZoomLevelAfterExtra).toBe("-4");
  expect(zoomState.maxZoomLevel).toBe("4");
  expect(zoomState.maxZoomLevelAfterExtra).toBe("4");
  assertCleanLogs(logs);
});

test("player label row moves above the first player row for more than two players", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page, "/workspace/replays/Multiplayer.rep", null);

  await expect(page.locator('.infobar-text[class~="5player"]')).toBeVisible();
  await expect(page.locator('.infobar-text[class~="2player"]')).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const labelTop = document.querySelector('.infobar-text[class~="5player"]').getBoundingClientRect().top;
        const rowTop = document.getElementById("infobar_row_player1").getBoundingClientRect().top;
        const dockHeaderTop = document.querySelector("#info-dock .info-dock-header").getBoundingClientRect().top;
        const dockRowTop = document.querySelector("#info_tab_panel1 .per-player-info1").getBoundingClientRect().top;
        const row2Top = document.querySelector("#infobar .per-player-info2").getBoundingClientRect().top;
        const prod2Top = document.querySelector("#info_tab_panel1 .per-player-info2").getBoundingClientRect().top;
        return {
          mainLabelAboveRow: labelTop < rowTop,
          dockLabelAboveRow: dockHeaderTop < dockRowTop,
          row2Aligned: Math.abs(row2Top - prod2Top) <= 1,
          multiplayer: players.length > 2
        };
      })
    )
    .toEqual({
      mainLabelAboveRow: true,
      dockLabelAboveRow: true,
      row2Aligned: true,
      multiplayer: true
    });

  await expect(page.locator("#vision4")).toBeVisible();
  await forceClick(page, "#vision4");
  await expect(page.locator("#vision4")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[3]))).toBe(0);
  await forceClick(page, "#vision4");
  await expect(page.locator("#vision4")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[3]))).toBe(1);

  assertCleanLogs(logs);
});

test("scaled dock strips wrap into multiple rows before clipping icons", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page);

  const layout = await page.evaluate(() => {
    const element = document.getElementById("production_tab_content1");
    element.style.width = "120px";
    element.style.flex = "0 0 120px";
    element.style.maxWidth = "120px";
    Array.from(element.children).forEach((child, index) => {
      child.style.display = index < 18 ? "inline-block" : "none";
    });
    apply_info_strip_scale($(element));
    const visibleTops = Array.from(element.children)
      .filter((child) => child.style.display !== "none")
      .map((child) => Math.round(child.getBoundingClientRect().top));
    return {
      scale: element.getAttribute("data-scale"),
      rowCount: new Set(visibleTops).size
    };
  });

  expect(["2", "3", "4", "dynamic"]).toContain(layout.scale);
  if (layout.scale === "dynamic") {
    expect(layout.rowCount).toBe(1);
  } else {
    expect(layout.rowCount).toBeGreaterThan(1);
  }

  const threshold = await page.evaluate(() => {
    const element = document.getElementById("army_tab_content1");
    const production = document.getElementById("production_tab_content1");
    element.style.width = "161px";
    element.style.flex = "0 0 161px";
    element.style.maxWidth = "161px";
    Array.from(element.children).forEach((child, index) => {
      child.style.display = index < 6 ? "inline-block" : "none";
    });
    apply_info_strip_scale($(element));
    production.style.width = "420px";
    production.style.flex = "0 0 420px";
    production.style.maxWidth = "420px";
    Array.from(production.children).forEach((child, index) => {
      child.style.display = index < 4 ? "inline-block" : "none";
    });
    apply_info_strip_scale($(production));
    production.style.width = "190px";
    production.style.flex = "0 0 190px";
    production.style.maxWidth = "190px";
    Array.from(production.children).forEach((child, index) => {
      child.style.display = index < 10 ? "inline-block" : "none";
    });
    apply_info_strip_scale($(production));
    const visible = Array.from(element.children)
      .filter((child) => child.style.display !== "none")
      .map((child) => child.getBoundingClientRect());
    const container = element.getBoundingClientRect();
    const productionBarStyle = getComputedStyle(production.querySelector(".prod_prog_bar"));
    const productionRects = Array.from(production.children)
      .filter((child) => child.style.display !== "none")
      .map((child) => {
        const rect = child.getBoundingClientRect();
        const barRect = child.querySelector(".prod_prog_bar").getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          right: Math.round(rect.right),
          barBottom: Math.round(barRect.bottom),
          barHeight: Math.round(barRect.height)
        };
      });
    const productionRows = [...new Set(productionRects.map((rect) => Math.round(rect.top)))];
    return {
      scale: element.getAttribute("data-scale"),
      unclipped: Math.round(visible[visible.length - 1].right) <= Math.round(container.right),
      rowGapRemoved:
        Math.round(
          document.querySelector("#info_tab_panel2 .per-player-info1 .info_tab_content").getBoundingClientRect().left
        ) ===
        Math.round(
          document.querySelector("#info_tab_panel2 .per-player-info1 .info_tab_player_color").getBoundingClientRect().right
        ),
      progressBarMaxWidth: Math.round(parseFloat(productionBarStyle.maxWidth || "0")),
      progressBarHeight: Math.round(parseFloat(productionBarStyle.height || "0")),
      productionRowCount: productionRows.length,
      productionFirstRowCount: productionRects.filter((rect) => rect.top === productionRows[0]).length,
      productionFits: productionRects[productionRects.length - 1].bottom <= Math.round(production.getBoundingClientRect().bottom),
      productionBarsFit: productionRects.every((rect) => rect.barBottom <= rect.bottom),
      productionBarsVisible: productionRects.every((rect) => rect.barHeight >= 1)
    };
  });

  expect(["2", "3", "4", "dynamic"]).toContain(threshold.scale);
  expect(threshold.unclipped).toBe(true);
  expect(threshold.rowGapRemoved).toBe(true);
  expect(threshold.progressBarMaxWidth).toBeGreaterThan(0);
  expect(threshold.progressBarHeight).toBeGreaterThan(0);
  expect(threshold.productionFirstRowCount).toBe(10);
  expect(threshold.productionFits).toBe(true);
  expect(threshold.productionBarsFit).toBe(true);
  expect(threshold.productionBarsVisible).toBe(true);

  assertCleanLogs(logs);
});

test("playlist controls render the active replay and responsive name hiding", async ({ page }) => {
  const logs = await createLogCollectors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const browse = document.querySelector("#select_replay_label");
        return !!browse && !browse.classList.contains("disabled");
      })
    )
    .toBe(true);
  await page.evaluate(
    () => {
      read_replay_entry = function() {};
      document.body.classList.remove("pregame-active");
      Module.canvas.style.position = "absolute";
      set_replay_playlist([
        { file: { name: "Alpha.rep" }, label: "folder/Alpha.rep" },
        { file: { name: "Beta.rep" }, label: "folder/Beta.rep" }
      ], 0);
      update_replay_playlist_controls();
    }
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        update_replay_playlist_controls();
        const controls = document.querySelector("#playlist-controls");
        return controls
          ? {
              position: document.querySelector("#playlist-position")?.textContent || "",
              name: document.querySelector("#playlist-name")?.textContent || ""
            }
          : null;
      })
    )
    .toEqual({
      position: "#1 of 2",
      name: "Alpha.rep"
    });
  await expect(page.locator("#playlist-prev")).toBeEnabled();
  const secondPlaylistState = await page.evaluate(() => {
    document.body.classList.remove("pregame-active");
    Module.canvas.style.position = "absolute";
    set_replay_playlist([
      { file: { name: "Alpha.rep" }, label: "folder/Alpha.rep" },
      { file: { name: "Beta.rep" }, label: "folder/Beta.rep" }
    ], 1);
    update_replay_playlist_controls();
    return {
      position: document.querySelector("#playlist-position")?.textContent || "",
      name: document.querySelector("#playlist-name")?.textContent || ""
    };
  });
  expect(secondPlaylistState).toEqual({
    position: "#2 of 2",
    name: "Beta.rep"
  });
  await expect(page.locator("#playlist-next")).toBeEnabled();
  const firstPlaylistState = await page.evaluate(() => {
    document.body.classList.remove("pregame-active");
    Module.canvas.style.position = "absolute";
    set_replay_playlist([
      { file: { name: "Alpha.rep" }, label: "folder/Alpha.rep" },
      { file: { name: "Beta.rep" }, label: "folder/Beta.rep" }
    ], 0);
    update_replay_playlist_controls();
    return document.querySelector("#playlist-position")?.textContent || "";
  });
  expect(firstPlaylistState).toBe("#1 of 2");
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator("#playlist-name")).toBeHidden();
  assertCleanLogs(logs);
});

test("export button records a WebM download flow", async ({ page }) => {
  await page.addInitScript(() => {
    window.__mockDownloads = [];
    window.__mockCaptureInfo = null;
    window.__mockMediaRecorderOptions = null;

    URL.createObjectURL = (blob) => {
      window.__mockDownloads.push({ size: blob.size, type: blob.type });
      return "blob:mock-openbw";
    };
    URL.revokeObjectURL = () => {};

    HTMLAnchorElement.prototype.click = function() {
      window.__mockDownloadName = this.download;
      window.__mockDownloadHref = this.href;
    };

    HTMLCanvasElement.prototype.captureStream = function(fps) {
      window.__mockCaptureInfo = {
        fps,
        width: this.width,
        height: this.height
      };
      return {
        getTracks() {
          return [{ stop() {} }];
        }
      };
    };

    class MockMediaRecorder {
      constructor(stream, options) {
        this.state = "inactive";
        window.__mockMediaRecorderOptions = options || {};
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

  await forceClick(page, "#rv-rc-export-settings");
  await expect(page.locator("#export_settings")).toBeVisible();
  await page.fill("#export-width", "1280");
  await page.fill("#export-height", "720");
  await page.fill("#export-fps", "30");
  await page.fill("#export-bitrate", "16.5");
  await expect(page.locator("#export-settings-save")).toHaveCount(0);
  await expect(page.locator("#export-settings-reset")).toContainText("Reset");
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.exportSettings || "{}")))
    .toEqual({ width: 1280, height: 720, fps: 30, videoBitrateMbps: 16.5 });
  await forceClick(page, "#export_settings .close-button");
  await expect(page.locator("#export_settings")).toBeHidden();

  await forceClick(page, "#rv-rc-play");
  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(1);
  const startFrame = await page.evaluate(() => _replay_get_value(2));
  await forceClick(page, "#rv-rc-export");
  await expect(page.locator("#rv-rc-export")).toHaveClass(/is-exporting/);
  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(0);
  await expect
    .poll(() => page.evaluate((frame) => _replay_get_value(2) > frame, startFrame), { timeout: 15000 })
    .toBe(true);
  await forceClick(page, "#rv-rc-export");
  await expect(page.locator("#rv-rc-export")).not.toHaveClass(/is-exporting/);
  await expect
    .poll(() => page.evaluate(() => window.__mockDownloads.length), { timeout: 15000 })
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__mockDownloadName))
    .toMatch(/PurpleWave - Monster, \d{2}m\d{2}s - \d{2}m\d{2}s\.webm$/);
  await expect
    .poll(() => page.evaluate(() => window.__mockDownloads[0].size))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.__mockCaptureInfo))
    .toEqual({ fps: 30, width: 1280, height: 720 });
  await expect
    .poll(() => page.evaluate(() => window.__mockMediaRecorderOptions))
    .toEqual({ mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 16500000 });

  assertCleanLogs(logs);
});

test("clip HUD buttons match the floating HUD style and export resize stays centered", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.captureStream = function() {
      return { getTracks() { return [{ stop() {} }]; } };
    };
    class MockMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      constructor() {
        this.state = "inactive";
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) this.ondataavailable({ data: new Blob(["openbw-export"], { type: "video/webm" }) });
        if (this.onstop) this.onstop();
      }
    }
    window.MediaRecorder = MockMediaRecorder;
    window.URL.createObjectURL = () => "blob:mock";
    window.URL.revokeObjectURL = () => {};
  });

  await loadReplay(page);
  await page.evaluate(() => {
    _observer_set_value(0);
    _ui_set_screen_center_manual(2000, 2000);
  });
  await page.waitForTimeout(300);

  await forceClick(page, "#rv-rc-export-settings");
  await page.fill("#export-width", "1280");
  await page.fill("#export-height", "720");
  await forceClick(page, "#export_settings .close-button");

  const before = await page.evaluate(() => {
    const area = document.querySelector("#canvas-area").getBoundingClientRect();
    const canvas = Module.canvas.getBoundingClientRect();
    return {
      centerX: _ui_get_screen_pos(0) + Module.canvas.width / 2,
      centerY: _ui_get_screen_pos(1) + Module.canvas.height / 2,
      areaCenterX: Math.round(area.width / 2),
      areaCenterY: Math.round(area.height / 2),
      exportBg: getComputedStyle(document.querySelector("#rv-rc-export")).backgroundColor,
      exportBorder: getComputedStyle(document.querySelector("#rv-rc-export")).borderTopColor,
      exportColor: getComputedStyle(document.querySelector("#rv-rc-export")).color
    };
  });

  await forceClick(page, "#rv-rc-export");
  await page.waitForTimeout(250);

  const during = await page.evaluate(() => {
    const area = document.querySelector("#canvas-area").getBoundingClientRect();
    const canvas = Module.canvas.getBoundingClientRect();
    return {
      centerX: _ui_get_screen_pos(0) + Module.canvas.width / 2,
      centerY: _ui_get_screen_pos(1) + Module.canvas.height / 2,
      canvasCenterX: Math.round((canvas.left - area.left) + canvas.width / 2),
      canvasCenterY: Math.round((canvas.top - area.top) + canvas.height / 2),
      areaCenterX: Math.round(area.width / 2),
      areaCenterY: Math.round(area.height / 2)
    };
  });

  expect(before.exportBorder).toBe("rgb(77, 85, 100)");
  expect(before.exportColor).toBe("rgb(208, 212, 222)");
  expect(Math.abs(during.canvasCenterX - during.areaCenterX)).toBeLessThanOrEqual(1);
  expect(Math.abs(during.canvasCenterY - during.areaCenterY)).toBeLessThanOrEqual(1);
  expect(Math.abs(during.centerX - before.centerX)).toBeLessThanOrEqual(2);
  expect(Math.abs(during.centerY - before.centerY)).toBeLessThanOrEqual(2);

  assertCleanLogs(logs);
});

test("settings modal uses audio and video tabs with immediate persistence", async ({ page }) => {
  const logs = await createLogCollectors(page, { disableAudio: false });

  await loadReplay(page);
  await page.mouse.click(50, 50);
  await page.evaluate(() => {
    musicState.unlocked = true;
    sync_viewer_runtime_state(true);
  });
  await forceClick(page, "#rv-rc-export-settings");
  await expect(page.locator("#export_settings h3")).toHaveText("Settings");
  await expect(page.locator("#export_settings p")).toHaveCount(0);
  await expect(page.locator("#export-settings-reset")).toHaveClass(/success/);
  await expect(page.locator("#audio-settings-reset")).toHaveClass(/success/);
  await expect(page.locator("#settings-tab-video")).toHaveClass(/is-active/);
  await forceClick(page, "#settings-tab-audio");
  await expect(page.locator("#settings-tab-audio")).toHaveClass(/is-active/);
  await expect(page.locator('[data-settings-panel="audio"]')).toBeVisible();
  await expect(page.locator('[data-settings-panel="video"]')).toBeHidden();
  await page.fill("#audio-overall-slider", "25");
  await page.dispatchEvent("#audio-overall-slider", "input");
  await page.fill("#audio-music-slider", "40");
  await page.dispatchEvent("#audio-music-slider", "input");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        volume: JSON.parse(localStorage.volumeSettings || "{}"),
        audioSettings: JSON.parse(localStorage.audioCategorySettings || "{}"),
        musicVolume: window.musicState && window.musicState.audio ? window.musicState.audio.volume : null,
        footerSlider: {
          value: document.querySelector("#volumeOutput")?.value || "",
          aria: document.querySelector("#volume-slider-handle")?.getAttribute("aria-valuenow") || ""
        }
      }))
    )
    .toEqual({
      volume: { level: 0.25, muted: false },
      audioSettings: {
        combat: { enabled: true, level: 1 },
        acknowledgements: { enabled: true, level: 1 },
        music: { enabled: true, level: 0.4 }
      },
      musicVolume: 0.1,
      footerSlider: {
        value: "25",
        aria: "25"
      }
    });
  await forceClick(page, "#audio-settings-reset");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        volume: JSON.parse(localStorage.volumeSettings || "{}"),
        audioSettings: JSON.parse(localStorage.audioCategorySettings || "{}"),
        soundClass: document.querySelector("#audio-overall-toggle")?.className || "",
        footerSlider: {
          value: document.querySelector("#volumeOutput")?.value || "",
          aria: document.querySelector("#volume-slider-handle")?.getAttribute("aria-valuenow") || ""
        },
        runtime: {
          overall: typeof Module.get_volume === "function" ? Module.get_volume() : null,
          combat: typeof Module.get_combat_volume === "function" ? Module.get_combat_volume() : null,
          acknowledgements: typeof Module.get_acknowledgement_volume === "function" ? Module.get_acknowledgement_volume() : null
        }
      }))
    )
    .toEqual({
      volume: { level: 0.5, muted: false },
      audioSettings: {
        combat: { enabled: true, level: 1 },
        acknowledgements: { enabled: true, level: 1 },
        music: { enabled: true, level: 0.25 }
      },
      soundClass: expect.stringContaining("rv-rc-sound"),
      footerSlider: {
        value: "50",
        aria: "50"
      },
      runtime: {
        overall: 0.5,
        combat: 1,
        acknowledgements: 1
      }
    });
  await forceClick(page, "#settings-tab-video");
  await expect(page.locator('[data-settings-panel="video"]')).toBeVisible();
  await expect(page.locator('[data-settings-panel="audio"]')).toBeHidden();
  await expect(page.locator("#export-width")).toHaveJSProperty("value", "1280");
  await forceClick(page, "#settings-tab-audio");
  await page.fill("#audio-overall-slider", "100");
  await page.dispatchEvent("#audio-overall-slider", "input");
  await page.fill("#audio-music-slider", "100");
  await page.dispatchEvent("#audio-music-slider", "input");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        volume: JSON.parse(localStorage.volumeSettings || "{}"),
        audioSettings: JSON.parse(localStorage.audioCategorySettings || "{}"),
        musicVolume: window.musicState && window.musicState.audio ? window.musicState.audio.volume : null
      }))
    )
    .toEqual({
      volume: { level: 1, muted: false },
      audioSettings: {
        combat: { enabled: true, level: 1 },
        acknowledgements: { enabled: true, level: 1 },
        music: { enabled: true, level: 1 }
      },
      musicVolume: 1
    });
  await forceClick(page, "#settings-tab-video");
  await expect
    .poll(() => page.evaluate(() => localStorage.settingsModalTab))
    .toBe("video");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const widthInput = document.querySelector("#export-width");
        const widthStyle = getComputedStyle(widthInput);
        const widthLabel = getComputedStyle(document.querySelector("#export_settings .input-group-label"));
        const unitLabel = getComputedStyle(document.querySelector("#export_settings .input-group .input-group-label:last-child"));
        return {
          inputWidth: parseFloat(widthStyle.maxWidth),
          labelAlign: widthLabel.textAlign,
          unitOffset: parseFloat(unitLabel.marginLeft),
          valueFits: widthInput.scrollWidth <= widthInput.clientWidth
        };
      })
    )
    .toMatchObject({
      labelAlign: "left"
    });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        inputWidth: parseFloat(getComputedStyle(document.querySelector("#export-width")).maxWidth),
        unitOffset: parseFloat(getComputedStyle(document.querySelector("#export_settings .input-group .input-group-label:last-child")).marginLeft),
        unitWidth: parseFloat(getComputedStyle(document.querySelector("#export_settings .input-group .input-group-label:last-child")).width),
        valueFits: document.querySelector("#export-width").scrollWidth <= document.querySelector("#export-width").clientWidth
      }))
    )
    .toMatchObject({
      inputWidth: 71.2578,
      unitOffset: 6.4,
      valueFits: true
    });
  await expect
    .poll(() =>
      page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("#export_settings .input-group .input-group-label:last-child")).width))
    )
    .toBeGreaterThan(15);
  await forceClick(page, "#export_settings .close-button");
  await forceClick(page, "#rv-rc-export-settings");
  await expect(page.locator("#settings-tab-video")).toHaveClass(/is-active/);
  await expect(page.locator('[data-settings-panel="video"]')).toBeVisible();

  assertCleanLogs(logs);
});

test("timestamped link button is hidden for local replays and hidden again after switching away from a rep query replay", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await loadReplay(page);
  await expect(page.locator("#rv-rc-copy-link")).toBeHidden();

  await loadRemoteReplay(page, basilReplayUrl);
  await expect(page.locator("#rv-rc-copy-link")).toBeVisible();

  await page.setInputFiles("#select_rep_file", defaultReplayPath);
  await expect
    .poll(() => page.evaluate(() => (typeof _replay_get_value === "function" ? _replay_get_value(4) : 0)), { timeout: 30000 })
    .toBeGreaterThan(0);
  await expect(page.locator("#rv-rc-copy-link")).toBeHidden();

  assertAllCleanLogs(logs);
});

test("viewport export buttons are ordered link then clip then settings and video clip fields stack one per row", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await loadRemoteReplay(page, basilReplayUrl);
  const buttonPositions = await page.evaluate(() =>
    ["rv-rc-copy-link", "rv-rc-export", "rv-rc-export-settings"].map((id) => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return { id, left: Math.round(rect.left), top: Math.round(rect.top) };
    })
  );
  expect(buttonPositions[0].left).toBeLessThan(buttonPositions[1].left);
  expect(buttonPositions[1].left).toBeLessThan(buttonPositions[2].left);

  await forceClick(page, "#rv-rc-export-settings");
  await forceClick(page, "#settings-tab-video");
  const rows = await page.evaluate(() =>
    ["export-width", "export-height", "export-fps", "export-bitrate"].map((id) => {
      const group = document.getElementById(id).closest(".input-group");
      const rect = group.getBoundingClientRect();
      return { id, top: Math.round(rect.top), width: Math.round(rect.width), display: getComputedStyle(group).display };
    })
  );
  const tops = rows.map((row) => row.top);
  expect(new Set(tops).size).toBe(4);
  expect(tops[0]).toBeLessThan(tops[1]);
  expect(tops[1]).toBeLessThan(tops[2]);
  expect(tops[2]).toBeLessThan(tops[3]);
  expect(rows.every((row) => row.display === "flex")).toBe(true);

  assertAllCleanLogs(logs);
});

test("music playlist uses the first player's race only", async ({ page }) => {
  const logs = await createLogCollectors(page, { disableAudio: false });

  await loadReplay(page);
  await expect.poll(() => page.evaluate(() => (window.musicState ? window.musicState.playlist.length : 0))).toBe(4);
  const playlistState = await page.evaluate(() => ({
    firstPlayerRace: _player_get_value(players[0], C_RACE),
    playlist: window.musicState ? window.musicState.playlist.slice() : []
  }));
  const racePrefix = ["Zerg", "Terran", "Protoss"][playlistState.firstPlayerRace];
  expect(playlistState.playlist).toHaveLength(4);
  expect(playlistState.playlist.every((url) => url.includes(racePrefix))).toBe(true);
  expect(playlistState.playlist.some((url) => /Protoss|Terran|Zerg/.test(url) && !url.includes(racePrefix))).toBe(false);

  assertCleanLogs(logs);
});

test("music stays in sync with frame advancement across focus changes", async ({ page }) => {
  const logs = await createLogCollectors(page, { disableAudio: false });

  await page.goto("/");
  const state = await page.evaluate(async () => {
    audioCategorySettings.music.enabled = true;
    let currentFrame = 100;
    window.main_has_been_called = true;
    window._replay_get_value = (key) => {
      if (key === 1) return 0;
      if (key === 2) return currentFrame;
      if (key === 4) return 200;
      return 0;
    };
    musicState.unlocked = true;
    musicState.playlist = ["track.mp3"];
    musicState.audio = {
      paused: false,
      pauseCalls: 0,
      playCalls: 0,
      pause() {
        this.paused = true;
        this.pauseCalls += 1;
      },
      play() {
        this.paused = false;
        this.playCalls += 1;
        return Promise.resolve();
      }
    };
    reset_playback_state_monitor();
    playbackStateMonitor.lastFrame = currentFrame - 1;
    note_viewer_frame_progress(currentFrame);
    sync_viewer_runtime_state();
    viewerWindowFocused = false;
    sync_viewer_runtime_state();
    viewerWindowFocused = true;
    sync_viewer_runtime_state();
    currentFrame = 101;
    note_viewer_frame_progress(currentFrame);
    sync_viewer_runtime_state();
    return {
      pauseCalls: musicState.audio.pauseCalls,
      playCalls: musicState.audio.playCalls,
      paused: musicState.audio.paused
    };
  });
  expect(state).toEqual({
    pauseCalls: 0,
    playCalls: 0,
    paused: false
  });

  assertCleanLogs(logs);
});

test("nuclear launch alert increments the matching acknowledgement sound when the alert text fires", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page, { disableAudio: false });

  await page.addInitScript(() => {
    localStorage.volumeSettings = JSON.stringify({ level: 1, muted: false });
    localStorage.audioCategorySettings = JSON.stringify({
      combat: { enabled: true, level: 1 },
      acknowledgements: { enabled: true, level: 1 },
      music: { enabled: false, level: 0.25 }
    });
  });

  await loadReplay(page, nukeReplayPath);
  await page.mouse.click(50, 50);
  const expectedSoundId = await page.evaluate(() => {
    const race = _player_get_value(players[Module.get_primary_perspective_player()], C_RACE);
    return 127 + (race === 1 ? 1 : race === 2 ? 2 : 0);
  });
  await page.evaluate(() => {
    _replay_set_value(0, 128);
    _replay_set_value(1, 0);
  });

  let launchState = null;
  await expect
    .poll(
      () =>
        page.evaluate((id) => ({
          state: {
            alertCount: Module.get_nuclear_launch_alert_count(),
            soundCount: Module.get_acknowledgement_sound_play_count(id),
            lastAck: Module.get_last_acknowledgement_sound_id()
          }
        }), expectedSoundId).then((result) => {
          launchState = result.state;
          return launchState.alertCount > 0 && launchState.soundCount > 0 && launchState.lastAck === expectedSoundId;
        }),
      { timeout: 60000 }
    )
    .toBe(true);

  expect(launchState.alertCount).toBeGreaterThan(0);
  expect(launchState.soundCount).toBeGreaterThan(0);
  expect(launchState.lastAck).toBe(expectedSoundId);

  assertCleanLogs(logs);
});

test.fixme("first-player acknowledgement sounds actually trigger during playback", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page, { disableAudio: false });

  await loadReplay(page);
  await page.mouse.click(50, 50);
  await page.evaluate(() => {
    _replay_set_value(1, 0);
    _replay_set_value(0, 128);
  });
  await page.waitForTimeout(20000);
  const ackState = await page.evaluate(() => ({
    frame: _replay_get_value(2),
    primary: typeof Module.get_primary_perspective_player === "function" ? Module.get_primary_perspective_player() : null,
    ackCount: typeof Module.get_acknowledgement_play_count === "function" ? Module.get_acknowledgement_play_count() : null
  }));
  expect(ackState.primary).toBe(0);
  expect(ackState.frame).toBeGreaterThan(0);
  expect(ackState.ackCount).toBeGreaterThan(0);

  assertCleanLogs(logs);
});

test("loading a replay from URL uses the home screen instead of the status modal", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.addInitScript(() => {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__mockReplayUrl = url;
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      if (this.__mockReplayUrl === "/remote.rep") {
        const req = this;
        setTimeout(() => {
          Object.defineProperty(req, "readyState", { configurable: true, value: XMLHttpRequest.DONE });
          Object.defineProperty(req, "status", { configurable: true, value: 404 });
          Object.defineProperty(req, "statusText", { configurable: true, value: "Not Found" });
          if (typeof req.onreadystatechange === "function") req.onreadystatechange();
        }, 0);
        return;
      }
      return originalSend.apply(this, arguments);
    };
  });

  await page.goto("/?rep=/remote.rep");
  await expect(page.locator("#pregame-overlay")).toBeVisible();
  await expect(page.locator(".pregame-dropzone")).toHaveClass(/pregame-dropzone-status/);
  await expect(page.locator(".pregame-dropzone")).toContainText("Loading replay");
  await expect(page.locator(".pregame-dropzone")).toContainText("fetching /remote.rep: Not Found");
  await expect
    .poll(() =>
      page.evaluate(() => Math.round(document.querySelector(".pregame-status-message").getBoundingClientRect().width))
    )
    .toBeGreaterThanOrEqual(700);
  await expect(page.locator("#rv_modal")).toBeHidden();

  assertCleanLogs(logs);
});

test("embedded demo page targets the filtered iframe viewer", async ({ page }) => {
  await page.goto("/embedded.html");
  await expect(page.locator("h1")).toHaveText("Embedded BASIL Replay Stream");
  await expect(page.locator("iframe.demo-frame")).toHaveAttribute("src", "./?embedded=1&player=Purple&maxMinutes=25");
});

test("embedded mode shows a skip button and loading replay screen", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (String(url).includes("games_24h.json")) {
        return new Response(JSON.stringify({
          bots: [{ name: "PurpleWave", race: "P", rank: "A", rating: 3000 }, { name: "Monster", race: "Z", rank: "A", rating: 3000 }],
          maps: ["Tau Cross"],
          results: [{
            botA: { botIndex: 0, race: "P", winner: true, loser: false, crashed: false },
            botB: { botIndex: 1, race: "Z", winner: false, loser: true, crashed: false },
            invalidGame: false,
            realTimeout: false,
            frameTimeout: false,
            endedAt: 1774286000,
            mapIndex: 0,
            gameHash: "CTR_TEST1234",
            frameCount: 12000,
            gameEvents: null
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(url, options);
    };
  });

  await page.goto("/?embedded=1&player=Purple&maxMinutes=25");
  await expect(page.locator(".pregame-dropzone")).toContainText("Loading replay");
  await expect(page.locator(".pregame-dropzone")).toContainText("CTR_TEST1234");
  await expect(page.locator("#rv_modal")).toBeHidden();

  await loadReplay(page);
  await page.evaluate(() => {
    $('#rv-rc-next-embedded-wrap').css('display', 'flex');
  });
  await expect(page.locator("#rv-rc-next-embedded-wrap")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        bg: getComputedStyle(document.querySelector("#rv-rc-next-embedded")).backgroundColor,
        image: getComputedStyle(document.querySelector("#rv-rc-next-embedded")).backgroundImage,
        geometry: Array.from(document.querySelectorAll(".replay-control .rv-rc-controls > div"))
          .filter((node) => getComputedStyle(node).display !== "none")
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              left: Math.round(rect.left),
              width: Math.round(rect.width)
            };
          })
      }))
    )
    .toEqual({
      bg: "rgba(0, 0, 0, 0)",
      image: expect.stringContaining("fast-forward.svg"),
      geometry: [
        { left: expect.any(Number), width: 36 },
        { left: expect.any(Number), width: 36 },
        { left: expect.any(Number), width: 36 },
        { left: expect.any(Number), width: 36 },
        { left: expect.any(Number), width: 36 }
      ]
    });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const visible = Array.from(document.querySelectorAll(".replay-control .rv-rc-controls > div"))
          .filter((node) => getComputedStyle(node).display !== "none")
          .map((node) => node.getBoundingClientRect());
        const gaps = [];
        for (let i = 1; i < visible.length; i += 1) {
          gaps.push(Math.round(visible[i].left - visible[i - 1].right));
        }
        return gaps;
      })
    )
    .toEqual([8, 8, 8, 8]);
  expect(logs.pageErrors).toEqual([]);
});

test("info dock fits full-size target counts and uses dynamic single-row scaling before wrapping", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 2400, height: 1200 });
  await loadReplay(page);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const prod = document.querySelector("#production_tab_content1");
        const army = document.querySelector("#army_tab_content1");
        return {
          prodWidth: prod.clientWidth,
          armyWidth: army.clientWidth
        };
      })
    )
    .toEqual({
      prodWidth: expect.any(Number),
      armyWidth: expect.any(Number)
    });

  const dockState = await page.evaluate(() => {
    const make = (id, width, count) => {
      const el = document.createElement("div");
      el.id = id;
      el.className = "info_tab_content";
      el.style.width = width + "px";
      el.style.display = "flex";
      for (let i = 0; i < count; i += 1) {
        const child = document.createElement("div");
        child.style.display = "inline-block";
        el.appendChild(child);
      }
      document.body.appendChild(el);
      apply_info_strip_scale($(el));
      const result = {
        scale: el.getAttribute("data-scale"),
        width: getComputedStyle(el).getPropertyValue("--tile-width").trim()
      };
      el.remove();
      return result;
    };
    return {
      productionFitsTen: document.querySelector("#production_tab_content1").clientWidth >= (10 * 36 + 9),
      armyFitsFive: document.querySelector("#army_tab_content1").clientWidth >= (5 * 38 + 4),
      dynamicArmy: make("army_tab_content_test", 5 * 38 + 4, 6),
      dynamicProduction: make("production_tab_content_test", 10 * 36 + 9, 11)
    };
  });

  expect(dockState.productionFitsTen).toBe(true);
  expect(dockState.armyFitsFive).toBe(true);
  expect(dockState.dynamicArmy.scale).toBe("dynamic");
  expect(dockState.dynamicProduction.scale).toBe("dynamic");

  assertCleanLogs(logs);
});

test("upgrade strips switch to half-size wrapped layout at ten icons instead of continuing dynamic shrink", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.goto("/");
  const scaleState = await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "upgrade_tab_content_test";
    host.className = "info_tab_content";
    Object.defineProperty(host, "clientWidth", { value: 191, configurable: true });
    for (let i = 0; i < 14; ++i) {
      const child = document.createElement("div");
      host.appendChild(child);
    }
    document.body.appendChild(host);
    apply_info_strip_scale($(host));
    const scale = host.getAttribute("data-scale");
    document.body.removeChild(host);
    return scale;
  });

  expect(scaleState).toBe("2");
  assertCleanLogs(logs);
});

test("viewer toggle settings persist across reload", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await loadReplay(page);
  await forceClick(page, "#rv-rc-observer");
  await forceClick(page, "#rv-rc-fow");
  await forceClick(page, "#rv-rc-force-colors");
  await page.reload();
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  await page.setInputFiles("#select_rep_file", defaultReplayPath);
  await expect.poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => _observer_get_value())).toBe(0);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(0);
  await expect.poll(() => page.evaluate(() => _force_red_blue_colors_get_value())).toBe(1);

  assertCleanLogs(logs);
});

test("nuclear launch viewport alert banner tracks the canvas and uses plain white text styling", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.goto("/");
  const visibleState = await page.evaluate(() => {
      window.main_has_been_called = true;
      window._replay_get_value = (key) => (key === 4 ? 1 : 0);
      window.Module = window.Module || {};
      Module.get_nuclear_launch_alert_count = () => 1;
      viewportAlertState.lastNuclearLaunchAlertCount = 0;
      viewportAlertState.pendingNuclearLaunch = false;
      viewportAlertState.hideAt = 0;
      update_viewport_alert();
      const alert = document.querySelector("#viewport-alert");
      const canvas = document.querySelector("#canvas");
      const alertRect = alert.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const computed = window.getComputedStyle(alert);
      return {
        text: alert?.textContent || "",
        visible: alert?.classList.contains("is-visible") || false,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        borderTopWidth: computed.borderTopWidth,
        centerDelta: Math.round(Math.abs((alertRect.left + alertRect.width / 2) - (canvasRect.left + canvasRect.width / 2))),
        bottomInsideCanvas: Math.round(canvasRect.bottom - alertRect.bottom),
        topInsideCanvas: Math.round(alertRect.top - canvasRect.top)
      };
    });
  expect(visibleState.text).toBe("Nuclear launch detected.");
  expect(visibleState.visible).toBe(true);
  expect(visibleState.color).toBe("rgb(255, 255, 255)");
  expect(visibleState.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(visibleState.borderTopWidth).toBe("0px");
  expect(visibleState.centerDelta).toBeLessThanOrEqual(1);
  expect(visibleState.bottomInsideCanvas).toBeGreaterThanOrEqual(0);
  expect(visibleState.bottomInsideCanvas).toBeLessThanOrEqual(48);
  expect(visibleState.topInsideCanvas).toBeGreaterThanOrEqual(0);

  const hiddenState = await page.evaluate(() => {
    viewportAlertState.hideAt = Date.now() - 1;
    update_viewport_alert();
    return {
      text: document.querySelector("#viewport-alert")?.textContent || "",
      visible: document.querySelector("#viewport-alert")?.classList.contains("is-visible") || false
    };
  });
  expect(hiddenState).toEqual({
    text: "",
    visible: false
  });

  assertCleanLogs(logs);
});

test("fast-forward overlay shows the target time while catch-up is in progress", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.goto("/");
  const overlayState = await page.evaluate(() => {
    window.main_has_been_called = true;
    window._replay_get_value = (key) => {
      if (key === 2) return 1000;
      if (key === 3) return 2500;
      if (key === 4) return 5000;
      return 0;
    };
    viewportAlertState.lastNuclearLaunchAlertCount = 0;
    viewportAlertState.pendingNuclearLaunch = false;
    viewportAlertState.hideAt = 0;
    update_viewport_alert();
    const alert = document.querySelector("#viewport-alert");
    return {
      text: alert?.textContent || "",
      visible: alert?.classList.contains("is-visible") || false
    };
  });
  expect(overlayState).toEqual({
    text: "Fast-forwarding to 01:45",
    visible: true
  });

  assertCleanLogs(logs);
});

test.fixme("late-game camera scoring does not let stale offscreen idle scores beat an active viewport fight", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page);

  await loadReplay(page, nukeReplayPath, "Hannes");
  await page.evaluate(() => {
    _replay_set_value(3, 27 * 60 * 24);
    _replay_set_value(0, 128);
    _replay_set_value(1, 0);
  });
  await page.waitForFunction(() => Math.abs(_replay_get_value(2) - _replay_get_value(3)) < 8, null, { timeout: 120000 });
  let summary = null;
  await expect
    .poll(
      async () => {
        summary = await page.evaluate(() => {
          if (typeof Module.get_observer_debug_summary !== "function") return null;
          const summary = JSON.parse(Module.get_observer_debug_summary());
          if (summary.frame < 42300 || summary.bestViewport.score <= 100) return null;
          return summary;
        });
        return summary;
      },
      { timeout: 30000 }
    )
    .not.toBeNull();
  expect(summary.bestViewport.score).toBeGreaterThan(100);
  expect(summary.bestOffscreen.attention || summary.bestOffscreen.score <= 100).toBe(true);

  assertCleanLogs(logs);
});

test.fixme("late-game camera retains the current fight through brief attention dropouts", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page);

  await loadReplay(page, nukeReplayPath, "Hannes");
  const startFrame = Math.round((31 * 60 + 5) * 1000 / 42);
  const endFrame = Math.round((31 * 60 + 13) * 1000 / 42);
  await page.evaluate((frame) => {
    _replay_set_value(3, frame);
    _replay_set_value(0, 128);
    _replay_set_value(1, 0);
  }, startFrame);
  await page.waitForFunction((frame) => _replay_get_value(2) >= frame, startFrame, { timeout: 120000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const summary = JSON.parse(Module.get_observer_debug_summary());
          return summary.frame >= Math.round((31 * 60 + 5) * 1000 / 42) ? summary.viewportAttentionCount : 0;
        }),
      { timeout: 30000 }
    )
    .toBeGreaterThan(0);

  await page.waitForFunction((frame) => _replay_get_value(2) >= frame, endFrame, { timeout: 120000 });
  const summary = await page.evaluate(() => JSON.parse(Module.get_observer_debug_summary()));
  expect(summary.frame).toBeGreaterThanOrEqual(endFrame);
  expect(summary.viewportAttentionCount).toBe(0);
  expect(summary.retainViewportFight).toBe(true);

  assertCleanLogs(logs);
});

test("late-game stale viewport hold does not block a much stronger offscreen fight", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page);

  await loadReplay(page, nukeReplayPath, "Hannes");
  const frame = Math.round((32 * 60 + 9) * 1000 / 42);
  await page.evaluate((targetFrame) => {
    _replay_set_value(3, targetFrame);
    _replay_set_value(0, 128);
    _replay_set_value(1, 0);
  }, frame);
  await page.waitForFunction((targetFrame) => _replay_get_value(2) >= targetFrame, frame, { timeout: 120000 });

  let summary = null;
  await expect
    .poll(
      async () => {
        for (let i = 0; i < 10; ++i) {
          const value = await page.evaluate(() => JSON.parse(Module.get_observer_debug_summary()));
          if (
            value.frame >= Math.round((32 * 60 + 9) * 1000 / 42) &&
            value.staleViewportFightHold === true &&
            value.retainViewportFight === false &&
            value.bestViewport.score <= 2 &&
            value.bestOffscreen.score > value.bestViewport.score
          ) {
            summary = value;
            return true;
          }
          await page.waitForTimeout(250);
        }
        return false;
      },
      { timeout: 30000 }
    )
    .toBe(true);

  expect(summary.staleViewportFightHold).toBe(true);
  expect(summary.bestOffscreen.score).toBeGreaterThan(summary.bestViewport.score);
  expect(summary.retainViewportFight).toBe(false);

  assertCleanLogs(logs);
});

test("late-game observer does not sit on a quiet viewport while a much stronger offscreen fight exists", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page);

  await loadReplay(page, nukeReplayPath, "Hannes");
  await page.evaluate((frame) => {
    _replay_set_value(3, frame);
    _replay_set_value(0, 128);
    _replay_set_value(1, 0);
  }, 51500);
  await page.waitForFunction((frame) => _replay_get_value(2) >= frame, 51500, { timeout: 120000 });

  const badRuns = [];
  let currentRun = null;
  for (let i = 0; i < 20; ++i) {
    const summary = await page.evaluate(() => JSON.parse(Module.get_observer_debug_summary()));
    const quietViewport = summary.bestViewport.score <= 2;
    const muchStrongerOffscreen = summary.actualBestOffscreenScore > Math.max(100, summary.actualBestViewportScore * 2);
    const neutralReason = summary.actualApplyCenterReason === 0 || summary.actualApplyCenterReason === 6;
    const badNow = quietViewport && muchStrongerOffscreen && neutralReason;
    const pos = `${summary.screenPosX},${summary.screenPosY}`;
    if (badNow) {
      if (currentRun && currentRun.pos === pos) {
        currentRun.end = summary.frame;
        currentRun.count += 1;
      } else {
        if (currentRun) badRuns.push(currentRun);
        currentRun = { start: summary.frame, end: summary.frame, count: 1, pos };
      }
    } else if (currentRun) {
      badRuns.push(currentRun);
      currentRun = null;
    }
    await page.waitForTimeout(500);
  }
  if (currentRun) badRuns.push(currentRun);

  expect(badRuns).toEqual([]);
  assertCleanLogs(logs);
});

test("hidden-only falling missiles do not pin the camera away from late-game combat", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page);

  await loadReplay(page, nukeReplayPath, "Hannes");
  await page.evaluate((frame) => {
    _replay_set_value(3, frame);
    _replay_set_value(0, 128);
    _replay_set_value(1, 0);
  }, 53000);
  await page.waitForFunction((frame) => _replay_get_value(2) >= frame, 53000, { timeout: 120000 });

  const badFrames = [];
  for (let i = 0; i < 20; ++i) {
    const summary = await page.evaluate(() => JSON.parse(Module.get_observer_debug_summary()));
    const hiddenOnlyMissile = summary.nukeState.hasHiddenFallingNuke && !summary.nukeState.hasVisibleFallingNuke;
    const strongerOffscreenFight = summary.bestOffscreen.attention && summary.bestOffscreen.score > 100;
    const pinnedByNuke = summary.actualApplyCenterReason === 1 || summary.actualApplyCenterReason === 2;
    if (hiddenOnlyMissile && strongerOffscreenFight && pinnedByNuke) {
      badFrames.push({
        frame: summary.frame,
        reason: summary.actualApplyCenterReason,
        screen: [summary.screenPosX, summary.screenPosY],
        holdPos: [summary.nukeState.holdPositionX, summary.nukeState.holdPositionY],
        bestOffscreen: [summary.bestOffscreen.x, summary.bestOffscreen.y]
      });
    }
    await page.waitForTimeout(400);
  }

  expect(badFrames).toEqual([]);
  assertCleanLogs(logs);
});

test("high-speed early-game observer does not oscillate between map edges", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page);

  await loadReplay(page, nukeReplayPath, "Hannes");
  const frame = Math.round((3 * 60 + 47) * 1000 / 42);
  await page.evaluate((targetFrame) => {
    _replay_set_value(3, targetFrame);
    _replay_set_value(0, 32);
    _replay_set_value(1, 0);
  }, frame);
  await page.waitForFunction((targetFrame) => _replay_get_value(2) >= targetFrame, frame, { timeout: 120000 });

  const samples = [];
  for (let i = 0; i < 40; ++i) {
    const summary = await page.evaluate(() => JSON.parse(Module.get_observer_debug_summary()));
    samples.push({ frame: summary.frame, screenX: summary.screenPosX, screenY: summary.screenPosY });
    await page.waitForTimeout(32);
  }

  let largeSwingCount = 0;
  for (let i = 1; i < samples.length; ++i) {
    if (Math.abs(samples[i].screenX - samples[i - 1].screenX) > 1500) ++largeSwingCount;
  }
  expect(largeSwingCount).toBeLessThanOrEqual(1);
  assertCleanLogs(logs);
});

test.fixme("WillyT replay keeps advancing at 128x through the reported 7:38 freeze point", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page);

  await loadReplay(page, willyTReplayPath, "WillyT");
  for (let i = 0; i < 7; ++i) {
    await forceClick(page, "#rv-rc-faster");
  }

  await expect.poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 70000 }).toBeGreaterThan(11200);
  const startFrame = await page.evaluate(() => _replay_get_value(2));
  await page.waitForTimeout(2000);
  const endState = await page.evaluate(() => ({
    cur: _replay_get_value(2),
    speed: document.querySelector("#rv-rc-speed")?.textContent || ""
  }));
  expect(endState.cur).toBeGreaterThan(startFrame);
  expect(endState.speed).toContain("128.00x");

  assertCleanLogs(logs);
});

test.fixme("Terran building completion plays the SCV update acknowledgement sound for the first player", async ({ page }) => {
  test.setTimeout(180000);
  const logs = await createLogCollectors(page, { disableAudio: false });

  await loadReplay(page, willyTReplayPath, "WillyT");
  await forceClick(page, "#rv-rc-sound");
  await forceClick(page, "#rv-rc-sound");
  await page.evaluate(() => _replay_set_value(0, 128));

  await expect
    .poll(() => page.evaluate(() => (typeof Module.get_acknowledgement_sound_play_count === "function" ? Module.get_acknowledgement_sound_play_count(136) : 0)), {
      timeout: 30000
    })
    .toBeGreaterThan(0);

  assertCleanLogs(logs);
});
