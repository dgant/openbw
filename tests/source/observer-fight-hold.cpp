#include <cassert>
#define main viewer_main
#include "ui/gfxtest.cpp"
#undef main
#include "ui/observer_camera_v3.h"

bool any_replay_loaded = false;

int main(int argc, char** argv) {
	if (argc != 3) return 2;
	main_t viewer{game_player{data_loading::data_files_directory(argv[1])}};
	viewer.ui.load_replay_file(argv[2]);
	unit_t* inside = nullptr;
	unit_t* outside = nullptr;
	for (auto& list : viewer.ui.st.player_units) {
		for (auto* unit : ptr(list)) {
			if (unit->owner >= 8 || !viewer.ui.ut_worker(unit)) continue;
			if (!inside) inside = unit;
			else if (unit->unit_type == inside->unit_type) outside = unit;
		}
	}
	assert(inside && outside);
	viewer.ui.screen_pos = {0, 0};
	viewer.ui.view_width = 640;
	viewer.ui.view_height = 480;
	inside->sprite->position = {300, 200};
	outside->sprite->position = {1500, 1500};
	viewer.ui.st.current_frame = 0;
	// Put the offscreen unit first to exercise equal-score tie handling.
	a_vector<unit_t*> units{outside, inside};
	xy pan;
	double pan_score = 0, viewport_score = 0;
	auto now = std::chrono::steady_clock::now();
	assert(viewer.observer_v3_try_jump_to_interest(units, now, pan, pan_score, viewport_score, false, true) == 0);
	assert(viewer.ui.screen_pos == xy(0, 0));
	assert(viewer.observer_v3_try_jump_to_interest(units, now, pan, pan_score, viewport_score, false, false) == 2);
	assert(viewer.ui.screen_pos != xy(0, 0));
	// A stronger offscreen fight must override the hold, including live combat.
	for (bool live : {false, true}) {
		viewer.ui.screen_pos = {0, 0};
		viewer.observer_v3_jump_cooldown_until = std::chrono::steady_clock::time_point::min();
		outside->ground_weapon_cooldown = 1;
		assert(viewer.observer_v3_try_jump_to_interest(units, now, pan, pan_score, viewport_score, live, !live) == 2);
		assert(viewer.ui.screen_pos != xy(0, 0));
	}
	// Long replay distances must not overflow the snapshot eviction score.
	g_m = &viewer;
	for (int i = 0; i <= 96; ++i) viewer.saved_states[i * 100000] = std::make_unique<saved_state>();
	viewer.trim_saved_states();
	assert(viewer.saved_states.size() == max_saved_states);
	assert(viewer.saved_states.count(0) && viewer.saved_states.count(9600000));
	assert(!viewer.saved_states.count(4800000));
	g_m = nullptr;
}
