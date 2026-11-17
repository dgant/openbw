const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '../..');
for (const engine of ['classic', 'remastered']) {
  test(`${engine}: replay chat parsing, font and bounds`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openbw-chat-'));
    try {
      const binary = path.join(temp, 'chat-test');
      const build = spawnSync(process.env.CXX || 'c++', [
        '-std=c++14', '-O0', '-g', '-fsanitize=address,undefined', '-Wno-deprecated',
        '-I', path.join(root, 'engines', engine), '-I', root,
        path.join(root, 'tests/replay_chat_test.cpp'), '-o', binary
      ], {encoding:'utf8', timeout:120000});
      assert.equal(build.status, 0, build.stdout + build.stderr);
      const run = spawnSync(binary, [], {encoding:'utf8', timeout:30000});
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.equal(run.stderr, '');
      assert.match(run.stdout, /passed/);
    } finally {
      fs.rmSync(temp, {recursive:true, force:true});
    }
  });
}
