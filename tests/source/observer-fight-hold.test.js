const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("camera fight holds and long-replay snapshot eviction preserve their invariants", () => {
  const root = path.resolve(__dirname, "../..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "observer-fight-"));
  try {
    const flags = spawnSync("pkg-config", ["--cflags", "--libs", "sdl2"], { encoding: "utf8" });
    assert.equal(flags.status, 0, flags.stderr);
    const binary = path.join(temp, "observer-fight");
    const build = spawnSync("c++", ["-std=c++14", "-O1", "-DOPENBW_NO_SDL_IMAGE", "-DOPENBW_NO_SDL_MIXER", "-I", root,
      path.join(__dirname, "observer-fight-hold.cpp"), path.join(root, "ui/sdl2.cpp"),
      ...flags.stdout.trim().split(/\s+/), "-o", binary], { encoding: "utf8", timeout: 120000 });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    assert.equal(build.stderr, "");
    const run = spawnSync(binary, [path.resolve(root, "../bw"), path.join(root, "tests/fixtures/elimination-0145.rep")],
      { env: { ...process.env, SDL_VIDEODRIVER: "dummy" }, encoding: "utf8", timeout: 15000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(run.stderr, "");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
