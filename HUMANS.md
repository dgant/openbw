# OpenBW Replay Viewer

## Local development

Build the browser runtime from this repository into the replay viewer wrapper:

```bash
./scripts/build_replay_viewer.sh
```

Install the browser test dependencies:

```bash
npm install
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

- The current local build writes `openbw.js` and `openbw.wasm` into `../openbw-replay-viewer/docs/v1.4/`.
- The wrapper HTML/JS currently still lives in `../openbw-replay-viewer/docs/`.
- Example replays are in `../replays/`.
- The current local viewer auto-loads MPQs from `../bw/` via the wrapper's `docs/bw` symlink.
- The current browser build disables SDL_mixer, so replay audio is not enabled yet.
