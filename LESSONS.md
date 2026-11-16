# Engineering Lessons

## Engine Compatibility

- Remastered terrain affects simulation outcomes. Use its extended terrain
  tables and compare independent states throughout the replay; reaching the
  last frame does not establish fidelity.
- Reference comparisons must use the same unit population. The saved reference
  excludes transported units and turrets, but includes workers in refineries.
- Check provenance and licensing before incorporating third-party source.
- Audit the behavioral diff between engine variants. Separate directories and
  successful replay completion do not establish shared-feature parity.
- Unit-ID generation bits must not be discarded when reading wider replay
  commands. Keep the ID layout state-local so separate simulations cannot
  change each other's interpretation.
- Remastered observer IDs can carry chat without belonging to a player slot.
  Consume those messages without assigning them to a player or counting APM.
- An empty command section can be omitted or represented by a legacy empty
  frame. Do not consume the following map-length section in the omitted case.

## Rendering and Playback

- Player controller state is not replay identity. Capture the initial roster
  for forced colors; use sprite ownership for units and minimap markers after
  elimination transfers simulation ownership to neutral.
- Scenery can have owners outside player slots 0-11. Normalize rendering palette
  lookups without changing simulation ownership. A white canvas can indicate a
  renderer exception; inspect logs and pan to the affected sprite in tests.
- Recompute fog-of-war `ui.vision` after seeks and restores. It depends on both
  the selected vision mask and the current replay state's occupied players.
- Render the actual terminal frame. Temporarily restoring an earlier snapshot
  can discard camera input and cause snap-back, even with observation paused.
- Publish frame-zero UI and redraw during replay loading. A paused or idle main
  loop will not necessarily refresh the canvas or footer after the load callback.
- Reapply the initial camera center after deferred zoom restoration, then redraw:
  resizing clears the canvas, and preserving a clamped center can shift the view.
- A snapshot-count limit is not a memory budget. Trim the shared snapshot cache
  under WASM heap pressure, leaving room for the working simulation and redraws.
  Use 64-bit distance scores when selecting snapshots to evict in long replays.
- Catch loading and simulation exceptions at the shared viewer boundary. Stop
  the failed engine and audio, display a readable error, and preserve a working
  replay picker. Test recovery after a prior successful load as well as startup.

## Regression Testing

- Freeze playback to test initial camera and status-bar state. Test first URL
  loads separately from replacing a paused replay, and check pixels and field
  visibility as well as engine coordinates and values.
- Direct test calls that set a seek target must resume the paused idle main loop.
  Real playback controls handle this themselves.
- For brief replay events, seek while paused to a known preceding frame, then
  resume at normal speed and capture the event in the browser animation loop.
  Detect the event independently of the expected behavior, then assert the
  behavior; polling at high playback speed can miss an otherwise correct result.
- Use local MPQs and intercepted replay downloads in browser tests. Public replay
  URLs can expire; network failures should not masquerade as engine regressions.
- Test camera score ties and hold decisions with controlled native state. A
  fixed replay timestamp does not guarantee a combat dropout or an equal-score
  offscreen candidate after camera timing and viewport changes.
- GCC AddressSanitizer PIE binaries can fail during sanitizer initialization in
  the WSL container, even with an empty `main()`. Use `-fno-pie -no-pie` for
  native sanitizer test binaries; do not change production flags or hide reports.
- Test range drags in stock Firefox with real input. Global `mouseup` handlers
  calling `preventDefault()` can make native range values snap back in ways
  synthetic Playwright events do not reproduce.

## Build Integration

- Emscripten 1.38.48 requires explicit `callMain` export. Use `UTF8ToString` and
  `_malloc`/`Module.HEAPU8`, not deprecated string and allocation helpers.
- Disabling SDL_mixer does not disable game audio: the browser uses Web Audio.
- Web compilation alone does not refresh Neutralino resources. Package desktop
  assets in the default build and verify byte-for-byte equality with `docs/`.
