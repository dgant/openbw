# Replay Viewer Build Specification

## Replay formats

- Detect classic 1.16.1 and Remastered replay containers without a user setting.
  Decode classic PKWARE segments and Remastered zlib/raw segments; recognize the
  1.21+ identifier and its extended sections and 32-bit command unit references.
- Read replay-specific object limits and supported compatibility flags before
  initializing the map. Keep them in simulation state so rewinds preserve them
  and loading a legacy replay restores its original limits and behavior.
- Support modern map string tables, map version identifiers and neutral egg
  blockers on unwalkable terrain. Display extended player names.
- The same loader serves file browsing, drag-and-drop, URLs, playlists and
  standalone launches. Alternating formats must not require a page reload.
- Replay downloads retain the original bytes; conversion must not overwrite
  the user's source file. Rendering continues to use classic game assets.
- Label Remastered support experimental until independently validated against
  original-game playback across a representative version and map corpus.

The default `scripts/build_replay_viewer.sh` command builds the OpenBW browser
runtime into the sibling `openbw-replay-viewer/docs/v1.4` directory, then packages
the maintained `openbw-replay-viewer/desktop` application from that same `docs`
tree. Desktop packaging must not run when compilation fails. Build success
requires the packaged web assets to match the local web assets byte for byte.

The Windows `.rep` association points to
`openbw-replay-viewer/desktop/dist/replay-viewer-desktop/replay-viewer-desktop-win_x64.exe`.
The executable and `resources.neu` must remain together. Subsequent builds replace
that output in place. There must be no independently maintained desktop copy in
the workspace's former `replay-viewer-desktop` directory.

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
