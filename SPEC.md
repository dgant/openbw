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
