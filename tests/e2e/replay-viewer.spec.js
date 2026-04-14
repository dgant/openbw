const { test, expect } = require("@playwright/test");
const fs = require("fs/promises");

const defaultReplayName = "PurpleWave vs Monster Tau Cross CTR_41B69CB9.rep";
const defaultReplayPath = `/workspace/replays/${defaultReplayName}`;
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

async function createLogCollectors(page) {
  const pageErrors = [];
  const consoleProblems = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      const text = message.text();
      if (text.includes("Canvas2D: Multiple readback operations using getImageData")) return;
      consoleProblems.push(`${message.type()}: ${text}`);
    }
  });

  return { pageErrors, consoleProblems };
}

async function loadReplay(page, replayPath = defaultReplayPath, expectedFirstNick = "PurpleWave") {
  await page.goto("/");
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  const drop = await createReplayDrop(page, replayPath);
  await page.dispatchEvent("body", "drop", { dataTransfer: drop });
  await expect(page.locator("#top")).toBeHidden({ timeout: 30000 });
  await expect
    .poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 30000 })
    .toBeGreaterThan(0);
  if (expectedFirstNick) {
    await expect(page.locator("#nick1")).toContainText(expectedFirstNick);
  }
}

async function loadRemoteReplay(page, replayUrl, expectedFirstNick) {
  await page.goto(`/?rep=${encodeURIComponent(replayUrl)}`);
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  await expect
    .poll(() => page.evaluate(() => (typeof _replay_get_value === "function" ? _replay_get_value(4) : 0)), { timeout: 120000 })
    .toBeGreaterThan(0);
  if (expectedFirstNick) {
    await expect(page.locator("#nick1")).toContainText(expectedFirstNick);
  }
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
  await expect
    .poll(() =>
      page.evaluate(() => ({
        replayControlWidth: Math.round(document.querySelector(".replay-control").getBoundingClientRect().width),
        speedScrollHeight: document.querySelector("#rv-rc-speed").scrollHeight,
        speedClientHeight: document.querySelector("#rv-rc-speed").clientHeight
      }))
    )
    .toEqual({
      replayControlWidth: expect.any(Number),
      speedScrollHeight: expect.any(Number),
      speedClientHeight: expect.any(Number)
    });
  const controlMetrics = await page.evaluate(() => ({
    replayControlWidth: Math.round(document.querySelector(".replay-control").getBoundingClientRect().width),
    speedScrollHeight: document.querySelector("#rv-rc-speed").scrollHeight,
    speedClientHeight: document.querySelector("#rv-rc-speed").clientHeight
  }));
  expect(controlMetrics.replayControlWidth).toBeGreaterThanOrEqual(212);
  expect(controlMetrics.speedScrollHeight).toBeLessThanOrEqual(controlMetrics.speedClientHeight);
  await expect(page.locator("#viewport-export")).toBeVisible();
  assertCleanLogs(logs);
});

test("remote BASIL replay advances through the reported 21:18 local stall point", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadRemoteReplay(page, basilReplayUrl, "Brainiac");
  await page.evaluate(() => {
    _replay_set_value(3, 30500);
    _replay_set_value(1, 0);
    _replay_set_value(0, 1);
  });

  await expect
    .poll(() =>
      page.evaluate(() => ({
        cur: _replay_get_value(2),
        target: _replay_get_value(3),
        paused: _replay_get_value(1),
        timer: document.querySelector("#rv-rc-timer")?.textContent || ""
      })),
      { timeout: 30000 }
    )
    .toMatchObject({
      cur: expect.any(Number),
      paused: 0,
      timer: expect.stringContaining("21:")
    });

  const startFrame = await page.evaluate(() => _replay_get_value(2));
  await page.waitForTimeout(2500);
  const endState = await page.evaluate(() => ({
    cur: _replay_get_value(2),
    target: _replay_get_value(3),
    paused: _replay_get_value(1),
    timer: document.querySelector("#rv-rc-timer")?.textContent || ""
  }));
  expect(startFrame).toBeGreaterThanOrEqual(30000);
  expect(endState.cur).toBeGreaterThan(startFrame);
  expect(endState.target).toBe(endState.cur);
  expect(endState.paused).toBe(0);
  assertCleanLogs(logs);
});

