const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("replay decoder restores format-specific rules and rewind snapshots", () => {
  const root = path.resolve(__dirname, "../..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "replay-formats-"));
  try {
    const binary = path.join(temp, "replay-formats");
    const build = spawnSync("c++", [
      "-std=c++14", "-O2", "-I", root,
      path.join(__dirname, "replay-formats.cpp"), "-lz", "-o", binary
    ], { encoding: "utf8", timeout: 120000 });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    assert.equal(build.stderr, "", "Native test must compile without warnings");
    const fixtures = path.join(root, "tests/fixtures");
    const legacy = path.join(fixtures, "elimination-0145.rep");
    const result = spawnSync(binary, [
      "/workspace/bw/", legacy, path.join(fixtures, "remastered-zvz.rep"),
      legacy, path.join(fixtures, "remastered-tvp.rep"), legacy
    ], { encoding: "utf8", timeout: 120000, env: {
      ...process.env,
      OPENBW_TERRAIN_MPQ: path.join(root, "../openbw-replay-viewer/docs/v1.4/remastered/terrain.mpq")
    } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    console.log(result.stdout.trim());
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
