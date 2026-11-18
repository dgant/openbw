const { test, expect } = require("./fixtures");
const fs = require("node:fs");
const path = require("node:path");
const { crc32 } = require("node:zlib");

// Preserve the fixture's header, map and metadata; replace just the two
// command sections (length + data) with checksum-valid uncompressed blocks.
function chatReplay(file, modern) {
  const bytes = fs.readFileSync(path.join(__dirname, "../fixtures", file));
  const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };
  const block = b => Buffer.concat([u32(~crc32(b)), u32(1), u32(b.length), b]);
  const next = start => {
    let p = start + 8;
    for (let n = bytes.readUInt32LE(start + 4); n--; ) p += 4 + bytes.readUInt32LE(p);
    return p;
  };
  const metadata = bytes.readUInt32LE(12) === 0x53526573;
  const start = next(next(0) + (metadata ? 4 : 0));
  const end = next(next(start));
  const field = Buffer.alloc(80);
  // Two encodings of the same Hangul syllable. Include inline green and a
  // long word to exercise wrapping at mobile width.
  Buffer.concat([Buffer.from([7]), modern ? Buffer.from("\uac00") : Buffer.from([0xb0, 0xa1]),
    Buffer.from(" " + "W".repeat(70))]).copy(field);
  const commands = Buffer.concat([u32(230), Buffer.from([83, modern ? 128 : 0, 92, 0]), field]);
  const replacement = Buffer.concat([block(u32(commands.length)), block(commands)]);
  const prefix = Buffer.from(bytes.subarray(0, start));
  if (metadata && prefix.readUInt32LE(16)) prefix.writeUInt32LE(prefix.readUInt32LE(16) + replacement.length - (end - start), 16);
  return Buffer.concat([prefix, replacement, bytes.subarray(end)]);
}

async function seek(page, frame) {
  await page.evaluate(f => { _replay_set_value(1, 1); _replay_set_value(3, f); resume_viewer_main_loop(); }, frame);
  await page.waitForFunction(f => _replay_get_value(2) === f, frame);
}

async function chatPixels(page) {
  return page.evaluate(() => {
    let result = null;
    const ctx = Module.canvas.getContext("2d"), original = ctx.drawImage;
    ctx.drawImage = function(source, x, y, ...args) {
      original.call(this, source, x, y, ...args);
      if (x !== 10 || !(source instanceof HTMLCanvasElement)) return;
      const actual = ctx.getImageData(x, y, source.width, source.height).data;
      const ink = source.getContext("2d").getImageData(0, 0, source.width, source.height).data;
      let opaque = 0, matched = 0, brightGreen = 0;
      for (let i = 0; i < ink.length; i += 4) {
        if (ink[i+3] !== 255) continue;
        ++opaque;
        if (ink[i+1] > 170 && ink[i] < 65 && ink[i+2] < 65) ++brightGreen;
        if (actual[i] === ink[i] && actual[i+1] === ink[i+1] && actual[i+2] === ink[i+2]) ++matched;
      }
      result = { opaque, matched, brightGreen, height: source.height, png: source.toDataURL() };
    };
    try { _ui_force_static_redraw(); } finally { ctx.drawImage = original; }
    return result;
  });
}

for (const [file, modern] of [["elimination-0145.rep", false], ["remastered-backrooms-desync.rep", true]]) {
  test((modern ? "Remastered" : "classic") + " chat follows playback, snapshots and audio", async ({ page }) => {
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setViewportSize({width: 375, height: 667});
    if (modern) await page.route("**/font10.fnt", route => route.fulfill({status: 204, headers: {"access-control-allow-origin": "*"}}));
    await page.goto("/");
    await page.waitForFunction(() => mpq_data_ready);
    await page.setInputFiles("#select_rep_file", {name: "chat.rep", mimeType: "application/octet-stream", buffer: chatReplay(file, modern)});
    await page.waitForFunction(() => _replay_get_value(4) > 0);
    await seek(page, 229);
    expect(await chatPixels(page)).toBeNull();
    await seek(page, 245);
    expect(await page.evaluate(async () => !!await loadChatFont())).toBe(!modern);
    const at245 = await chatPixels(page);
    expect(at245.opaque).toBeGreaterThan(50);
    expect(at245.matched).toBe(at245.opaque);
    expect(at245.brightGreen).toBeGreaterThan(10);
    expect(at245.height).toBeGreaterThan(16);
    await page.screenshot({path: 'test-results/replay-chat-' + (modern ? 'remastered' : 'classic') + '.png'});
    await seek(page, 397);
    // Inspect the displayed frame before requesting any redraw. A multi-tick
    // paused seek can reach the target with an older frame still on screen.
    expect(await page.evaluate(h => {
      const canvas = Module.canvas, width = Math.min(620, canvas.width - 20);
      const {data} = canvas.getContext("2d").getImageData(10, Math.min(288, canvas.height - 4) - h, width, h);
      let green = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 65 && data[i+1] > 170 && data[i+2] < 65) ++green;
      return green;
    }, at245.height)).toBeLessThan(at245.brightGreen / 2);
    expect(await chatPixels(page)).toBeNull();
    await seek(page, 245);
    expect(await chatPixels(page)).toEqual(at245);
    expect(await page.evaluate(() => Module.get_acknowledgement_sound_play_count(23))).toBe(0);
    await seek(page, 229);
    await page.evaluate(() => {
      Module.set_volume(1); Module.set_acknowledgement_volume(1);
      _replay_set_value(1, 0); resume_viewer_main_loop();
    });
    await expect.poll(() => page.evaluate(() => Module.get_acknowledgement_sound_play_count(23))).toBe(1);
    expect(errors).toEqual([]);
  });
}
