# Lessons

- The `basil-ladder/openbw` fog-of-war branch merges cleanly into the current `openbw` master.
- The historical replay-viewer Emscripten build no longer works with the original `1.38.13` SDK tag because that exact target is no longer in the current `emsdk` manifest.
- `emsdk` `1.38.48` can build the web runtime, but the SDL_mixer port currently fails during configure in this container. The local build script therefore disables SDL mixer so the viewer remains buildable while audio is investigated separately.
- With `emsdk` `1.38.48`, the generated browser runtime needs `callMain` exported explicitly and the wrapper must use `UTF8ToString` plus direct `_malloc`/`Module.HEAPU8` buffer copies instead of deprecated `Pointer_stringify` and `allocate(...)` usage.