test("remote BASIL replay can scrub to the end without trapping", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadRemoteReplay(page, basilReplayUrl, "Brainiac");
  await page.evaluate(() => {
    const endFrame = _replay_get_value(4);
    _replay_set_value(3, endFrame);
    _replay_set_value(1, 0);
    _replay_set_value(0, 1);
  });

  await expect.poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 45000 }).toBeGreaterThan(40000);
  const endState = await page.evaluate(() => ({
    cur: _replay_get_value(2),
    target: _replay_get_value(3),
    end: _replay_get_value(4),
    paused: _replay_get_value(1)
  }));
  expect(endState.target).toBe(endState.end);
  expect(endState.cur).toBeGreaterThan(40000);
  assertCleanLogs(logs);
});

test("existing buttons and hotkeys work during replay playback", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
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
  await expect(page.locator("#rv-rc-fow")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(1);
  await expect(page.locator("#vision1")).toHaveClass(/is-enabled/);
  await expect(page.locator("#vision2")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[0]))).toBe(1);
  await page.click("#rv-rc-fow");
  await expect(page.locator("#rv-rc-fow")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(0);
  await page.click("#rv-rc-fow");
  await expect(page.locator("#rv-rc-fow")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(1);
  await page.click("#vision1");
  await expect(page.locator("#vision1")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[0]))).toBe(0);
  await page.click("#vision2");
  await expect(page.locator("#vision2")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[1]))).toBe(0);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[0]))).toBe(0);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(1);
  await page.click("#vision1");
  await expect(page.locator("#vision1")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[0]))).toBe(1);
  await page.click("#vision2");
  await expect(page.locator("#vision2")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[1]))).toBe(1);
  await expect(page.locator("#rv-rc-force-colors")).not.toHaveClass(/is-enabled/);
  await page.click("#rv-rc-force-colors");
  await expect(page.locator("#rv-rc-force-colors")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _force_red_blue_colors_get_value())).toBe(1);
  await expect.poll(() => page.evaluate(() => [_player_get_value(players[0], 1), _player_get_value(players[1], 1)])).toEqual([0, 1]);
  await expect
    .poll(() =>
      page.evaluate(() => [
        getComputedStyle(document.querySelector("#nick1")).borderLeftColor,
        getComputedStyle(document.querySelector("#nick2")).borderLeftColor
      ])
    )
    .toEqual(["rgb(244, 4, 4)", "rgb(12, 72, 204)"]);
  await page.click("#rv-rc-force-colors");
  await expect(page.locator("#rv-rc-force-colors")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _force_red_blue_colors_get_value())).toBe(0);
  await expect(page.locator("#rv-rc-music")).not.toHaveClass(/is-enabled/);
  await page.click("#rv-rc-music");
  await expect(page.locator("#rv-rc-music")).toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.viewerToggleSettings || "{}").musicEnabled)).toBe(true);

  await expect(page.locator("#rv-rc-sound")).toHaveClass(/rv-rc-sound/);
  await page.keyboard.press("s");
  await expect(page.locator("#rv-rc-sound")).toHaveClass(/rv-rc-muted/);
  await page.click("#rv-rc-sound");
  await expect(page.locator("#rv-rc-sound")).toHaveClass(/rv-rc-sound/);
  await page.hover("#rv-rc-sound");
  await expect(page.locator("#volume-slider-wrapper")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const wrapper = document.querySelector("#volume-slider-wrapper").getBoundingClientRect();
        const footer = document.querySelector(".infobar-container").getBoundingClientRect();
        const button = document.querySelector("#rv-rc-sound").getBoundingClientRect();
        return {
          overflow: getComputedStyle(document.querySelector(".infobar-container")).overflow,
          extendsAboveFooter: wrapper.top < footer.top,
          hasHeight: wrapper.height >= 120,
          centered: Math.abs((wrapper.left + wrapper.right) / 2 - (button.left + button.right) / 2) <= 1,
          bg: getComputedStyle(document.querySelector("#volume-slider-wrapper")).backgroundColor
        };
      })
    )
    .toEqual({
      overflow: "visible",
      extendsAboveFooter: true,
      hasHeight: true,
      centered: true,
      bg: "rgba(0, 0, 0, 0)"
    });
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

  await expect.poll(() => page.evaluate(() => _replay_get_value(0))).toBe(1);
  await page.click("#rv-rc-faster");
  await expect.poll(() => page.evaluate(() => _replay_get_value(0))).toBe(2);
  await page.keyboard.press("z");
  await expect.poll(() => page.evaluate(() => _replay_get_value(0))).toBe(1);
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("z");
  }
  await expect.poll(() => page.evaluate(() => _replay_get_value(0))).toBe(1 / 128);
  await page.keyboard.press("z");
  await expect.poll(() => page.evaluate(() => _replay_get_value(0))).toBe(1 / 128);
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press("a");
  }
  await expect.poll(() => page.evaluate(() => _replay_get_value(0))).toBe(1);

  await expect(page.locator("#rv-rc-play")).toHaveClass(/rv-rc-pause/);
  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(0);
  await page.click("#rv-rc-play");
  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(1);
  await expect(page.locator("#rv-rc-play")).toHaveClass(/rv-rc-play/);
  await page.evaluate(() => _replay_set_value(1, 0));
  await expect.poll(() => page.locator("#rv-rc-play").getAttribute("class")).toContain("rv-rc-pause");
  await page.keyboard.press("p");
  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(1);
  await expect(page.locator("#rv-rc-play")).toHaveClass(/rv-rc-play/);

  const frameBeforeJump = await page.evaluate(() => _replay_get_value(2));
  await page.keyboard.press("c");
  await expect
    .poll(() => page.evaluate(() => _replay_get_value(3)), { timeout: 5000 })
    .toBeLessThan(frameBeforeJump);

  await page.keyboard.press("j");
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
  await page.keyboard.press("2");
  await expect(page.locator("#info_tab_panel1")).toBeVisible();
  await expect(page.locator("#info_tab_panel2")).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.locator("#info_tab_panel3")).toBeVisible();
  await page.keyboard.press("4");
  await expect(page.locator("#info_tab_panel3")).toBeVisible();

  await expect(page.locator("#graphs_tab")).toBeHidden();
  await page.keyboard.press("g");
  await expect(page.locator("#graphs_tab")).toBeVisible();
  await page.keyboard.press("g");
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
            metrics["rv-rc-music"].left === metrics["rv-rc-force-colors"].left &&
            metrics["rv-rc-force-colors"].left === metrics["rv-rc-observer"].left &&
            metrics["rv-rc-observer"].left === metrics["rv-rc-fow"].left,
          zoomLeftOfControls: metrics["zoom-in"].left < metrics["rv-rc-music"].left,
          musicAboveForceColors: metrics["rv-rc-music"].top < metrics["rv-rc-force-colors"].top,
          rightColumnStacks:
            metrics["rv-rc-music"].top < metrics["rv-rc-force-colors"].top &&
            metrics["rv-rc-force-colors"].top < metrics["rv-rc-observer"].top &&
            metrics["rv-rc-observer"].top < metrics["rv-rc-fow"].top,
          zoomInAboveZoomOut: metrics["zoom-in"].top < metrics["zoom-out"].top,
          bottomAligned: metrics["zoom-out"].top === metrics["rv-rc-fow"].top
        };
      })
    )
    .toEqual({
      zoomColumnLeftAligned: true,
      controlColumnLeftAligned: true,
      zoomLeftOfControls: true,
      musicAboveForceColors: true,
      rightColumnStacks: true,
      zoomInAboveZoomOut: true,
      bottomAligned: true
    });
  await page.keyboard.press("=");
  await expect.poll(() => page.evaluate(() => localStorage.zoomLevel)).toBe("1");
  await expect(page.locator("#zoom-in")).toHaveClass(/zoom-active/);
  await page.click("#zoom-out");
  await expect.poll(() => page.evaluate(() => localStorage.zoomLevel)).toBe("0");
  await page.keyboard.press("-");
  await expect.poll(() => page.evaluate(() => localStorage.zoomLevel)).toBe("-1");
  await expect(page.locator("#zoom-out")).toHaveClass(/zoom-active/);
  await page.click("#zoom-in");
  await expect.poll(() => page.evaluate(() => localStorage.zoomLevel)).toBe("0");

  const progressBarVisibleBefore = await page.locator(".rv-rc-progress-bar > div").first().isVisible();
  expect(progressBarVisibleBefore).toBe(true);
  await page.keyboard.press("n");
  await expect(page.locator(".rv-rc-progress-bar > div")).toBeHidden();
  await page.keyboard.press("n");
  await expect(page.locator(".rv-rc-progress-bar > div")).toBeVisible();

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

