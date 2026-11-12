const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
test("both engines preserve classic simulation and attack notifications", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "engine-parity-"));
  try {
    const outputs = [];
    for (const engine of ["classic", "remastered"]) {
      const binary = path.join(temporary, engine);
      const build = spawnSync("c++", ["-std=c++14", "-O1", "-I", `engines/${engine}`, "-I", ".",
        "tests/source/engine-parity.cpp", "-lz", "-o", binary], { cwd: root, encoding: "utf8", timeout: 120000 });
      assert.equal(build.status, 0, build.stdout + build.stderr);
      assert.equal(build.stderr, "");
      const run = spawnSync(binary, [path.resolve(root, "../bw"), path.join(root, "tests/fixtures/elimination-0145.rep")],
        { encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(run.status, 0, `${engine}: ${run.stderr}`);
      assert.equal(run.stderr, "");
      outputs.push(run.stdout);
    }
    assert.equal(outputs[1], outputs[0], "Classic replay states must match across engines");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
