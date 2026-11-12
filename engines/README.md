# Replay Engines

`classic/` contains the 1.16.1 OpenBW engine. `remastered/` starts from the same
engine with local changes for Remastered's replay and data formats. Both use
the same UI, notifications, audio, controls, and common OpenBW headers. Edit
these sources directly; neither target needs another engine repository,
build-time patches, or a generated source tree.

Compile with `-I engines/classic -I .` or `-I engines/remastered -I .`.
The root engine entry headers forward to classic for existing BWAPI clients
that use only `-I .`. Shared headers must resolve engine-specific includes
through the selected include path, not relative to the repository root.

The web build sets `OPENBW_REMASTERED_RUNTIME` and enables zlib for Remastered.
Only that target uses the extended terrain tables in the viewer's
`docs/v1.4/remastered/terrain.mpq`, extracted from StarCraft: Remastered. The
adjacent manifest records the game build and file hashes. Terrain differences
affect simulation as well as rendering.

`remastered/remastered_replay.h` reads compressed replay sections and metadata
directly into the engine's header, command, map, and unit-limit data.
Both engines expect a fresh simulation, game, replay, and action state for each
load; the shared viewer's `reset()` supplies this lifecycle.

## Engine Differences

- Replay compression and metadata: zlib/PKWARE sections and `LMTS` limits.
- Object pools and snapshots: runtime capacities from the replay, retaining
  OpenBW's allocation order. Unit-ID layout belongs to the simulation state.
- Commands: the existing handlers read 32-bit IDs for opcodes 96-101, without
  discarding generation bits or translating them into another command stream.
  Observer chat is consumed without creating a player or changing APM.
- Maps: versions 64/206 and 32-bit `STRx` offsets are read by the map loader.
  Embedded map bytes are preserved, not converted to a legacy map format.
- Terrain: the shared renderer reads extended tile indices for Remastered.

All other engine behavior should stay aligned. In particular, entity structures,
synchronization, damage notifications, and sprite positioning use the original
OpenBW implementations. Do not import external engine-fork code to add support.

`npm run test:remastered` checks independent replay states, rewind, format
boundaries, and classic simulation/notification parity between the two engines.