test("zoom out clamps to a safe render size on large viewports", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 2560, height: 1440 });
  await loadReplay(page);

  for (let i = 0; i < 5; i += 1) {
    await page.click("#zoom-out");
  }

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

test("manual camera movement suppresses auto camera for five seconds", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await loadReplay(page);
  await page.waitForTimeout(1000);

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
  const logs = await createLogCollectors(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await loadReplay(page);

  const minimapSums = await page.evaluate(async () => {
    const canvas = document.querySelector("#canvas");
    const sample = () => {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const data = ctx.getImageData(4, canvas.height - 40, 30, 30).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] + data[i + 1] + data[i + 2];
      }
      return sum;
    };
    const before = sample();
    zoomOut();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = sample();
    zoomIn();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { before, after };
  });

  expect(minimapSums.before).toBeGreaterThan(0);
  expect(minimapSums.after).toBeGreaterThan(0);

  const zoomState = await page.evaluate(() => {
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
  await page.click("#vision4");
  await expect(page.locator("#vision4")).not.toHaveClass(/is-enabled/);
  await expect.poll(() => page.evaluate(() => _fog_of_war_player_get_value(players[3]))).toBe(0);
  await page.click("#vision4");
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

test("playlist controls navigate a replay playlist", async ({ page }) => {
  const logs = await createLogCollectors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  const replayBuffer = await fs.readFile(defaultReplayPath);
  await page.evaluate(
    ({ bytes }) => {
      const first = new File([new Uint8Array(bytes)], "Alpha.rep", { type: "application/octet-stream" });
      const second = new File([new Uint8Array(bytes)], "Beta.rep", { type: "application/octet-stream" });
      set_replay_playlist([
        { file: first, label: "folder/Alpha.rep" },
        { file: second, label: "folder/Beta.rep" }
      ], 0);
      load_replay_playlist_index(0, Module.canvas);
    },
    { bytes: [...replayBuffer] }
  );
  await expect
    .poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 30000 })
    .toBeGreaterThan(0);
  await expect(page.locator("#playlist-controls")).toBeVisible();
  await expect(page.locator("#playlist-position")).toContainText("#1 of 2");
  await expect(page.locator("#playlist-name")).toContainText("Alpha.rep");
  await expect(page.locator("#playlist-prev")).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const controls = document.querySelector("#playlist-controls").getBoundingClientRect();
        const canvas = document.querySelector("#canvas").getBoundingClientRect();
        return Math.round(controls.left) >= Math.round(canvas.left + 128 + 8);
      })
    )
    .toBe(true);
  await page.click("#playlist-next");
  await expect(page.locator("#playlist-position")).toContainText("#2 of 2");
  await expect(page.locator("#playlist-name")).toContainText("Beta.rep");
  await expect(page.locator("#playlist-name")).not.toContainText("folder/");
  await expect(page.locator("#playlist-next")).toBeEnabled();
  await page.click("#playlist-prev");
  await expect(page.locator("#playlist-position")).toContainText("#1 of 2");
  await page.click("#playlist-prev");
  await expect(page.locator("#playlist-position")).toContainText("#2 of 2");
  await page.keyboard.press("PageUp");
  await expect(page.locator("#playlist-position")).toContainText("#1 of 2");
  await page.keyboard.press("PageDown");
  await expect(page.locator("#playlist-position")).toContainText("#2 of 2");
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

  await page.click("#rv-rc-export-settings");
  await expect(page.locator("#export_settings")).toBeVisible();
  await page.fill("#export-width", "1280");
  await page.fill("#export-height", "720");
  await page.fill("#export-fps", "30");
  await page.fill("#export-bitrate", "16.5");
  await expect(page.locator("#export-settings-save")).toBeVisible();
  await expect(page.locator("#export-settings-reset")).toContainText("Reset");
  await page.click("#export-settings-save");
  await expect(page.locator("#export_settings")).toBeHidden();

  await page.click("#rv-rc-play");
  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(1);
  const startFrame = await page.evaluate(() => _replay_get_value(2));
  await page.click("#rv-rc-export");
  await expect(page.locator("#rv-rc-export")).toHaveClass(/is-exporting/);
  await expect.poll(() => page.evaluate(() => _replay_get_value(1))).toBe(0);
  await expect
    .poll(() => page.evaluate((frame) => _replay_get_value(2) > frame, startFrame), { timeout: 15000 })
    .toBe(true);
  await page.click("#rv-rc-export");
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

  await page.click("#rv-rc-export-settings");
  await page.fill("#export-width", "1280");
  await page.fill("#export-height", "720");
  await page.click("#export-settings-save");

  const before = await page.evaluate(() => {
    const area = document.querySelector("#canvas-area").getBoundingClientRect();
    const canvas = Module.canvas.getBoundingClientRect();
    return {
      centerX: _ui_get_screen_pos(0) + Module.canvas.width / 2,
      centerY: _ui_get_screen_pos(1) + Module.canvas.height / 2,
      areaCenterX: Math.round(area.width / 2),
      areaCenterY: Math.round(area.height / 2),
      observerBg: getComputedStyle(document.querySelector("#rv-rc-observer")).backgroundColor,
      observerBorder: getComputedStyle(document.querySelector("#rv-rc-observer")).borderTopColor,
      exportBg: getComputedStyle(document.querySelector("#rv-rc-export")).backgroundColor,
      exportBorder: getComputedStyle(document.querySelector("#rv-rc-export")).borderTopColor,
      exportColor: getComputedStyle(document.querySelector("#rv-rc-export")).color
    };
  });

  await page.click("#rv-rc-export");
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

  expect(before.exportBg).toBe(before.observerBg);
  expect(before.exportBorder).toBe("rgb(77, 85, 100)");
  expect(before.exportColor).toBe("rgb(208, 212, 222)");
  expect(Math.abs(during.canvasCenterX - during.areaCenterX)).toBeLessThanOrEqual(1);
  expect(Math.abs(during.canvasCenterY - during.areaCenterY)).toBeLessThanOrEqual(1);
  expect(Math.abs(during.centerX - before.centerX)).toBeLessThanOrEqual(2);
  expect(Math.abs(during.centerY - before.centerY)).toBeLessThanOrEqual(2);

  assertCleanLogs(logs);
});

