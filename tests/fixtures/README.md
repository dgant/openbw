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
