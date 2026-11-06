# Scenery-owner regression

`roadkill-scenery-owner-12.rep` is the PurpleBench game
`GAME_PB_D86AB41A29_0536` (Stardust vs PurpleProtoss on Roadkill).
Its Badlands scenery sprite 102 at (2624, 912) has owner 12, outside the
engine's player slots 0–11. Pan to that position to exercise the failing draw
path; merely loading the replay in a different viewport can miss it.

# Replay-lifecycle regression

`elimination-0145.rep` is PurpleBench game `GAME_PB_4701EDE9CB_0145`
(PurpleProtoss vs krasi0 on Gladiator1.1). At the end, a player's controller
changes from occupied to user-left. This must not change the replay's original
red/blue assignment, including neutralized units on the minimap. Test manual
camera movement with forced colors enabled: the former terminal-frame redraw
rewound the simulation and discarded camera input. The same fixture also covers
visible status-bar fields at frame zero on a first URL load.

# Remastered format regressions

These unmodified replay files come from the public
[CWAL build-classifier corpus](https://github.com/dxrsz/cwal-build-classifier/tree/main/corpus/replays):

- `remastered-zvz.rep`: `MM-00193414-BE38-11F1-A71E-FA167AEAB62F.rep`,
  getoutchobo vs vvvvooo! on Octagon SE 2.0, 12,518 frames. Includes neutral
  neutral eggs on extended terrain and extended player names.
- `remastered-tvp.rep`: `MM-2AC59A40-BEE2-11F1-A71E-FA167AEAB62F.rep`,
  lIlIlIIIllIlIlI vs 454553455 on Radeon 1.2, 7,333 frames.

The native test completes both games and alternates them with the legacy
Gladiator fixture. Browser tests exercise dropped files, playlists, playback,
rewind and downloads. These fixtures are regression inputs, not a claim of
frame-perfect Remastered simulation accuracy.

`remastered-backrooms-desync.rep` is the user's reported October 29, 2026 replay,
scloader (Z) vs 20YY (T), Backrooms 1.1, 14,036 frames. With classic terrain it
first targets a missing unit at frame 2233. `remastered-backrooms-reference.json`
contains independent unit snapshots captured from sagi.gg's current viewer;
its runtime generation, columns and sample frames are recorded in the file.
The test compares every non-neutral, non-loaded, non-turret live unit at each
sample and pins the three late selections of dead units across the whole game.