test("video clip settings modal uses the requested copy and button styling", async ({ page }) => {
  const logs = await createLogCollectors(page);

  await loadReplay(page);
  await page.click("#rv-rc-export-settings");
  await expect(page.locator("#export_settings h3")).toHaveText("Video clip settings");
  await expect(page.locator("#export_settings p")).toHaveCount(0);
  await expect(page.locator("#export-settings-save")).toHaveClass(/success/);
  await expect(page.locator("#export-settings-reset")).toHaveClass(/success/);
  await expect(page.locator("#export-width")).toHaveJSProperty("value", "1280");

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
        width: getComputedStyle(el).getPropertyValue("--dynamic-tile-width").trim()
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
  await page.click("#rv-rc-observer");
  await page.click("#rv-rc-fow");
  await page.click("#rv-rc-force-colors");
  await page.click("#rv-rc-music");
  await page.reload();
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });
  const drop = await createReplayDrop(page);
  await page.dispatchEvent("body", "drop", { dataTransfer: drop });
  await expect(page.locator("#top")).toBeHidden({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => _replay_get_value(2)), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => _observer_get_value())).toBe(0);
  await expect.poll(() => page.evaluate(() => _fog_of_war_get_value())).toBe(0);
  await expect.poll(() => page.evaluate(() => _force_red_blue_colors_get_value())).toBe(1);
  await expect(page.locator("#rv-rc-music")).toHaveClass(/is-enabled/);

  assertCleanLogs(logs);
});
