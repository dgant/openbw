const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("replay player colors survive elimination", () => {
  const root = path.resolve(__dirname, "../..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "replay-colors-"));
  try {
    const binary = path.join(temp, "replay-colors");
    const flags = spawnSync("pkg-config", ["--cflags", "--libs", "sdl2"], { encoding: "utf8" });
    assert.equal(flags.status, 0, flags.stderr);
    const build = spawnSync("c++", [
      "-std=c++14", "-O0", "-ffunction-sections", "-fdata-sections", "-Wl,--gc-sections",
      "-DOPENBW_NO_SDL_IMAGE", "-DOPENBW_NO_SDL_MIXER", "-I", root,
      path.join(__dirname, "replay-player-colors.cpp"), path.join(root, "ui/sdl2.cpp"),
      ...flags.stdout.trim().split(/\s+/), "-o", binary
    ], { encoding: "utf8", timeout: 120000 });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    assert.equal(build.stderr, "", "Native test must compile without warnings");
    const result = spawnSync(binary, [], {
      env: { ...process.env, SDL_VIDEODRIVER: "dummy" }, encoding: "utf8", timeout: 10000
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
