const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
test("both engines share the original entity layout and synchronization code", () => {
  const source = (engine, file) => fs.readFileSync(path.join(root, "engines", engine, file), "utf8");
  assert.equal(source("remastered", "sync.h"), source("classic", "sync.h"));
  const entities = engine => source(engine, "game_types.h").split("enum struct race_t")[1];
  assert.equal(entities("remastered"), entities("classic"));
});
for (const target of ["classic", "remastered", "legacy include path"]) {
  test(`${target} resolves only its own engine headers`, () => {
    const legacy = target === "legacy include path";
    const engine = legacy ? "classic" : target;
    const flags = legacy ? [] : ["-I", `engines/${engine}`];
    const includes = ["ui/ui.h", "sync.h", "replay_saver.h"];
    if (engine === "remastered") includes.push("remastered_replay.h");
    const deps = execFileSync("c++", ["-std=c++14", "-MM", "-x", "c++", ...flags, "-I", ".", "-"], {
      cwd: root, input: includes.map(h => `#include <${h}>`).join("\n"), encoding: "utf8"
    }).split(/\s+/).map(f => path.normalize(f));

    for (const name of ["actions", "bwgame", "game_types", "replay", "sync"]) {
      assert.ok(deps.includes(`engines/${engine}/${name}.h`), `missing ${engine}/${name}.h`);
    }
    const other = engine === "classic" ? "remastered" : "classic";
    assert.ok(!deps.some(f => f.startsWith(`engines/${other}/`)), `included ${other} headers`);
  });
}
