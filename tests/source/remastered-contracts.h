#include <cassert>

template<typename simulation_T>
static void check_remastered_contracts(simulation_T& simulation, const std::vector<uint8_t>& bytes) {
	using namespace bwgame;
	const uint8_t empty_block[] = {0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0};
	remastered_replay::reader empty_input(empty_block, empty_block + sizeof(empty_block));
	assert(remastered_replay::block(empty_input, 0).empty());
	assert(empty_input.ptr == empty_input.end);
	const uint8_t following_section[] = {0xec, 0xdb, 0x59, 0xf7, 1, 0, 0, 0, 4, 0, 0, 0, 0x86, 0xae, 2, 0};
	remastered_replay::reader omitted_input(following_section, following_section + sizeof(following_section));
	assert(remastered_replay::block(omitted_input, 0).empty());
	assert(omitted_input.ptr == following_section);
	assert(remastered_replay::number(omitted_input) == 175750);

	auto reset = [&]() {
		auto& game = *simulation.st.game;
		simulation.st = state();
		game = game_state();
		simulation.replay_st = replay_state();
		simulation.action_st = action_state();
		simulation.st.global = &simulation.global_st;
		simulation.st.game = &game;
	};
	auto decoded = remastered_replay::decode(bytes.data(), bytes.size());
	std::vector<uint8_t> exported;
	simulation.load_replay(decoded, true, &exported);
	assert(exported == decoded.map);
	assert(simulation.st.units_container.max_size == decoded.limits[3]);
	assert(simulation.st.sprites_container.max_size == decoded.limits[1]);
	for (uint8_t observer : {128, 129, 130}) {
		std::array<uint8_t, 83> chat{{observer, 92}};
		data_loading::data_reader_le reader(chat.data(), chat.data() + chat.size());
		int callbacks = simulation.action_count;
		assert(simulation.read_action(reader));
		assert(reader.ptr == reader.end);
		assert(simulation.action_count == callbacks);
	}

	unit_t* unit = nullptr;
	for (auto* candidate : ptr(simulation.st.player_units[0])) {
		if (!simulation.us_hidden(candidate)) { unit = candidate; break; }
	}
	assert(unit);
	unit->unit_id_generation = 0x12345;
	auto id = simulation.get_unit_id_32(unit);
	assert(simulation.get_unit(id) == unit);
	assert(simulation.get_unit(simulation.get_unit_id(unit)) == unit);
	assert(simulation.get_unit(unit_id_32(id.raw_value ^ 0x10000)) == nullptr);
	assert(simulation.get_unit(unit_id_32((1u << simulation.unit_index_bits()) - 1)) == nullptr);

	std::array<uint8_t, 6> selection{{99, 1}};
	data_loading::set_value_at<true>(selection.data() + 2, id.raw_value);
	assert(simulation.read_action(0, selection.data(), selection.size()));
	assert(simulation.action_st.selection[0].front() == unit);
	selection[0] = 101;
	assert(simulation.read_action(0, selection.data(), selection.size()));
	assert(simulation.action_st.selection[0].empty());
	selection[0] = 100;
	assert(simulation.read_action(0, selection.data(), selection.size()));
	selection[0] = 99;
	data_loading::set_value_at<true>(selection.data() + 2, id.raw_value ^ 0x10000);
	simulation.read_action(0, selection.data(), selection.size());
	assert(simulation.action_st.selection[0].empty());

	for (int opcode : {96, 97, 98}) {
		std::vector<uint8_t> command(opcode == 96 ? 12 : opcode == 97 ? 13 : 5);
		command[0] = opcode;
		data_loading::set_value_at<true>(command.data() + (opcode == 98 ? 1 : 5), id.raw_value);
		if (opcode != 98) data_loading::set_value_at<true, uint16_t>(command.data() + 9, (uint16_t)UnitTypes::None);
		if (opcode == 97) command[11] = (uint8_t)Orders::Move;
		data_loading::data_reader_le reader(command.data(), command.data() + command.size());
		simulation.read_action(0, reader);
		assert(reader.ptr == reader.end);
	}

	// An engine's ID layout is state-local, including after snapshot restoration.
	state other;
	other.global = simulation.st.global;
	other.game = simulation.st.game;
	state_functions other_functions(other);
	auto* other_unit = other.units_container.get(42);
	other_unit->order_type = unit->order_type;
	other_unit->unit_id_generation = 0x12345;
	assert(other_functions.unit_index_bits() == 11);
	assert(other_functions.get_unit(other_functions.get_unit_id_32(other_unit)) == other_unit);
	assert(simulation.get_unit(id) == unit);
	auto restored = copy_state(simulation.st);
	state_functions restored_functions(restored);
	assert(restored.units_container.max_size == decoded.limits[3]);
	assert(restored_functions.get_unit(id)->index == unit->index);

	// STRx offsets must remain 32-bit; the map must not be rewritten as STR.
	auto append_u32 = [](a_vector<uint8_t>& out, uint32_t value) {
		size_t offset = out.size();
		out.resize(offset + 4);
		data_loading::set_value_at<true>(out.data() + offset, value);
	};
	a_vector<uint8_t> strings(70000, 0);
	data_loading::set_value_at<true, uint32_t>(strings.data(), 1);
	data_loading::set_value_at<true, uint32_t>(strings.data() + 4, strings.size());
	const char text[] = "extended map string";
	strings.insert(strings.end(), text, text + sizeof(text));
	append_u32(decoded.map, 0x78525453);
	append_u32(decoded.map, strings.size());
	decoded.map.insert(decoded.map.end(), strings.begin(), strings.end());
	reset();
	simulation.load_replay(decoded, true, &exported);
	assert(exported == decoded.map);
	assert(simulation.st.game->map_strings[0] == text);

	// Reload through the same full-state reset used by the shared viewer.
	decoded.limits = {{5000, 2500, 0, 1700, 100, 2000, 0}};
	reset();
	simulation.load_replay(decoded);
	assert(simulation.st.units_container.max_size == 1700);
	assert(simulation.st.sprites_container.max_size == 2500);
	assert(simulation.unit_index_bits() == 11);
}
