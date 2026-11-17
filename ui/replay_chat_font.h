#ifndef OPENBW_REPLAY_CHAT_FONT_H
#define OPENBW_REPLAY_CHAT_FONT_H

#include <array>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>
#include <algorithm>

namespace bwgame {

struct replay_chat_font {
	struct glyph {
		int width = 0, height = 0, x = 0, y = 0;
		std::vector<uint8_t> pixels;
	};
	struct letter { uint8_t code; uint8_t color; };
	using line = std::vector<letter>;
	std::array<glyph, 256> glyphs;
	int width = 0, height = 0;

	void load(const uint8_t* data, size_t size) {
		if (size < 8 || std::string((const char*)data, 4) != "FONT") throw std::runtime_error("Invalid chat font");
		int low = data[4], high = data[5];
		width = data[6]; height = data[7];
		if (high < low || !width || !height || size < 8 + 4 * size_t(high - low + 1)) throw std::runtime_error("Invalid chat font table");
		for (int code = low; code <= high; ++code) {
			size_t pos = 8 + 4 * size_t(code - low);
			size_t offset = size_t(data[pos]) | size_t(data[pos + 1]) << 8 | size_t(data[pos + 2]) << 16 | size_t(data[pos + 3]) << 24;
			if (!offset) continue;
			if (offset > size || size - offset < 4) throw std::runtime_error("Truncated chat font glyph");
			auto& g = glyphs[code];
			g.width = data[offset++]; g.height = data[offset++]; g.x = data[offset++]; g.y = data[offset++];
			if (g.width + g.x > width || g.height + g.y > height) throw std::runtime_error("Invalid chat font glyph bounds");
			g.pixels.assign(size_t(g.width * g.height), 0);
			for (size_t pixel = 0; pixel < g.pixels.size();) {
				if (offset >= size) throw std::runtime_error("Truncated chat font pixels");
				uint8_t run = data[offset++];
				pixel += run >> 3;
				if (pixel < g.pixels.size()) g.pixels[pixel++] = run & 7;
			}
		}
	}

	int advance(uint8_t code) const {
		if (code == '\t') return width * 2;
		if (code == ' ') return width / 2;
		return glyphs[code].width;
	}

	// Indices into the original game/tfontgam.pcx eight-shade ramps.
	static int color_ramp(int code) {
		switch (code) {
		case 1: case 2: case 26: return 0;
		case 3: return 1; case 4: return 2; case 5: return 3;
		case 6: return 4; case 7: return 5; case 11: return 6;
		case 20: return 7; case 8: return 8; case 14: return 9;
		case 15: return 10; case 16: return 11; case 17: return 12;
		case 21: return 13; case 22: return 14; case 23: return 15;
		case 24: return 16; case 25: return 17; case 27: return 18;
		case 28: return 19; case 29: return 20; case 30: return 21;
		case 31: return 23; default: return -1;
		}
	}

	std::vector<line> wrap(const std::string& text, int max_width) const {
		std::vector<line> lines;
		line current;
		int current_width = 0, color = 2;
		bool locked_color = false;
		auto emit = [&]() { lines.push_back(std::move(current)); current = {}; current_width = 0; };
		for (uint8_t code : text) {
			if (code == '\r') continue;
			if (code == '\n') { emit(); continue; }
			if (code < 32 && code != '\t') {
				int next = color_ramp(code);
				if (next >= 0 && !locked_color) { color = code; locked_color = code == 5 || code == 11 || code == 20; }
				continue;
			}
			int step = advance(code);
			if (current_width + step > max_width && !current.empty()) {
				auto space = std::find_if(current.rbegin(), current.rend(), [](letter l) { return l.code == ' ' || l.code == '\t'; });
				if (space != current.rend()) {
					size_t cut = size_t(std::distance(current.begin(), space.base()) - 1);
					line tail(current.begin() + cut + 1, current.end());
					current.resize(cut); emit(); current = std::move(tail);
					for (auto l : current) current_width += advance(l.code);
				} else emit();
			}
			if ((code == ' ' || code == '\t') && current.empty()) continue;
			current.push_back(letter{code, uint8_t(color)}); current_width += step;
		}
		if (!current.empty()) lines.push_back(std::move(current));
		return lines;
	}

	void draw(const line& text, int x, int y, uint32_t* pixels, size_t pitch,
	          int screen_width, int screen_height, const std::array<std::array<uint32_t, 8>, 24>& palette) const {
		for (auto letter : text) {
			const auto& g = glyphs[letter.code];
			int ramp = color_ramp(letter.color);
			for (int gy = 0; gy < g.height; ++gy) {
				int py = y + g.y + gy;
				if (py < 0 || py >= screen_height) continue;
				for (int gx = 0; gx < g.width; ++gx) {
					int px = x + g.x + gx;
					uint8_t shade = g.pixels[size_t(gy * g.width + gx)];
					if (!shade || px < 0 || px >= screen_width || ramp < 0) continue;
					uint32_t value = palette[ramp][shade];
					if (value != 0xffff00ff) pixels[size_t(py) * pitch + px] = value;
				}
			}
			x += advance(letter.code);
		}
	}
};

}
#endif
