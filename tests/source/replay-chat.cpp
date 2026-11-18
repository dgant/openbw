#include <iostream>
#include "ui/ui.h"
#include <cassert>

namespace bwgame { namespace ui {
void log_str(a_string text) { std::cerr << text; }
void fatal_error_str(a_string text) { throw std::runtime_error(text.c_str()); }
}}

int main() {
	using namespace bwgame;
	global_state global;
	game_state game;
	state st;
	st.global = &global;
	st.game = &game;
	game_player player;
	player.set_st(st);
	ui_functions ui(std::move(player));
	ui.current_action_state.player_id[0] = 7;
	int attempts = 0;
	ui.has_loaded_sound.resize(24);
	ui.loaded_sounds.resize(24);
	ui.sound_filenames.resize(24);
	ui.sound_filenames[23] = "missing.wav";
	ui.set_volume(100);
	ui.load_data_file = [&](a_vector<uint8_t>&, a_string name) {
		assert(name == "sound/missing.wav");
		++attempts;
		error("file not found");
	};

	std::array<uint8_t, 83> packet{{7, 92, 0}};
	auto send = [&]() { return ui.read_action(packet.data(), packet.size()); };
	auto& chat = ui.current_action_state.chat;
	assert(send() && !chat.received && !attempts);
	std::fill(packet.begin() + 3, packet.end(), 'x');
	ui.is_paused = true;
	assert(send() && chat.recent.back().sender == 0 && chat.recent.back().text.size() == 80 && !attempts);
	ui.is_paused = false;
	ui.set_acknowledgement_volume(0);
	assert(send() && !attempts);
	ui.set_acknowledgement_volume(100);
	packet[2] = 254;
	for (int i = 1; i <= 15; ++i) {
		st.current_frame = i;
		assert(send());
	}
	assert(attempts == 1 && !ui.acknowledgement_play_count);
	assert(chat.recent.size() == 11 && chat.recent.front().frame == 5 && chat.recent.back().sender == 254);
	auto snapshot = copy_state(ui.current_action_state, st, st);
	try {
		ui.read_action(packet.data(), packet.size() - 1);
		assert(false);
	} catch (const exception&) {}
	assert(snapshot.chat.received == chat.received && snapshot.chat.recent.size() == chat.recent.size());
}
