const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const source = path.resolve(__dirname, "../../scripts/build_replay_viewer.sh");
for (const [fail, packageFail] of [[false, false], [true, false], [false, true]]) test(`default build: web failure=${fail}, package failure=${packageFail}`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-build-"));
  try {
    const scripts = path.join(dir, "openbw/scripts");
    const desktop = path.join(dir, "openbw-replay-viewer/desktop");
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(desktop, { recursive: true });
    fs.copyFileSync(source, path.join(scripts, "build_replay_viewer.sh"));
    fs.writeFileSync(path.join(scripts, "build_web_replay_viewer.sh"), `#!/bin/bash\necho web >> "$BUILD_LOG"\nexit ${fail ? 1 : 0}\n`, { mode: 0o755 });
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin/npm"), `#!/bin/bash\necho "npm $*" >> "$BUILD_LOG"\nif [ "$*" = "run build" ]; then exit ${packageFail ? 1 : 0}; fi\n`, { mode: 0o755 });
    const log = path.join(dir, "log");
    const result = spawnSync("bash", [path.join(scripts, "build_replay_viewer.sh")], {
      env: { ...process.env, BUILD_LOG: log, PATH: `${dir}/bin:${process.env.PATH}` }, encoding: "utf8"
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
    assert.equal(result.status, (fail || packageFail) ? 1 : 0, result.stderr);
    assert.ok(calls.startsWith("web\n"), calls);
    assert.equal(calls.includes("run build"), !fail, calls);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
