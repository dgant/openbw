# Scenery-owner regression

`roadkill-scenery-owner-12.rep` is the PurpleBench game
`GAME_PB_D86AB41A29_0536` (Stardust vs PurpleProtoss on Roadkill).
Its Badlands scenery sprite 102 at (2624, 912) has owner 12, outside the
engine's player slots 0–11. Pan to that position to exercise the failing draw
path; merely loading the replay in a different viewport can miss it.
