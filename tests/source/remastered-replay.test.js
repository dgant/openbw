const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const terrain = path.resolve(root, "../openbw-replay-viewer/docs/v1.4/remastered/terrain.mpq");
let temporary;
let binary;

test.before(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "remastered-replay-"));
  binary = path.join(temporary, "replay-test");
  const build = spawnSync("c++", ["-std=c++14", "-O1", "-I", path.join(root, "engines/remastered"), "-I", root,
    path.join(__dirname, "remastered-replay.cpp"), "-lz", "-o", binary], { encoding: "utf8", timeout: 120000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.equal(build.stderr, "", "Native test must compile without warnings");
});
test.after(() => { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); });

test("bundled terrain matches its manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(terrain), "terrain-manifest.json")));
  assert.equal(createHash("sha256").update(fs.readFileSync(terrain)).digest("hex"), manifest.sha256);
});

function run(name, mode) {
  const result = spawnSync(binary, [path.resolve(root, "../bw"), path.join(root, "tests/fixtures", name), terrain, ...(mode ? [mode] : [])], {
    encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("Remastered engine matches the independently captured Backrooms states", () => {
  const result = run("remastered-backrooms-desync.rep");
  const reference = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/remastered-backrooms-reference.json")));
  for (const [frame, expected] of Object.entries(reference.snapshots)) {
    const actual = new Map(result.snapshots[frame].map(unit => [unit[0], unit]));
    for (const unit of expected) assert.deepEqual(actual.get(unit[0]), unit, `Frame ${frame}, unit ${unit[0]}`);
    assert.equal(actual.size, expected.length, `Frame ${frame} unit count`);
  }
  assert.equal(result.frames, 14036);
  assert.equal(result.completed, true);
  assert.equal(result.rewind, true);
});

test("Remastered engine completes the modern TvP fixture", () => {
  const result = run("remastered-tvp.rep");
  assert.equal(result.completed, true);
  assert.equal(result.rewind, true);
  assert.deepEqual(run("remastered-tvp.rep", "--file"), result, "File and memory loading must agree");
});

test("Remastered IDs, commands, limits, snapshots and extended map strings", () => {
  assert.deepEqual(run("remastered-backrooms-desync.rep", "--contracts"), { contracts: true });
});

for (const [label, corrupt] of [
  ["truncated header", bytes => bytes.subarray(0, 40)],
  ["wrong checksum", bytes => { bytes[20] ^= 1; return bytes; }],
  ["invalid metadata offset", bytes => { bytes.writeUInt32LE(bytes.length + 1, 16); return bytes; }]
]) test(`rejects ${label} before starting simulation`, () => {
  const file = path.join(temporary, "corrupt.rep");
  fs.writeFileSync(file, corrupt(fs.readFileSync(path.join(root, "tests/fixtures/remastered-backrooms-desync.rep"))));
  const result = spawnSync(binary, [path.resolve(root, "../bw"), file, terrain], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /replay|data_reader/i);
  assert.equal(result.stdout, "");
});
