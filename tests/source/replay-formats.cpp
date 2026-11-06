#include <iostream>
#include "replay.h"
#include <cassert>

using namespace bwgame;

struct silent_replay : replay_functions {
	using replay_functions::replay_functions;
	void play_sound(int, xy, const unit_t*, bool) override {}
};

int main(int argc, char** argv) {
	assert(argc > 2);
	auto data = data_loading::data_files_directory(argv[1]);
	if (std::getenv("OPENBW_TERRAIN_MPQ")) data.mpqs.emplace_front(std::getenv("OPENBW_TERRAIN_MPQ"));
	game_player player([&](a_vector<uint8_t>& bytes, a_string name) { data(bytes, name); });
	action_state actions;
	replay_state replay;
	silent_replay funcs(player.st(), actions, replay);
	for (int n = 2; n != argc; ++n) {
		// Match ui_t::reset while retaining the already loaded MPQ data.
		auto* global = player.st().global;
		auto* game = player.st().game;
		player.st() = state();
		*game = game_state();
		player.st().global = global;
		player.st().game = game;
		funcs.load_replay_file(argv[n]);
		assert(player.st().current_frame == 0);
		bool remastered = std::string(argv[n]).find("remastered-") != std::string::npos;
		const auto& rules = player.st().replay_rules;
		assert(rules.remastered == remastered);
		assert(player.st().units_container.max_size == (remastered ? 3400 : 1700));
		assert(player.st().bullets_container.max_size == (remastered ? 400 : 100));
		assert(rules.order_allocation_fix() == remastered);
		for (const auto& unit : player.st().visible_units) {
			assert(funcs.get_unit(funcs.get_unit_id_32(&unit)) == &unit);
			assert(funcs.get_unit(funcs.get_unit_id(&unit)) == &unit);
		}
		if (replay.map_name == "Octagon SE 2.0") {
			bool found = false;
			for (const auto& unit : player.st().visible_units) {
				if (unit.owner == 11 && funcs.unit_is_egg(&unit) && unit.sprite->position == xy(1136, 496)) found = true;
			}
			assert(found);
		}
		std::cout << argv[n] << ": " << replay.map_name << ", " << replay.end_frame << " frames" << std::endl;
		for (int frame = 0; frame != 2400; ++frame) funcs.next_frame();
		auto snapshot = copy_state(player.st());
		assert(snapshot.replay_rules.limits == rules.limits);
		assert(snapshot.replay_rules.bug_fixes == rules.bug_fixes);
		assert(snapshot.units_container.max_size == player.st().units_container.max_size);
		auto action_snapshot = copy_state(actions, player.st(), snapshot);
		for (int frame = 0; frame != 240; ++frame) funcs.next_frame();
		auto minerals = player.st().current_minerals;
		auto gas = player.st().current_gas;
		auto rng = player.st().lcg_rand_state;
		player.st() = std::move(snapshot);
		actions = std::move(action_snapshot);
		for (int frame = 0; frame != 240; ++frame) funcs.next_frame();
		assert(player.st().current_minerals == minerals);
		assert(player.st().current_gas == gas);
		assert(player.st().lcg_rand_state == rng);
		while (!funcs.is_done()) funcs.next_frame();
		std::cout << "Completed and replayed snapshot deterministically" << std::endl;
	}
}
