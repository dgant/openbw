#include <iostream>
#include "replay.h"

using namespace bwgame;

struct consistency_replay : replay_functions {
	using replay_functions::replay_functions;
	int checked_commands = 0;
	int inconsistent_commands = 0;
	int first_inconsistent_frame = -1;
	bool verbose = false;
	int trace_from = -1;
	int trace_to = -1;

	void play_sound(int, xy, const unit_t*, bool) override {}
	unsigned index_bits() const {
#ifdef REFERENCE_ENGINE
		return 16 - unit_id::unit_generation_size;
#else
		return st.replay_rules.unit_index_bits();
#endif
	}
	bool tracing() const { return st.current_frame >= trace_from && st.current_frame <= trace_to; }

	void describe_selection(int owner) {
		for (auto* unit : selected_units(owner)) {
			std::cout << " [" << unit->index + 1 << ':' << (int)unit->unit_type->id
				<< " gen=" << unit->unit_id_generation << " owner=" << unit->owner
				<< " at=" << unit->position.x << ',' << unit->position.y
				<< " order=" << (int)unit->order_type->id << ']';
		}
	}

	void check_selection(int owner, data_loading::data_reader_le r) {
		int command = r.get<uint8_t>();
		if (command != 9 && command != 10 && command != 0x63 && command != 0x64) return;
		bool wide = command >= 0x63;
		int count = r.get<uint8_t>();
		bool inconsistent = false;
		++checked_commands;
		for (int i = 0; i != count; ++i) {
			uint32_t tag = wide ? r.get<uint32_t>() : r.get<uint16_t>();
			if (!tag) continue;
#ifdef REFERENCE_ENGINE
			auto* unit = get_unit(unit_id(tag));
#else
			auto* unit = wide ? get_unit(unit_id_32(tag)) : get_unit(unit_id(tag));
#endif
			bool bad = !unit || (count > 1 && unit->owner != owner);
			if (bad && (inconsistent_commands < 30 || verbose)) {
				auto* slot = st.units_container.try_get((tag & ((1u << index_bits()) - 1)) - 1);
				std::cout << "Mismatch frame=" << st.current_frame << " player=" << owner
					<< " command=" << command << " tag=" << tag << " count=" << count;
				if (slot && slot->unit_type) {
					std::cout << " actual_type=" << (int)slot->unit_type->id << " actual_owner=" << slot->owner
						<< " actual_generation=" << slot->unit_id_generation << " dead=" << unit_dead(slot);
				}
				std::cout << std::endl;
			}
			inconsistent = inconsistent || bad;
		}
		if (inconsistent) {
			if (first_inconsistent_frame < 0) first_inconsistent_frame = st.current_frame;
			++inconsistent_commands;
		}
	}

	void next_checked_frame() {
		// Read each command at its execution boundary, then use the real decoder.
		auto* begin = replay_st.actions_data_buffer.data();
		auto* end = begin + replay_st.actions_data_buffer.size();
		if (st.current_frame == action_st.next_action_frame) {
			while (action_st.actions_data_position != size_t(end - begin)) {
				data_loading::data_reader_le block(begin + action_st.actions_data_position, end);
				int frame = block.get<int32_t>();
				if (frame != st.current_frame) {
					action_st.next_action_frame = frame;
					break;
				}
				size_t size = block.get<uint8_t>();
				const uint8_t* commands = block.get_n(size);
				data_loading::data_reader_le r(commands, commands + size);
				while (r.left()) {
					int player_id = r.get<uint8_t>();
					auto player = std::find(action_st.player_id.begin(), action_st.player_id.end(), player_id);
					if (player == action_st.player_id.end()) error("unknown replay player %d", player_id);
					int owner = int(player - action_st.player_id.begin());
					auto before = r;
					check_selection(owner, r);
					bool accepted = read_action(owner, r);
					if (tracing()) {
						int command = before.get<uint8_t>();
						std::cout << "Action frame=" << st.current_frame << " player=" << owner
							<< " id=" << command << " accepted=" << accepted << " minerals=" << st.current_minerals[owner]
							<< " gas=" << st.current_gas[owner] << " data=";
						while (before.ptr < r.ptr) std::cout << std::hex << int(before.get<uint8_t>()) << ',';
						std::cout << std::dec;
						describe_selection(owner);
						std::cout << std::endl;
					}
				}
				action_st.actions_data_position = block.ptr - begin;
			}
		}
		state_functions::next_frame();
	}
};

int main(int argc, char** argv) {
	if (argc < 3) return 2;
	std::string directory = argv[1];
	bool raw = directory.compare(0, 4, "raw:") == 0;
	data_loading::data_files_loader<> mpqs;
	if (!raw) mpqs = data_loading::data_files_directory(directory.c_str());
	if (!raw && std::getenv("OPENBW_TERRAIN_MPQ")) mpqs.mpqs.emplace_front(std::getenv("OPENBW_TERRAIN_MPQ"));
	game_player player([&](a_vector<uint8_t>& bytes, a_string name) {
		if (!raw) { mpqs(bytes, name); return; }
		for (auto& c : name) c = c == '\\' ? '/' : std::tolower((unsigned char)c);
		data_loading::file_reader<> file((directory.substr(4) + "/" + name.c_str()).c_str());
		bytes.resize(file.size());
		file.get_bytes(bytes.data(), bytes.size());
	});
	action_state actions;
	replay_state replay;
	consistency_replay funcs(player.st(), actions, replay);
	if (argc > 4) {
		funcs.trace_from = std::atoi(argv[3]);
		funcs.trace_to = std::atoi(argv[4]);
	}
	funcs.load_replay_file(argv[2]);
	std::cout << "Replay " << replay.map_name << " frames=" << replay.end_frame << std::endl;
	for (int i = 0; i != 12; ++i) {
		if (player.st().players[i].controller == player_t::controller_occupied)
			std::cout << "Player " << i << ": " << replay.player_name[i] << std::endl;
	}
	while (!funcs.is_done()) {
		funcs.next_checked_frame();
		int frame = player.st().current_frame;
		if (frame == 1000 || frame == 2233 || frame == 5000 || frame == 14035) {
			for (int owner = 0; owner != 2; ++owner) {
				std::cout << "State frame=" << frame << " player=" << owner
					<< " minerals=" << player.st().current_minerals[owner]
					<< " gas=" << player.st().current_gas[owner] << std::endl;
			}
			for (size_t index = 0; index != player.st().units_container.max_size; ++index) {
				auto* u = player.st().units_container.try_get(index);
				if (!u || !u->sprite || !u->unit_type || u->owner >= 2 || funcs.unit_dead(u) || funcs.u_loaded(u) || funcs.ut_turret(u)) continue;
				std::cout << "Unit " << frame << ' ' << index << ' ' << u->unit_id_generation
					<< ' ' << (int)u->unit_type->id << ' ' << u->owner
					<< ' ' << u->position.x << ' ' << u->position.y << std::endl;
			}
		}
	}
	std::cout << "Checked " << funcs.checked_commands << " selection commands, inconsistent="
		<< funcs.inconsistent_commands << ", first_frame=" << funcs.first_inconsistent_frame << std::endl;
	return 0;
}
