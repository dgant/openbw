# Replay Viewer Build Specification

## Replay Engines

- Classic 1.16.1 and Remastered replays use independently maintained engines
  under `engines/classic/` and `engines/remastered/`. Both build directly from
  checked-in sources with the shared viewer and common headers.
- Both engines use the existing C++ toolchain. Dependency or licensing changes
  require explicit approval.
- Remastered is a minimal local fork of the pre-Remastered engine in this
  repository, not an import from another engine fork. Differences must be
  required by Remastered formats or demonstrated simulation behavior.
- Replay decoding reads compression and limits directly. Native command and
  map loaders handle wider unit IDs and extended string offsets without an
  intermediate replay format or lossy map conversion.
- Rendering, notifications, audio, and controls follow the same paths wherever
  their behavior is not format-specific. Classic inputs with classic data must
  produce matching simulation states and notifications in either engine.
- Each engine has its own WASM instance and terrain data. Switching formats
  stops the old main loop and removes its input handlers before creating the
  replacement. Settings and the shared viewer controls remain available.
- The renderer supports the extended terrain indices used by Remastered maps.
- Native tests must check independent reference states and rewind determinism,
  not merely successful loading or completion. Browser tests cover both formats,
  switching, playback controls, URL seeks, and desktop/mobile rendering.
- Invalid or unsupported replays must stop cleanly and leave another replay
  loadable without refreshing. Both engines share this error boundary.
- The snapshot cache must respect heap pressure, not only a snapshot count,
  while retaining the first and latest checkpoints for seeking.
- Release validation must distinguish simulation fidelity from completion and
  cover repeated loads, long games, observers, and failure recovery. Built-in
  AI and unimplemented custom-map triggers are outside supported playback.

## Build Outputs

The default `scripts/build_replay_viewer.sh` command builds the OpenBW browser
runtime into the sibling `openbw-replay-viewer/docs/v1.4` directory, then packages
the maintained `openbw-replay-viewer/desktop` application from that same `docs`
tree. Desktop packaging must not run when compilation fails. Build success
requires the packaged web assets to match the local web assets byte for byte.

The Windows `.rep` association points to
`openbw-replay-viewer/desktop/dist/replay-viewer-desktop/replay-viewer-desktop-win_x64.exe`.
The executable and `resources.neu` must remain together. Builds replace that
output in place; do not maintain a separate desktop copy.

## Scenery rendering

Map decorations with owners outside player slots 0–11 must render using neutral
player 11's palette without stopping playback. Normalize only the rendering
color lookup, before applying player-color overrides; preserve the original
simulation owner. Valid player colors and two-player red/blue overrides must
remain unchanged.

## Replay lifecycle

- Each replay load centers the camera on the first participant's starting
  location (player-slot order), clamped to map bounds, before playback advances.
  This applies with automatic camera on or off, after restoring saved zoom,
  and when replacing a paused replay. Later manual movement remains unaffected.
- Red/blue mode uses the original replay participants in player-slot order,
  not the players still active at the current frame. The assignment survives
  elimination, replay completion, and rewind, and resets when loading another
  replay. A game starting with more than two players never becomes eligible
  merely because players leave.
- Unit sprites and minimap markers use the same visual owner for their palette,
  including units neutralized when a player leaves. Simulation ownership is
  unchanged.
- The actual final simulation frame is rendered directly. Redrawing must not
  rewind the simulation, discard camera input, or restore an old camera position.
  Manual camera movement remains available while paused or finished, with
  automatic camera enabled or disabled and either player-color mode selected.
- A newly loaded replay publishes its map, names, and initial statistics before
  playback advances. Frame-zero status must be visible at desktop viewport sizes
  without requiring a play action; ordinary responsive column hiding still applies.
