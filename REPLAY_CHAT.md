# In-game replay chat

Chat is drawn directly into the game canvas. There is no history panel or
additional interface. Both replay engines retain the sender slot, frame and
80-byte text field, including native color codes. The sender byte is separate
from the text; treating it as a character loses player-zero messages.

The last eleven messages are presentation state in `action_state`, copied by
the same snapshot function as selections and control groups. Seeking restores
that state; future messages are never shown. Display lifetime is 167 frames,
the rounded-up equivalent of the classic seven-second timeout at 42 ms/frame.
Pause freezes this replay clock. Long messages wrap to the eleven visible lines.

## Classic appearance

- Original English `font10` bitmap glyphs, with their native advances and offsets.
- Eight-shade color ramps from the loaded game's `game/tfontgam.pcx`, including
  inline message color controls. Replay names are followed by `: `.
- Classic coordinates: x=10; eleven lines at y=112..272 with 16-pixel spacing.
  Messages are bottom-aligned; unusually small viewports clip safely.
- `Misc/Transmission.wav` (sound 23 / 0x17), through the existing master and
  acknowledgement sound controls. Paused seeking and fast seeking are silent.

These defaults were checked against the installed 1.16.1 executable's
`PrintText` (0x0048D1C0), chat initialization (0x0048CE90) and rendering
(0x0048CF60), and its `sfxdata.dat`/`sfxdata.tbl` sound mapping. The seven-second
timeout is 0x1B58 ms. This is classic bitmap text, not Remastered HD typography.
Alternate-language glyph sets, including Korean, are not implemented here.

The bitmap data is an original Blizzard StarCraft game asset. Its unencrypted
reference is `PyMS/MPQ/font/font10.fnt` in
[PyMS 6e325d2e9474716fa2be3aca6479ff7d29dbaab5](https://github.com/poiuyqwert/PyMS/blob/6e325d2e9474716fa2be3aca6479ff7d29dbaab5/PyMS/MPQ/font/font10.fnt).
SHA-256: `10dcf7cf3ee78f29f20992d4608e4f6c9b1c8f26d502b2e70794b437033c27f9`.
The included byte array is exactly that 7,718-byte font, not a replacement font.
The FNT metric/encoding reference is also documented by
[BWAPI's Font implementation](https://github.com/bwapi/bwapi/blob/main/bwapi/BWAPI/Source/BW/Font.cpp).

## Verification

Run `node --test tests/source/replay-chat.test.js`. It builds both engines'
chat headers with address and undefined-behavior sanitizers and checks
sender zero/nonzero/observer slots, all eighty text bytes, truncated input,
color controls, expiration, font decoding, word wrapping
and pixel clipping. Browser verification must additionally check the actual
rendered messages, expiry, frame zero, snapshot restoration on rewind and
normal-play sound. Full engine-state construction has existing intrusive-list
null-pointer/offset diagnostics under UBSan; those are outside this focused
parser/renderer sanitizer test, and have not been changed or suppressed.

The native UI and MPQ reader are heap-owned so browser callbacks do not retain
`callMain` stack references. A modern Emscripten build must explicitly retain
the older SDK's five-MiB stack (`-sSTACK_SIZE=5242880`); its newer 64-KiB default
is insufficient for existing replay-state temporaries. This is a compiler
compatibility setting and does not alter simulation behavior.
