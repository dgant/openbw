# Lessons

- Authentication differs between the host and container: the Windows `gh`
  keyring OAuth login can create upstream cross-fork pull requests, while the
  fine-grained `.env` token used in the container was rejected for that operation.
  Check the previously successful workflow and `gh auth status` before concluding
  the task needs new credentials. Keep credential values out of logs and source.

- The 2026-11-06 Remastered integration was reverted because it imported
  LGPLv3-derived code without approval. Check source provenance and licensing
  before importing code, including C++ patches distributed by a Go project.
  Use the requested direct C++ OpenBW fork and narrow upstream changes instead
  of adding another language or adapting an independently licensed port.

- The `basil-ladder/openbw` fog-of-war branch merges cleanly into the current `openbw` master.
- The historical replay-viewer Emscripten build no longer works with the original `1.38.13` SDK tag because that exact target is no longer in the current `emsdk` manifest.
- `emsdk` `1.38.48` can build the web runtime, but the SDL_mixer port currently fails during configure in this container. The local build script therefore disables SDL mixer so the viewer remains buildable while audio is investigated separately.
- With `emsdk` `1.38.48`, the generated browser runtime needs `callMain` exported explicitly and the wrapper must use `UTF8ToString` plus direct `_malloc`/`Module.HEAPU8` buffer copies instead of deprecated `Pointer_stringify` and `allocate(...)` usage.
- Firefox can snap native `<input type="range">` controls back to their previous value after a drag if a document/window/body `mouseup` handler calls `preventDefault()`. Reproduce range-drag bugs in stock Firefox with a real driver, not only Playwright synthetic events, and avoid relying on the native drag path when global mouse handlers are present.
- Fog-of-war `ui.vision` is derived from both the selected player mask and the replay state's currently occupied players. Recompute it after replay seeks/restores; otherwise reaching a terminal state can leave a rewound replay with stale effective vision even though the selection UI is still enabled.
- Loading replay data changes the engine synchronously, but a paused or idle browser loop may not repaint or refresh the footer before the load callback returns. Publish frame-zero UI state and force one static redraw as part of the load transaction.

- Updating the web runtime does not update Neutralino desktop resources automatically. Keep desktop packaging in the default build and verify bundled assets against the local web tree. Windows file associations must point to that maintained output, not a duplicate release folder.

- Map scenery can carry an owner outside player slots 0–11 (Roadkill has owner 12). Normalize the palette lookup to neutral before calling player-color overrides, without changing simulation ownership. A white canvas can be a C++ `array::at` exception during rendering, not damaged MPQs. Regressions must pan to the offending sprite: another initial camera position can hide the bug.

- Player controller state is not replay identity: elimination changes occupied slots to user-left and transfers units to neutral, while sprites retain their visual owners. Capture the initial participant roster for color assignment and use sprite ownership for minimap colors too.
- Do not repair terminal-frame colors by temporarily restoring an earlier simulation snapshot. The old path also processed input, then restored the previous camera position, producing snap-back even with the observer paused. Render the real final state with stable display identities. Tests should check that final state's colors and input response, not require a pixel-identical copy of the preceding frame.
- For initial-status regressions, freeze the first URL load at frame zero and assert both field content and visibility. In the October 2026 report, the current first-load path and actual PurpleBench URL passed this check; the existing replacement-while-paused test alone did not establish that.
- Startup camera tests need known replay starting coordinates away from the
  origin, and must freeze playback so automatic observation cannot mask a
  missing initial position. Reapply the starting center after deferred saved
  zoom restoration: preserving an already map-clamped center can offset the
  final zoomed view.
- Camera coordinates alone do not prove a visible startup frame. Deferred zoom
  restoration resizes and clears the canvas after the first static redraw; a
  paused replay needs another static redraw after that resize. Check rendered
  pixels and inspect screenshots, not just camera state.
- Public ladder replay URLs can expire (the Brainiac/Roadrunner startup fixture
  returned HTTP 404). Intercept the external download with stable local replay
  bytes for URL-loading regressions; do not confuse archive availability with
  a viewer startup failure.
