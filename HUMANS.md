# OpenBW Replay Viewer

## Replay formats

Browse for or drop a `.rep` file to load either StarCraft 1.16.1 or Remastered.
The file format is detected automatically; no setting or conversion step is
needed. Mixed-format playlists, replay URLs, and the desktop launcher use the
same engine loader. Remastered playback uses classic graphics and is experimental:
successful loading and deterministic seeking do not guarantee exact simulation
agreement with every version of StarCraft.

Run the mixed-format regression with the local server running:

```bash
npx playwright test tests/e2e/replay-formats.spec.js
```

It drops and alternates legacy and Remastered fixtures, checks playback, rewind,
mixed playlists and unchanged downloads at desktop and mobile widths, and saves
`test-results/remastered-*.png`. The source suite also completes those replays in
one native engine instance, checking pool sizes, unit references and snapshots.
Native compilation requires zlib development headers (`zlib1g-dev` on Debian).

## Local development

Build the browser runtime and standalone desktop packages together:

```bash
./scripts/build_replay_viewer.sh
```

Install the browser test dependencies:

```bash
npm install
```

Run focused source regression tests:

```bash
npm run test:source
```

Run these tests inside the development container; the scenery-color test compiles
a native renderer test using the container's C++ compiler and SDL2 headers.

Run the replay-viewer browser regression test:

```bash
npm run test:e2e
```

Serve the viewer locally from the container:

```bash
./scripts/serve_replay_viewer.sh
```

The viewer will be available on:

```text
http://localhost:8080/
```

With that server running, test the Roadkill white-canvas regression specifically:

```bash
npx playwright test tests/e2e/scenery-owner.spec.js
```

This loads the committed replay fixture, pans to scenery at (2624, 912), checks
redraws with normal and forced player colors, and verifies playback continues
without browser errors or warnings. It saves `test-results/roadkill-scenery-render.png`
for visual inspection.

Test end-of-game colors, manual camera movement, and initial URL-loaded status:

```bash
npx playwright test tests/e2e/replay-lifecycle.spec.js
```

The elimination test seeks through the committed 23-minute replay once, then
checks both color modes, visible minimap colors, camera stability after the
three-second manual override expires, and rewind. Allow up to three minutes
for the seek on a busy machine. Startup tests hold the first URL-loaded replay
at frame zero and check visible player names, map, and resources at two widths.
Screenshots are saved under `test-results/`.

Test starting-camera positioning with automatic camera on/off, saved zoom,
and replacement of a paused replay:

```bash
npx playwright test tests/e2e/replay-start-camera.spec.js
```

This uses the workspace's Tau Cross example replay and the committed Gladiator
fixture, checks their known starting coordinates and painted canvas pixels at
frame zero (including after deferred zoom restoration), and saves
`test-results/start-camera-*.png` for visual inspection.

## Notes

- The default build also packages those same web assets into `../openbw-replay-viewer/desktop/dist/replay-viewer-desktop/` and verifies the bundled files match `docs/`. A desktop packaging or verification failure fails the build.
- On first use, the build installs the locked desktop dependencies and downloads the configured Neutralino runtime if missing.
- On Windows, run `../openbw-replay-viewer/desktop/scripts/register-file-association.ps1` once to register the stable output path for `.rep`. Keep the executable and `resources.neu` together.
- The current local build writes `openbw.js` and `openbw.wasm` into `../openbw-replay-viewer/docs/v1.4/`.
- The wrapper HTML/JS currently still lives in `../openbw-replay-viewer/docs/`.
- Example replays are in `../replays/`.
- The current local viewer auto-loads MPQs from `../bw/` via the wrapper's `docs/bw` symlink.
- The current browser build disables SDL_mixer, so replay audio is not enabled yet.
