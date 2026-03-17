const { test, expect } = require("@playwright/test");
const fs = require("fs/promises");

const replayPath = "/workspace/replays/PurpleWave vs Monster Tau Cross CTR_41B69CB9.rep";

test("loads bundled MPQs and starts a replay from drag and drop", async ({ page }) => {
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

  await page.goto("/");
  await expect(page.locator("#rv_modal")).toBeHidden({ timeout: 30000 });

  const replayBuffer = await fs.readFile(replayPath);
  const dataTransfer = await page.evaluateHandle(
    ({ name, mimeType, bytes }) => {
      const dataTransfer = new DataTransfer();
      const file = new File([new Uint8Array(bytes)], name, { type: mimeType });
      dataTransfer.items.add(file);
      return dataTransfer;
    },
    {
      name: "PurpleWave vs Monster Tau Cross CTR_41B69CB9.rep",
      mimeType: "application/octet-stream",
      bytes: [...replayBuffer]
    }
  );
  await page.dispatchEvent("body", "drop", { dataTransfer });

  await expect(page.locator("#top")).toBeHidden({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => _replay_get_value(2)), {
    timeout: 30000
  }).toBeGreaterThan(0);
  await expect(page.locator("#nick1")).toContainText("PurpleWave");
  expect(pageErrors).toEqual([]);
  expect(consoleProblems).toEqual([]);
});
