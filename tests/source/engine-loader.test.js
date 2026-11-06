const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../../openbw-replay-viewer/docs/v1.4/engine-loader.js'), 'utf8');

function replay(format) {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(12, format === 'modern' ? 0x53526573 : 0x53526572, true);
  if (format === 'early-remastered') bytes.set([0x78, 0x9c], 28);
  return bytes;
}

function setup() {
  const events = [];
  const sandbox = {
    console, Blob, Uint8Array, DataView,
    main_has_been_called: false, viewerMainLoopPausedForIdle: false,
    files: Array.from({length: 3}, () => new Blob([new Uint8Array(8)])),
    embeddedReplayConfig: {enabled: false},
    set_pregame_dropzone_status: (...args) => events.push(['error', ...args]),
    document: {
      getElementById: () => ({}),
      createElement: () => ({}),
      head: {appendChild: script => queueMicrotask(() => script.onload())}
    },
    fetch: async () => { events.push('terrain'); return {ok: true, blob: async () => new Blob(['terrain'])}; }
  };
  sandbox.window = sandbox;
  function factory(format) {
    return options => {
      events.push(['create', format]);
      const module = {...options, _replay_get_value: () => format, UTF8ToString: () => '',
        set_volume: value => events.push(['volume', format, value]),
        disposeReplayEngine: () => events.push(['dispose', format])};
      queueMicrotask(() => options.onRuntimeInitialized.call(module));
      return module;
    };
  }
  sandbox.createClassicReplayEngine = factory('classic');
  sandbox.createRemasteredReplayEngine = factory('remastered');
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  return {context, events};
}

test('detects classic, early Remastered, and modern Remastered containers', async () => {
  const {context} = setup();
  await context.replayEngineReady;
  assert.equal(context.replay_engine_format(replay('classic')), 'classic');
  assert.equal(context.replay_engine_format(replay('early-remastered')), 'remastered');
  assert.equal(context.replay_engine_format(replay('modern')), 'remastered');
  assert.throws(() => context.replay_engine_format(new Uint8Array(12)), /too short/);
});

test('switches independent runtimes and terrain without keeping old callbacks active', async () => {
  const {context, events} = setup();
  await context.replayEngineReady;
  context.main_has_been_called = true;
  await context.prepare_replay_engine(replay('modern'));
  assert.equal(context.Module.replayFormat, 'remastered');
  assert.equal(context._replay_get_value(), 'remastered');
  assert.equal(context.js_read_buffers.length, 4);
  context.main_has_been_called = true;
  await context.prepare_replay_engine(replay('classic'));
  assert.equal(context._replay_get_value(), 'classic');
  assert.equal(context.js_read_buffers.length, 3);
  context.main_has_been_called = true;
  await context.prepare_replay_engine(replay('modern'));
  await context.prepare_replay_engine(replay('modern'));
  assert.equal(events.filter(event => event === 'terrain').length, 1);
  assert.deepEqual(events.filter(event => event[0] === 'dispose'), [
    ['dispose', 'classic'], ['dispose', 'remastered'], ['dispose', 'classic']
  ]);
});
