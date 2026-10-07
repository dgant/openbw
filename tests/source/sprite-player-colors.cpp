#include <iostream>
#include "ui/ui.h"
#include <cassert>

namespace bwgame { namespace ui {
void log_str(a_string message) { std::cerr << message; }
void fatal_error_str(a_string message) { throw std::runtime_error(message.c_str()); }
}}

int main() {
	using namespace bwgame;
	global_state global;
	game_state game;
	state st;
	st.global = &global;
	st.game = &game;
	for (int owner = 0; owner != 12; ++owner) st.players[owner].color = owner;
	game_player player;
	player.set_st(st);
	ui_functions renderer(std::move(player));
	int last_owner = -1;
	renderer.player_color_override = [&](int owner) {
		last_owner = owner;
		// Like the web viewer's forced-color callback, this requires a player slot.
		return st.players.at(owner).color;
	};
	try {
		for (int owner : {12, 255, -1}) {
			assert(renderer.player_color_index(owner) == st.players[11].color);
			assert(last_owner == 11);
		}
		for (int owner = 0; owner != 12; ++owner) {
			assert(renderer.player_color_index(owner) == st.players[owner].color);
			assert(last_owner == owner);
		}
		renderer.player_color_override = [&](int owner) {
			return owner == 1 ? 0 : owner == 3 ? 1 : st.players.at(owner).color;
		};
		assert(renderer.player_color_index(1) == 0);
		assert(renderer.player_color_index(3) == 1);
		assert(renderer.player_color_index(12) == st.players[11].color);
		renderer.player_color_override = nullptr;
		for (int owner : {12, 255, -1}) assert(renderer.player_color_index(owner) == st.players[11].color);
		for (int owner = 0; owner != 12; ++owner) assert(renderer.player_color_index(owner) == st.players[owner].color);
	} catch (const std::exception& error) {
		std::cerr << "Sprite color regression: " << error.what() << '\n';
		return 1;
	}
	std::cout << "Sprite color owners and overrides passed\n";
}
