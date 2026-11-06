const { test, expect } = require("@playwright/test");
const fs = require("fs/promises");

const defaultReplayPath = "/workspace/replays/PurpleWave vs Monster Tau Cross CTR_41B69CB9.rep";
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

async function loadReplay(page, replayPath = defaultReplayPath) {
  await page.goto("/");
  await page.waitForSelector("#rv_modal", { state: "hidden", timeout: 30000 });
  const drop = await createReplayDrop(page, replayPath);
  await page.dispatchEvent("body", "drop", { dataTransfer: drop });
  await page.waitForFunction(() => typeof _replay_get_value === "function" && _replay_get_value(2) > 0, null, { timeout: 30000 });
}

test("footer geometry has no dead gap above/below the playback bar and no bottom gap under production", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/?rep=${encodeURIComponent(basilReplayUrl)}`);
  await page.waitForSelector("#rv_modal", { state: "hidden", timeout: 30000 });
  await page.waitForFunction(() => typeof _replay_get_value === "function" && _replay_get_value(4) > 0, null, { timeout: 120000 });

  const timerBox = await page.locator(".rv-rc-timer").boundingBox();
  const progressBox = await page.locator(".rv-rc-progress-bar").boundingBox();
  const replayBox = await page.locator(".replay-control").boundingBox();
  const productionRowBox = await page.locator("#info_tab_panel1 .per-player-info1").boundingBox();
  const productionContentBox = await page.locator("#production_tab_content1").boundingBox();
  const dockBox = await page.locator("#info_tab_panel1").boundingBox();
  const dockContentBox = await page.locator("#info_tab_panel1 .per-player-info2").boundingBox();
  const productionBarBox = await page.locator("#production_tab_content1 .prod_prog_bar").first().boundingBox();

  const metrics = {
    replayTopGap: Math.round(progressBox.y - (timerBox.y + timerBox.height)),
    replayBottomGap: Math.round((replayBox.y + replayBox.height) - (progressBox.y + progressBox.height)),
    productionBottomGap: Math.round((productionRowBox.y + productionRowBox.height) - (productionContentBox.y + productionContentBox.height)),
    dockBottomGap: Math.round((dockBox.y + dockBox.height) - (dockContentBox.y + dockContentBox.height)),
    productionBarHeight: Math.round(productionBarBox.height)
  };

  expect(metrics.replayTopGap).toBe(0);
  expect(metrics.replayBottomGap).toBe(0);
  expect(metrics.productionBottomGap).toBe(0);
  expect(metrics.dockBottomGap).toBe(0);
  expect(metrics.productionBarHeight).toBe(5);
});

test("frame query parameter seeds replay catch-up and the permalink button copies the current replay URL with frame", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const requestedFrame = 10;
  await page.goto(`/?rep=${encodeURIComponent(basilReplayUrl)}&frame=${requestedFrame}`);
  await page.waitForSelector("#rv_modal", { state: "hidden", timeout: 30000 });
  await page.waitForFunction(() => typeof _replay_get_value === "function" && _replay_get_value(4) > 0, null, { timeout: 120000 });
  await expect
    .poll(() => page.evaluate(() => _replay_get_value(3)), { timeout: 30000 })
    .toBeGreaterThanOrEqual(requestedFrame);
  await expect(page.locator("#rv-rc-copy-link")).toBeEnabled();

  await page.evaluate(() => {
    window.__copiedReplayUrl = null;
    if (!navigator.clipboard) navigator.clipboard = {};
    navigator.clipboard.writeText = async (text) => {
      window.__copiedReplayUrl = text;
    };
  });

  const copiedState = await page.evaluate(async () => {
    const frame = _replay_get_value(2);
    document.querySelector("#rv-rc-copy-link").click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      frame,
      copied: window.__copiedReplayUrl,
      alertText: document.querySelector("#viewport-alert")?.textContent || "",
      alertVisible: document.querySelector("#viewport-alert")?.classList.contains("is-visible") || false
    };
  });
  const copiedUrl = new URL(copiedState.copied);
  expect(copiedUrl.searchParams.get("rep")).toBe(basilReplayUrl);
  expect(Number(copiedUrl.searchParams.get("frame"))).toBe(copiedState.frame);
  expect(copiedState.alertText).toBe("Link copied to clipboard");
  expect(copiedState.alertVisible).toBe(true);
});

test("persisted overall volume state is reflected by both the footer mute button and settings controls", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.volumeSettings = JSON.stringify({ level: 0.27, muted: true });
    localStorage.audioCategorySettings = JSON.stringify({
      combat: { enabled: true, level: 0.5 },
      acknowledgements: { enabled: true, level: 0.5 },
      music: { enabled: true, level: 0.25 }
    });
  });

  await page.goto(`/?rep=${encodeURIComponent(basilReplayUrl)}`);
  await page.waitForSelector("#rv_modal", { state: "hidden", timeout: 30000 });
  await page.waitForFunction(() => typeof _replay_get_value === "function" && _replay_get_value(4) > 0, null, { timeout: 120000 });

  await expect(page.locator("#rv-rc-sound")).toHaveClass(/rv-rc-muted/);
  await expect(page.locator("#audio-overall-toggle")).toHaveClass(/rv-rc-muted/);
  await expect(page.locator("#audio-overall-value")).toHaveText("27%");
  await expect(page.locator("#volumeOutput")).toHaveValue("27");
});
