const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "..", "bwgame.h"), "utf8");

assert(
  !source.includes("bool require_visibility = !check_invisible_tiles || is_nydus_exit;"),
  "can_place_building must not use the old inverted creep visibility helper"
);

assert(
  source.includes("if (check_invisible_tiles || is_nydus_exit || ~tile.visible & visibility_mask) {"),
  "can_place_building must check creep on invisible tiles, nydus exits, or tiles not visible to the owner"
);

