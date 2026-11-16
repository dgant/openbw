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

The viewer is served on port 8080 inside the container:

```text
http://localhost:8080/
```

On the host, use the port selected by `REPLAY_VIEWER_PORT` in the workspace's
Compose environment. Browser tests use container port 8080 directly.

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

Test nuclear-missile camera targeting:

```bash
npx playwright test tests/e2e/replay-viewer.spec.js --grep "visible falling missiles"
```

This uses the workspace's `Hannes Bredberg vs VOID La Mancha1.1 (Nukes).rep`.
It seeks paused to frame 44299, resumes normal playback, and checks the visible
descent at frames 44300-44369 toward (2087, 3771). Camera targets must match the
landing point, not the airborne sprite. The test saves
`test-results/visible-missile-camera.png`. Add `--repeat-each=3` for stability checks.

Test starting-camera positioning with automatic camera on/off, saved zoom,
and replacement of a paused replay:

```bash
npx playwright test tests/e2e/replay-start-camera.spec.js
```

This uses the workspace's Tau Cross example replay and the committed Gladiator
fixture, checks their known starting coordinates and painted canvas pixels at
frame zero (including after deferred zoom restoration), and saves
`test-results/start-camera-*.png` for visual inspection.

## Remastered Replays

The same viewer accepts classic and Remastered files, detects the format, and
loads a separate C++/WASM engine automatically. Standard multiplayer replays
are the supported use case. Built-in AI and some custom-map triggers are not
implemented. Unsupported or malformed files show an error and leave the file
picker available; loading another replay does not require refreshing the page.

Edit the 1.16.1 engine in `engines/classic/` and the Remastered engine in
`engines/remastered/`. The default build compiles both directly and packages
them for web and desktop. See [engines/README.md](engines/README.md) for the
include paths, shared headers, and source provenance.

Run the focused native/reference, rewind, malformed-input and browser tests:

```bash
npm run test:remastered
```

The native tests compare unit identities, types, owners and positions against
independent reference states, and check completion and deterministic rewind
from a midgame snapshot through the ending state, including resources, RNG,
health, energy, orders, upgrades, and unit identities.
They also compare classic replay states and damage notifications across both
engines, and exercise full-width unit IDs, pool limits, preserved map bytes,
and extended map string offsets.
Fixture details are documented in `tests/fixtures/README.md`.
Browser tests switch formats repeatedly, exercise URL loading and seek/rewind,
and check rendered pixels and screenshots at desktop and 375x667 sizes.
The browser server must be running on port 8080; tests use its local `/bw/`
copies of the MPQs rather than downloading them repeatedly.

## Release Verification

Run the full source, replay, browser, and desktop suites against newly built
assets, with no skipped regressions or unexplained browser errors. The default
browser is Chromium. For the shared engine lifecycle tests in Firefox and WebKit:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright npx playwright install --with-deps firefox webkit
PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright OPENBW_TEST_BROWSER=firefox npx playwright test tests/e2e/replay-formats.spec.js
PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright OPENBW_TEST_BROWSER=webkit npx playwright test tests/e2e/replay-formats.spec.js
```

Exercise representative long replays, all race matchups, observers, multiple
maps, and repeated loads in one browser session. Check completion, seek/rewind,
canvas pixels, and recovery after unsupported files and failed asset downloads.
Keep private replay collections out of commits and release artifacts.

Completion and deterministic rewind demonstrate stability, not agreement with
every StarCraft version. Keep independent reference comparisons distinct from
corpus completion results, and record the tested scope and limitations in the
pull request. A passing test suite does not authorize merging or deployment.

## Build Notes

- The default build also packages those same web assets into `../openbw-replay-viewer/desktop/dist/replay-viewer-desktop/` and verifies the bundled files match `docs/`. A desktop packaging or verification failure fails the build.
- On first use, the build installs the locked desktop dependencies and downloads the configured Neutralino runtime if missing.
- On Windows, run `../openbw-replay-viewer/desktop/scripts/register-file-association.ps1` once to register the stable output path for `.rep`. Keep the executable and `resources.neu` together.
- The build writes classic `openbw.js` and `openbw.wasm` into `../openbw-replay-viewer/docs/v1.4/`, and the Remastered runtime into its `remastered/` subdirectory.
- The wrapper HTML/JS lives in `../openbw-replay-viewer/docs/`.
- Example replays are in `../replays/`.
- The local viewer auto-loads MPQs from `../bw/` via the wrapper's `docs/bw` symlink.
- The browser build disables SDL_mixer; game audio uses the existing Web Audio backend instead.
