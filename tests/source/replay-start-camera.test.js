const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../../../openbw-replay-viewer/docs/v1.4/start.js"), "utf8");
const constants = source.slice(source.indexOf("var C_PLAYER_ACTIVE"), source.indexOf("var C_MPQ_FILENAMES"));
const helper = source.slice(source.indexOf("function center_camera_on_first_player_start()"), source.indexOf("function start_replay("));

test("starting camera uses the first participant's original start, including nonzero slots", () => {
  const centers = [];
  const reads = [];
  const context = vm.createContext({
    players: [2, 5],
    _player_get_value: (player, field) => {
      reads.push([player, field]);
      return field === 15 ? 288 : 1456;
    },
    _ui_set_screen_center: (x, y) => centers.push([x, y])
  });
  vm.runInContext(constants + helper + "center_camera_on_first_player_start();", context);
  assert.deepEqual(reads, [[2, 15], [2, 16]]);
  assert.deepEqual(centers, [[288, 1456]]);
});

test("starting camera leaves an empty participant list alone", () => {
  const context = vm.createContext({ players: [] });
  vm.runInContext(constants + helper + "center_camera_on_first_player_start();", context);
});
