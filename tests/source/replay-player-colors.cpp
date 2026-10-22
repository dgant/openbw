#define main openbw_demo_main
#include "ui/gfxtest.cpp"
#undef main
#include <cassert>

int main() {
	global_state global;
	game_state game;
	state st;
	st.global = &global;
	st.game = &game;
	for (int owner = 0; owner != 12; ++owner) {
		st.players[owner].controller = player_t::controller_open;
		st.players[owner].color = (owner + 4) % 12;
	}
	st.players[1].controller = player_t::controller_occupied;
	st.players[5].controller = player_t::controller_occupied;
	game_player player;
	player.set_st(st);
	main_t viewer(std::move(player));
	viewer.capture_replay_players();
	viewer.force_red_blue_player_colors = true;
	assert(viewer.display_player_color(1) == 0);
	assert(viewer.display_player_color(5) == 1);
	st.players[5].controller = player_t::controller_user_left;
	assert(viewer.display_player_color(1) == 0);
	assert(viewer.display_player_color(5) == 1);
	st.players[1].controller = player_t::controller_user_left;
	assert(viewer.display_player_color(1) == 0);
	assert(viewer.display_player_color(5) == 1);
	viewer.force_red_blue_player_colors = false;
	assert(viewer.display_player_color(1) == st.players[1].color);
	assert(viewer.display_player_color(5) == st.players[5].color);
	viewer.force_red_blue_player_colors = true;
	assert(viewer.display_player_color(11) == st.players[11].color);
	// Loading another replay replaces the roster, including noncontiguous slots.
	st.players[2].controller = player_t::controller_occupied;
	st.players[7].controller = player_t::controller_occupied;
	viewer.capture_replay_players();
	assert(viewer.display_player_color(2) == 0);
	assert(viewer.display_player_color(7) == 1);
	assert(viewer.display_player_color(1) == st.players[1].color);
	// A three-player replay must not become a two-player replay after a defeat.
	st.players[3].controller = player_t::controller_occupied;
	viewer.capture_replay_players();
	st.players[3].controller = player_t::controller_user_left;
	assert(viewer.display_player_color(2) == st.players[2].color);
	assert(viewer.display_player_color(7) == st.players[7].color);
	std::cout << "Replay colors survive player elimination\n";
}
