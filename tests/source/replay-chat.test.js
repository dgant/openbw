const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("chat action dispatch, history and missing notification audio", () => {
  const cwd = path.resolve(__dirname, "../..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chat-actions-"));
  try {
    const binary = path.join(temp, "check");
    const sdl = execFileSync("pkg-config", ["--cflags", "--libs", "sdl2"], {encoding:"utf8"}).trim().split(/\s+/);
    for (const engine of ["classic", "remastered"]) {
      execFileSync("c++", ["-std=c++14", "-O1", "-DOPENBW_NO_SDL_IMAGE", "-DOPENBW_NO_SDL_MIXER",
        "-I", "engines/" + engine, "-I.", "tests/source/replay-chat.cpp", "ui/sdl2.cpp", ...sdl, "-lz", "-o", binary], {cwd});
      execFileSync(binary, [], {env:{...process.env, SDL_VIDEODRIVER:"dummy"}});
    }
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
});
