# Replay Viewer Build Specification

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
