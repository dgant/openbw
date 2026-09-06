# OpenBW Replay Viewer

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

## Notes

- The default build also packages those same web assets into `../openbw-replay-viewer/desktop/dist/replay-viewer-desktop/` and verifies the bundled files match `docs/`. A desktop packaging or verification failure fails the build.
- On first use, the build installs the locked desktop dependencies and downloads the configured Neutralino runtime if missing.
- On Windows, run `../openbw-replay-viewer/desktop/scripts/register-file-association.ps1` once to register the stable output path for `.rep`. Keep the executable and `resources.neu` together.
- The current local build writes `openbw.js` and `openbw.wasm` into `../openbw-replay-viewer/docs/v1.4/`.
- The wrapper HTML/JS currently still lives in `../openbw-replay-viewer/docs/`.
- Example replays are in `../replays/`.
- The current local viewer auto-loads MPQs from `../bw/` via the wrapper's `docs/bw` symlink.
- The current browser build disables SDL_mixer, so replay audio is not enabled yet.
