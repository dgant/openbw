const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("reported Backrooms replay matches independent sagi.gg unit snapshots and selections", () => {
  const root = path.resolve(__dirname, "../..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "replay-consistency-"));
  try {
    const binary = path.join(temp, "replay-consistency");
    const build = spawnSync("c++", ["-std=c++14", "-O2", "-I", root,
      path.join(__dirname, "replay-consistency.cpp"), "-lz", "-o", binary],
    { encoding: "utf8", timeout: 120000 });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    assert.equal(build.stderr, "");
    const result = spawnSync(binary, ["/workspace/bw/",
      path.join(root, "tests/fixtures/remastered-backrooms-desync.rep")],
    { encoding: "utf8", timeout: 120000, env: {
      ...process.env,
      OPENBW_TERRAIN_MPQ: path.join(root, "../openbw-replay-viewer/docs/v1.4/remastered/terrain.mpq")
    } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    const expected = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/remastered-backrooms-reference.json")));
    const samples = result.stdout.split("\n").filter(line => line.startsWith("Unit "))
      .map(line => line.split(" ").slice(1).map(Number));
    for (const [frame, units] of Object.entries(expected.snapshots)) {
      assert.deepEqual(samples.filter(unit => unit[0] === Number(frame)).map(unit => unit.slice(1)), units, `frame ${frame}`);
    }
    assert.match(result.stdout, /Checked 9448 selection commands, inconsistent=3, first_frame=12676/);
    assert.deepEqual([...result.stdout.matchAll(/Mismatch frame=(\d+).*dead=(\d+)/g)]
      .map(match => [Number(match[1]), Number(match[2])]), [[12676, 1], [12751, 1], [13604, 1]]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
