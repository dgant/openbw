# Replay Fixtures

## Remastered Regression

`remastered-backrooms-desync.rep` is a Backrooms 1.1 replay
(scloader vs 20YY), ending at frame 14036. Its adjacent reference JSON records
unit identities, generations, types, owners and sprite positions at four
checkpoints. Capture provenance is stored in the JSON metadata.
These are independent viewer captures, not instrumented StarCraft captures.
Reference units exclude turrets and units in transports, but not workers inside
refineries. This case catches incorrect terrain data and simulation divergence.

`remastered-tvp.rep` is the modern Terran/Protoss loader fixture ending at frame
7333. Both fixtures exercise the Remastered engine, completion and snapshot rewind.

## Scenery

`roadkill-scenery-owner-12.rep` is the PurpleBench game
`GAME_PB_D86AB41A29_0536` (Stardust vs PurpleProtoss on Roadkill).
Its Badlands scenery sprite 102 at (2624, 912) has owner 12, outside the
engine's player slots 0–11. Pan to that position to exercise the failing draw
path; merely loading the replay in a different viewport can miss it.

## Replay Lifecycle

`elimination-0145.rep` is PurpleBench game `GAME_PB_4701EDE9CB_0145`
(PurpleProtoss vs krasi0 on Gladiator1.1). At the end, a player's controller
changes from occupied to user-left. This must not change the replay's original
red/blue assignment, including neutralized units on the minimap. Test manual
camera movement with forced colors enabled to ensure terminal-frame redraws do
not rewind the simulation or discard camera input. The same fixture also covers
visible status-bar fields at frame zero on a first URL load.
