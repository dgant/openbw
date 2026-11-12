#include <cassert>
#include <iostream>
#include "replay.h"

struct observed_replay : bwgame::replay_functions {
	using replay_functions::replay_functions;
	int attacks = 0;
	void play_sound(int, bwgame::xy, const bwgame::unit_t*, bool) override {}
	void notify_player_under_attack(bwgame::unit_t*) override { ++attacks; }
};

int main(int argc, char** argv) {
	if (argc != 3) return 2;
	bwgame::game_player player{bwgame::data_loading::data_files_directory(argv[1])};
	bwgame::action_state actions;
	bwgame::replay_state replay;
	observed_replay simulation(player.st(), actions, replay);
	simulation.load_replay_file(argv[2]);
	for (int frame : {0, 1000, 5000}) {
		while (player.st().current_frame < frame) simulation.next_frame();
		std::cout << frame << ':' << player.st().lcg_rand_state << '\n';
		for (auto& list : player.st().player_units) {
			for (auto* unit : bwgame::ptr(list)) {
				std::cout << unit->index << ',' << unit->unit_id_generation << ',' << int(unit->unit_type->id)
					<< ',' << unit->owner << ',' << unit->position.x << ',' << unit->position.y
					<< ',' << unit->hp.raw_value << ',' << unit->shield_points.raw_value << '\n';
			}
		}
	}
	// Damage must reach the same viewer notification hook in both engines.
	bwgame::unit_t* target = nullptr;
	bwgame::unit_t* attacker = nullptr;
	for (auto& list : player.st().player_units) {
		for (auto* unit : bwgame::ptr(list)) {
			if (unit->owner >= 8 || simulation.ut_turret(unit)) continue;
			if (!target && unit->hp > bwgame::fp8::integer(10)) target = unit;
			if (target && unit->owner != target->owner) attacker = unit;
		}
	}
	assert(target && attacker);
	int before = simulation.attacks;
	simulation.unit_deal_damage(target, bwgame::fp8::integer(1), attacker, attacker->owner);
	assert(simulation.attacks == before + 1);
	auto checkpoint = bwgame::copy_state(player.st());
	auto& game = *player.st().game;
	player.st() = bwgame::state();
	game = bwgame::game_state();
	player.st().global = &simulation.global_st;
	player.st().game = &game;
	actions = bwgame::action_state();
	replay = bwgame::replay_state();
	simulation.load_replay_file(argv[2]);
	assert(player.st().current_frame == 0);
}
