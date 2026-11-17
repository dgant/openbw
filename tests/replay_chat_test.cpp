#include <iostream>
#include "data_loading.h"
#include "replay_chat.h"
#include "ui/replay_chat_font.h"
#include "ui/replay_chat_font_data.h"
#include <cassert>
#include <iostream>

int main() {
	using namespace bwgame;
	a_vector<replay_chat_message> messages;
	std::array<uint8_t, 81> packet{};
	packet[0] = 0; packet[1] = 'h'; packet[2] = 'i';
	auto read = [&](int frame) {
		data_loading::data_reader_le r(packet.data(), packet.data() + packet.size());
		read_replay_chat(messages, frame, r);
		assert(r.ptr == packet.data() + packet.size());
	};
	read(1);
	assert(messages.size() == 1 && messages[0].text == "hi" && messages[0].sender == 0);
	assert(!replay_chat_visible(messages[0], 0));
	assert(replay_chat_visible(messages[0], 167));
	assert(!replay_chat_visible(messages[0], 168));
	packet[0] = 3; packet[1] = 7; packet[2] = 'g'; packet[3] = 'g';
	read(12);
	assert(messages.back().sender == 3 && messages.back().text[0] == 7);
	packet[1] = 0; read(13); assert(messages.size() == 2);
	packet.fill('x'); packet[0] = 249; read(14);
	assert(messages.back().sender == 249 && messages.back().text.size() == 80);
	for (int frame = 15; frame < 35; ++frame) read(frame);
	assert(messages.size() == 11 && messages.front().frame == 24);
	bool rejected = false;
	try { data_loading::data_reader_le r(packet.data(), packet.data() + 80); read_replay_chat(messages, 40, r); }
	catch (const std::exception&) { rejected = true; }
	assert(rejected && messages.size() == 11);

	replay_chat_font font;
	font.load(replay_chat_font_data, sizeof(replay_chat_font_data));
	assert(font.width == 10 && font.height == 13 && font.advance(' ') == 5);
	auto lines = font.wrap("TinyPlutoTerran: hello world", 70);
	assert(lines.size() > 1);
	for (auto& line : lines) { int width = 0; for (auto l : line) width += font.advance(l.code); assert(width <= 70); }
	lines = font.wrap(std::string(1, char(7)) + "A", 620);
	assert(lines.size() == 1 && lines[0].size() == 1 && lines[0][0].color == 7);
	std::array<std::array<uint32_t, 8>, 24> palette{};
	for (auto& ramp : palette) ramp.fill(0xff000007);
	std::vector<uint32_t> pixels(10 * 13 + 2, 0x12345678);
	font.draw(lines[0], -2, -2, pixels.data() + 1, 10, 10, 13, palette);
	assert(pixels.front() == 0x12345678 && pixels.back() == 0x12345678);
	assert(std::count(pixels.begin(), pixels.end(), 0xff000007) > 0);
	const uint8_t bad_font[] = {'F','O','N','T',32,33,10,13};
	rejected = false;
	try { font.load(bad_font, sizeof(bad_font)); } catch (const std::exception&) { rejected = true; }
	assert(rejected);
	std::cout << "Replay chat: sender slots, control bytes, bounds, expiry, font, colors, wrapping and clipping passed\n";
}
