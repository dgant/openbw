#include <fstream>
#include <iostream>
#include <sstream>
#include <set>
#include "replay.h"
#include "remastered-contracts.h"

struct test_replay : bwgame::replay_functions {
	using replay_functions::replay_functions;
	int action_count = 0;
	void on_action(int, int) override { ++action_count; }
	void play_sound(int, bwgame::xy, const bwgame::unit_t*, bool) override {}
};

static std::string state_at(bwgame::replay_functions& simulation) {
	std::ostringstream output;
	auto& st = simulation.st;
	output << st.current_frame << ',' << st.lcg_rand_state << ',' << st.active_bullets_size << ';';
	for (size_t owner = 0; owner != st.players.size(); ++owner) {
		output << int(st.players[owner].controller) << ',' << st.current_minerals[owner] << ',' << st.current_gas[owner]
			<< ',' << st.total_minerals_gathered[owner] << ',' << st.total_gas_gathered[owner] << ';';
		for (auto level : st.upgrade_levels[owner]) output << level << ',';
		for (auto researched : st.tech_researched[owner]) output << researched << ',';
	}
	for (auto& list : simulation.st.player_units) {
		for (auto* u : bwgame::ptr(list)) {
			output << u->index << ',' << u->unit_id_generation << ',' << int(u->unit_type->id)
				<< ',' << u->owner << ',' << u->position.x << ',' << u->position.y
				<< ',' << u->hp.raw_value << ',' << u->shield_points.raw_value << ',' << u->energy.raw_value
				<< ',' << int(u->order_type->id) << ',' << u->order_state << ',' << u->main_order_timer
				<< ',' << u->order_target.pos.x << ',' << u->order_target.pos.y
				<< ',' << (u->order_target.unit ? simulation.get_unit_id(u->order_target.unit).raw_value : 0)
				<< ',' << u->ground_weapon_cooldown << ',' << u->air_weapon_cooldown << ',' << u->status_flags << ';';
		}
	}
	return output.str();
}

int main(int argc, char** argv) {
	if (argc != 4 && argc != 5) return 2;
	try {
		auto data = bwgame::data_loading::data_files_directory(argv[1]);
		data.mpqs.emplace_front(argv[3]);
		bwgame::game_player player(data);
		bwgame::action_state actions;
		bwgame::replay_state replay;
		test_replay simulation(player.st(), actions, replay);
		if (argc == 5 && std::string(argv[4]) == "--file") simulation.load_replay_file(argv[2]);
		else {
			std::ifstream input(argv[2], std::ios::binary);
			std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
			if (argc == 5 && std::string(argv[4]) == "--contracts") {
				check_remastered_contracts(simulation, bytes);
				std::cout << "{\"contracts\":true}\n";
				return 0;
			}
			simulation.load_replay_data(bytes.data(), bytes.size());
		}
		std::cout << "{\"frames\":" << replay.end_frame << ",\"gameType\":" << replay.game_type
			<< ",\"tileset\":" << simulation.game_st.tileset_index << ",\"races\":[";
		for (size_t owner = 0; owner != player.st().players.size(); ++owner) {
			if (owner) std::cout << ',';
			const auto& participant = player.st().players[owner];
			std::cout << (participant.controller == bwgame::player_t::controller_occupied ? int(participant.race) : -1);
		}
		std::cout << "],\"snapshots\":{";
		bwgame::optional<bwgame::state> checkpoint;
		bwgame::action_state checkpoint_actions;
		const int checkpoint_frame = replay.end_frame / 2;
		std::set<int> frames = {1000, 2233, 5000, 14035, checkpoint_frame};
		bool first = true;
		for (int frame : frames) {
			if (frame > replay.end_frame) continue;
			while (player.st().current_frame < frame) simulation.next_frame();
			if (frame == checkpoint_frame) {
				checkpoint.emplace(bwgame::copy_state(player.st()));
				checkpoint_actions = bwgame::copy_state(actions, player.st(), *checkpoint);
			}
			if (!first) std::cout << ',';
			first = false;
			std::cout << '"' << frame << "\":[";
			bool first_unit = true;
			for (int owner : {0, 1}) {
				for (auto* unit : bwgame::ptr(player.st().player_units[owner])) {
					if (simulation.u_loaded(unit) || simulation.ut_turret(unit)) continue;
					if (!first_unit) std::cout << ',';
					first_unit = false;
					std::cout << '[' << unit->index << ',' << unit->unit_id_generation << ','
						<< int(unit->unit_type->id) << ',' << owner << ','
						<< unit->sprite->position.x << ',' << unit->sprite->position.y << ']';
				}
			}
			std::cout << ']';
		}
		while (!simulation.is_done()) simulation.next_frame();
		const auto forward_state = state_at(simulation);
		std::cout << "},\"completed\":true";
		if (checkpoint) {
			player.st() = bwgame::copy_state(*checkpoint);
			actions = bwgame::copy_state(checkpoint_actions, *checkpoint, player.st());
			while (!simulation.is_done()) simulation.next_frame();
			if (state_at(simulation) != forward_state) throw std::runtime_error("Rewind changed simulation state");
			std::cout << ",\"rewind\":true";
		}
		std::cout << "}\n";
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
