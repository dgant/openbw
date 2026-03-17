
#ifdef EMSCRIPTEN
#include <emscripten.h>
#endif

#include <iostream>
#include "ui.h"
#include "common.h"
#include "bwgame.h"
#include "replay.h"

#include <chrono>
#include <unordered_map>
#include <thread>

using namespace bwgame;

using ui::log;

FILE* log_file = nullptr;

namespace bwgame {

namespace ui {

void log_str(a_string str) {
	fwrite(str.data(), str.size(), 1, stdout);
	fflush(stdout);
	if (!log_file) log_file = fopen("log.txt", "wb");
	if (log_file) {
		fwrite(str.data(), str.size(), 1, log_file);
		fflush(log_file);
	}
}

void fatal_error_str(a_string str) {
#ifdef EMSCRIPTEN
	const char* p = str.c_str();
	EM_ASM_({js_fatal_error($0);}, p);
#endif
	log("fatal error: %s\n", str);
	std::terminate();
}

}

}

struct saved_state {
	state st;
	action_state action_st;
	std::array<apm_t, 12> apm;
};

extern bool any_replay_loaded;

struct main_t {
	ui_functions ui;
	bool auto_observer_enabled = true;
	bool observer_initialized = false;
	int observer_camera_move_time = 150;
	int observer_camera_move_time_min = 50;
	int observer_watch_scout_worker_until = 7500;
	int observer_last_moved = 0;
	int observer_last_moved_priority = 0;
	int observer_last_frame_seen = -1;
	xy observer_last_moved_position;
	xy observer_current_camera_position;
	xy observer_focus_position;
	unit_id_32 observer_focus_unit_id;
	bool observer_follow_unit = false;
	std::unordered_map<int, int> observer_unit_health;

	main_t(game_player player) : ui(std::move(player)) {}

	std::chrono::high_resolution_clock clock;
	std::chrono::high_resolution_clock::time_point last_tick;

	std::chrono::high_resolution_clock::time_point last_fps;
	int fps_counter = 0;

	a_map<int, std::unique_ptr<saved_state>> saved_states;

	void reset() {
		saved_states.clear();
		ui.reset();
		auto_observer_enabled = true;
		observer_initialized = false;
		observer_last_moved = 0;
		observer_last_moved_priority = 0;
		observer_last_frame_seen = -1;
		observer_last_moved_position = {};
		observer_current_camera_position = {};
		observer_focus_position = {};
		observer_focus_unit_id = {};
		observer_follow_unit = false;
		observer_unit_health.clear();
	}

	void clamp_screen_pos() {
		if (ui.screen_pos.y + (int)ui.view_height > ui.game_st.map_height) ui.screen_pos.y = ui.game_st.map_height - ui.view_height;
		if (ui.screen_pos.y < 0) ui.screen_pos.y = 0;
		if (ui.screen_pos.x + (int)ui.view_width > ui.game_st.map_width) ui.screen_pos.x = ui.game_st.map_width - ui.view_width;
		if (ui.screen_pos.x < 0) ui.screen_pos.x = 0;
	}

	bool is_occupied_player(int owner) const {
		return owner >= 0 && owner < 12 && ui.st.players[owner].controller == player_t::controller_occupied;
	}

	xy observer_player_start_location(int owner) const {
		if (!is_occupied_player(owner)) return {};
		return ui.game_st.start_locations[owner];
	}

	bool observer_has_start_location(int owner) const {
		xy start = observer_player_start_location(owner);
		return start != xy();
	}

	void initialize_observer_camera() {
		if (observer_initialized) return;
		observer_initialized = true;
		observer_follow_unit = false;
		observer_focus_unit_id = {};
		observer_current_camera_position = ui.screen_pos + xy((int)ui.view_width / 2, (int)ui.view_height / 2);
		observer_focus_position = observer_current_camera_position;
		for (int owner = 0; owner != 12; ++owner) {
			if (!observer_has_start_location(owner)) continue;
			observer_current_camera_position = observer_player_start_location(owner);
			observer_focus_position = observer_current_camera_position;
			break;
		}
	}

	bool is_near_own_start_location(xy pos, int owner) const {
		if (!observer_has_start_location(owner)) return false;
		return ui.xy_length(observer_player_start_location(owner) - pos) <= 10 * 32;
	}

	bool is_near_enemy_start_location(xy pos, int owner) const {
		for (int other = 0; other != 12; ++other) {
			if (!observer_has_start_location(other) || other == owner) continue;
			if (ui.xy_length(observer_player_start_location(other) - pos) <= 1000) return true;
		}
		return false;
	}

	bool is_army_unit(unit_t* unit) const {
		if (!unit) return false;
		return !(ui.ut_worker(unit) ||
			ui.ut_building(unit) ||
			ui.unit_is(unit, UnitTypes::Terran_Vulture_Spider_Mine) ||
			ui.unit_is(unit, UnitTypes::Zerg_Overlord) ||
			ui.unit_is(unit, UnitTypes::Zerg_Larva));
	}

	bool should_move_camera(int priority) const {
		bool is_time_to_move = ui.st.current_frame - observer_last_moved >= observer_camera_move_time;
		bool is_time_to_move_if_higher_prio = ui.st.current_frame - observer_last_moved >= observer_camera_move_time_min;
		bool is_higher_prio = observer_last_moved_priority < priority;
		return is_time_to_move || (is_higher_prio && is_time_to_move_if_higher_prio);
	}

	bool unit_is_attacking(unit_t* unit) const {
		if (!unit || !unit->sprite || !unit->order_type) return false;
		if (unit->order_target.unit && ui.unit_target_is_enemy(unit, unit->order_target.unit)) {
			switch (unit->order_type->id) {
			case Orders::AttackUnit:
			case Orders::AttackMove:
			case Orders::CarrierAttack:
			case Orders::ReaverAttack:
			case Orders::TurretAttack:
			case Orders::AttackFixedRange:
				return true;
			default:
				break;
			}
		}
		return unit->ground_weapon_cooldown != 0 || unit->air_weapon_cooldown != 0;
	}

	int unit_total_health(unit_t* unit) const {
		int total = unit->hp.ceil().integer_part();
		if (unit->unit_type->has_shield) total += unit->shield_points.ceil().integer_part();
		return total;
	}

	bool unit_is_under_attack(unit_t* unit) {
		if (!unit || !unit->sprite) return false;
		int unit_key = (int)ui.get_unit_id_32(unit).raw_value;
		int current_health = unit_total_health(unit);
		auto it = observer_unit_health.find(unit_key);
		bool damaged = it != observer_unit_health.end() && current_health < it->second;
		observer_unit_health[unit_key] = current_health;
		if (damaged) return true;

		for (unit_t* other : ptr(ui.st.visible_units)) {
			if (!other || !other->sprite || other->owner == unit->owner) continue;
			if (!is_occupied_player(other->owner)) continue;
			if (!unit_is_attacking(other)) continue;
			if (other->order_target.unit == unit || other->auto_target_unit == unit) return true;
		}
		for (unit_t* other : ptr(ui.st.hidden_units)) {
			if (!other || !other->sprite || other->owner == unit->owner) continue;
			if (!is_occupied_player(other->owner)) continue;
			if (!unit_is_attacking(other)) continue;
			if (other->order_target.unit == unit || other->auto_target_unit == unit) return true;
		}
		return false;
	}

	bool unit_has_loaded_units(unit_t* unit) const {
		for (unit_t* loaded : ui.loaded_units(unit)) {
			if (loaded) return true;
		}
		return false;
	}

	void move_camera(xy pos, int priority) {
		if (!should_move_camera(priority)) return;
		if (!observer_follow_unit && observer_focus_position == pos) return;

		observer_focus_position = pos;
		observer_last_moved_position = observer_focus_position;
		observer_last_moved = ui.st.current_frame;
		observer_last_moved_priority = priority;
		observer_follow_unit = false;
		observer_focus_unit_id = {};
	}

	void move_camera(unit_t* unit, int priority) {
		if (!unit || !unit->sprite || !should_move_camera(priority)) return;
		unit_id_32 unit_id = ui.get_unit_id_32(unit);
		if (observer_follow_unit && observer_focus_unit_id == unit_id) return;

		observer_focus_unit_id = unit_id;
		observer_focus_position = unit->sprite->position;
		observer_last_moved_position = observer_focus_position;
		observer_last_moved = ui.st.current_frame;
		observer_last_moved_priority = priority;
		observer_follow_unit = true;
	}

	void move_camera_falling_nuke() {
		int prio = 5;
		if (!should_move_camera(prio)) return;

		for (unit_t* unit : ptr(ui.st.visible_units)) {
			if (!unit || !unit->sprite) continue;
			if (ui.unit_is(unit, UnitTypes::Terran_Nuclear_Missile) && unit->velocity.y > 0_fp8) {
				move_camera(unit, prio);
				return;
			}
		}
		for (unit_t* unit : ptr(ui.st.hidden_units)) {
			if (!unit || !unit->sprite) continue;
			if (ui.unit_is(unit, UnitTypes::Terran_Nuclear_Missile) && unit->velocity.y > 0_fp8) {
				move_camera(unit, prio);
				return;
			}
		}
	}

	void move_camera_is_under_attack() {
		int prio = 3;
		if (!should_move_camera(prio)) return;

		for (unit_t* unit : ptr(ui.st.visible_units)) {
			if (!unit || !unit->sprite || !is_occupied_player(unit->owner)) continue;
			if (unit_is_under_attack(unit)) move_camera(unit, prio);
		}
		for (unit_t* unit : ptr(ui.st.hidden_units)) {
			if (!unit || !unit->sprite || !is_occupied_player(unit->owner)) continue;
			if (unit_is_under_attack(unit)) move_camera(unit, prio);
		}
	}

	void move_camera_is_attacking() {
		int prio = 3;
		if (!should_move_camera(prio)) return;

		for (unit_t* unit : ptr(ui.st.visible_units)) {
			if (!unit || !unit->sprite || !is_occupied_player(unit->owner)) continue;
			if (unit_is_attacking(unit)) move_camera(unit, prio);
		}
		for (unit_t* unit : ptr(ui.st.hidden_units)) {
			if (!unit || !unit->sprite || !is_occupied_player(unit->owner)) continue;
			if (unit_is_attacking(unit)) move_camera(unit, prio);
		}
	}

	void move_camera_scout_worker() {
		int high_prio = 2;
		int low_prio = 0;
		if (!should_move_camera(low_prio)) return;

		for (unit_t* unit : ptr(ui.st.visible_units)) {
			if (!unit || !unit->sprite || !is_occupied_player(unit->owner) || !ui.ut_worker(unit)) continue;
			if (is_near_enemy_start_location(unit->sprite->position, unit->owner)) move_camera(unit, high_prio);
			else if (!is_near_own_start_location(unit->sprite->position, unit->owner)) move_camera(unit, low_prio);
		}
		for (unit_t* unit : ptr(ui.st.hidden_units)) {
			if (!unit || !unit->sprite || !is_occupied_player(unit->owner) || !ui.ut_worker(unit)) continue;
			if (is_near_enemy_start_location(unit->sprite->position, unit->owner)) move_camera(unit, high_prio);
			else if (!is_near_own_start_location(unit->sprite->position, unit->owner)) move_camera(unit, low_prio);
		}
	}

	void move_camera_drop() {
		int prio = 2;
		if (!should_move_camera(prio)) return;

		auto maybe_move_camera_drop = [&](unit_t* unit) {
			if (!unit || !unit->sprite || !is_occupied_player(unit->owner)) return;
			if (!(ui.unit_is(unit, UnitTypes::Zerg_Overlord) ||
				ui.unit_is(unit, UnitTypes::Terran_Dropship) ||
				ui.unit_is(unit, UnitTypes::Protoss_Shuttle))) return;
			if (!is_near_enemy_start_location(unit->sprite->position, unit->owner)) return;
			if (!unit_has_loaded_units(unit)) return;
			move_camera(unit, prio);
		};

		for (unit_t* unit : ptr(ui.st.visible_units)) maybe_move_camera_drop(unit);
		for (unit_t* unit : ptr(ui.st.hidden_units)) maybe_move_camera_drop(unit);
	}

	void move_camera_army() {
		int prio = 1;
		if (!should_move_camera(prio)) return;

		int radius = 50;
		unit_t* best_unit = nullptr;
		int most_units_nearby = 0;

		auto count_nearby = [&](unit_t* center) {
			int nearby = 0;
			auto count_in_list = [&](auto&& list) {
				for (unit_t* other : list) {
					if (!is_army_unit(other) || !other->sprite) continue;
					if (ui.xy_length(other->sprite->position - center->sprite->position) <= radius) ++nearby;
				}
			};
			count_in_list(ptr(ui.st.visible_units));
			count_in_list(ptr(ui.st.hidden_units));
			return nearby;
		};

		auto evaluate = [&](unit_t* unit) {
			if (!is_army_unit(unit) || !unit->sprite) return;
			int nearby = count_nearby(unit);
			if (nearby > most_units_nearby) {
				most_units_nearby = nearby;
				best_unit = unit;
			}
		};

		for (unit_t* unit : ptr(ui.st.visible_units)) evaluate(unit);
		for (unit_t* unit : ptr(ui.st.hidden_units)) evaluate(unit);

		if (most_units_nearby > 1) move_camera(best_unit, prio);
	}

	void update_camera_position() {
		double move_factor = 0.1;
		if (observer_follow_unit) {
			if (unit_t* focus_unit = ui.get_unit(observer_focus_unit_id)) {
				if (focus_unit->sprite) observer_focus_position = focus_unit->sprite->position;
			} else {
				observer_follow_unit = false;
				observer_focus_unit_id = {};
			}
		}

		observer_current_camera_position = observer_current_camera_position + xy(
			(int)(move_factor * (observer_focus_position.x - observer_current_camera_position.x)),
			(int)(move_factor * (observer_focus_position.y - observer_current_camera_position.y)));

		ui.screen_pos = observer_current_camera_position - xy((int)ui.view_width / 2, (int)ui.view_height / 2 - 40);
		clamp_screen_pos();
	}

	void update_observer_camera() {
		if (!auto_observer_enabled || !any_replay_loaded) return;
		if (observer_last_frame_seen != -1 && ui.st.current_frame < observer_last_frame_seen) {
			observer_initialized = false;
			observer_last_moved = 0;
			observer_last_moved_priority = 0;
			observer_follow_unit = false;
			observer_focus_unit_id = {};
			observer_unit_health.clear();
		}
		observer_last_frame_seen = ui.st.current_frame;

		initialize_observer_camera();
		move_camera_falling_nuke();
		move_camera_is_under_attack();
		move_camera_is_attacking();
		if (ui.st.current_frame <= observer_watch_scout_worker_until) move_camera_scout_worker();
		move_camera_army();
		move_camera_drop();
		update_camera_position();
	}

	void update() {
		auto now = clock.now();

		auto tick_speed = std::chrono::milliseconds((fp8::integer(42) / ui.game_speed).integer_part());

		if (now - last_fps >= std::chrono::seconds(1)) {
			//log("game fps: %g\n", fps_counter / std::chrono::duration_cast<std::chrono::duration<double, std::ratio<1, 1>>>(now - last_fps).count());
			last_fps = now;
			fps_counter = 0;
		}

		auto next = [&]() {
			int save_interval = 10 * 1000 / 42;
			if (ui.st.current_frame == 0 || ui.st.current_frame % save_interval == 0) {
				auto i = saved_states.find(ui.st.current_frame);
				if (i == saved_states.end()) {
					auto v = std::make_unique<saved_state>();
					v->st = copy_state(ui.st);
					v->action_st = copy_state(ui.action_st, ui.st, v->st);
					v->apm = ui.apm;

					a_map<int, std::unique_ptr<saved_state>> new_saved_states;
					new_saved_states[ui.st.current_frame] = std::move(v);
					while (!saved_states.empty()) {
						auto i = saved_states.begin();
						auto v = std::move(*i);
						saved_states.erase(i);
						new_saved_states[v.first] = std::move(v.second);
					}
					std::swap(saved_states, new_saved_states);
				}
			}
			ui.replay_functions::next_frame();
			for (auto& v : ui.apm) v.update(ui.st.current_frame);
		};

		if (!ui.is_done() || ui.st.current_frame != ui.replay_frame) {
			if (ui.st.current_frame != ui.replay_frame) {
				if (ui.st.current_frame != ui.replay_frame) {
					auto i = saved_states.lower_bound(ui.replay_frame);
					if (i != saved_states.begin()) --i;
					auto& v = i->second;
					if (ui.st.current_frame > ui.replay_frame || v->st.current_frame > ui.st.current_frame) {
						ui.st = copy_state(v->st);
						ui.action_st = copy_state(v->action_st, v->st, ui.st);
						ui.apm = v->apm;
					}
				}
				if (ui.st.current_frame < ui.replay_frame) {
					for (size_t i = 0; i != 32 && ui.st.current_frame != ui.replay_frame; ++i) {
						for (size_t i2 = 0; i2 != 4 && ui.st.current_frame != ui.replay_frame; ++i2) {
							next();
						}
						if (clock.now() - now >= std::chrono::milliseconds(50)) break;
					}
				}
				last_tick = now;
			} else {
				if (ui.is_paused) {
					last_tick = now;
				} else {
					auto tick_t = now - last_tick;
					if (tick_t >= tick_speed * 16) {
						last_tick = now - tick_speed * 16;
						tick_t = tick_speed * 16;
					}
					auto tick_n = tick_speed.count() == 0 ? 128 : tick_t / tick_speed;
					for (auto i = tick_n; i;) {
						--i;
						++fps_counter;
						last_tick += tick_speed;

						if (!ui.is_done()) next();
						else break;
						if (i % 4 == 3 && clock.now() - now >= std::chrono::milliseconds(50)) break;
					}
					ui.replay_frame = ui.st.current_frame;
				}
			}
		}

		ui.update();
		update_observer_camera();
	}
};

main_t* g_m = nullptr;

uint32_t freemem_rand_state = (uint32_t)std::chrono::high_resolution_clock::now().time_since_epoch().count();
auto freemem_rand() {
	freemem_rand_state = freemem_rand_state * 22695477 + 1;
	return (freemem_rand_state >> 16) & 0x7fff;
}

void out_of_memory() {
	printf("out of memory :(\n");
#ifdef EMSCRIPTEN
	const char* p = "out of memory :(";
	EM_ASM_({js_fatal_error($0);}, p);
#endif
	throw std::bad_alloc();
}

size_t bytes_allocated = 0;

void free_memory() {
	if (!g_m) out_of_memory();
	size_t n_states = g_m->saved_states.size();
	printf("n_states is %zu\n", n_states);
	if (n_states <= 2) out_of_memory();
	size_t n;
	if (n_states >= 300) n = 1 + freemem_rand() % (n_states - 2);
	else {
		auto begin = std::next(g_m->saved_states.begin());
		auto end = std::prev(g_m->saved_states.end());
		n = 1;
		int best_score = std::numeric_limits<int>::max();
		size_t i_n = 1;
		for (auto i = begin; i != end; ++i, ++i_n) {
			int score = 0;
			for (auto i2 = begin; i2 != end; ++i2) {
				if (i2 != i) {
					int d = i2->first - i->first;
					score += d*d;
				}
			}
			if (score < best_score) {
				best_score = score;
				n = i_n;
			}
		}
	}
	g_m->saved_states.erase(std::next(g_m->saved_states.begin(), n));
}

//extern "C" void set_malloc_fail_handler(bool(*)());

//bool malloc_fail_handler() {
//	free_memory();
//	return true;
//}

struct dlmalloc_chunk {
	size_t prev_foot;
	size_t head;
	dlmalloc_chunk* fd;
	dlmalloc_chunk* bk;
};

size_t alloc_size(void* ptr) {
	dlmalloc_chunk* c = (dlmalloc_chunk*)((char*)ptr - sizeof(size_t) * 2);
	return c->head & ~7;
}

extern "C" void* dlmalloc(size_t);
extern "C" void dlfree(void*);

size_t max_bytes_allocated = 160 * 1024 * 1024;

/*
extern "C" void* malloc(size_t n) {
	void* r = dlmalloc(n);
	while (!r) {
		printf("failed to allocate %d bytes\n", n);
		free_memory();
		r = dlmalloc(n);
	}
	bytes_allocated += alloc_size(r);
	while (bytes_allocated > max_bytes_allocated) free_memory();
	return r;
}

extern "C" void free(void* ptr) {
	if (!ptr) return;
	bytes_allocated -= alloc_size(ptr);
	dlfree(ptr);
}
*/

#ifdef EMSCRIPTEN

namespace bwgame {
namespace data_loading {

template<bool default_little_endian = true>
struct js_file_reader {
	a_string filename;
	size_t index = ~(size_t)0;
	size_t file_pointer = 0;
	js_file_reader() = default;
	explicit js_file_reader(a_string filename) {
		open(std::move(filename));
	}
	void open(a_string filename) {
		if (filename == "StarDat.mpq") index = 0;
		else if (filename == "BrooDat.mpq") index = 1;
		else if (filename == "Patch_rt.mpq") index = 2;
		else ui::xcept("js_file_reader: unknown filename '%s'", filename);
		this->filename = std::move(filename);
	}

	void get_bytes(uint8_t* dst, size_t n) {
		EM_ASM_({js_read_data($0, $1, $2, $3);}, index, dst, file_pointer, n);
		file_pointer += n;
	}

	void seek(size_t offset) {
		file_pointer = offset;
	}
	size_t tell() const {
		file_pointer;
	}

	size_t size() {
		return EM_ASM_INT({return js_file_size($0);}, index);
	}

};

}
}

main_t* m;

int current_width = -1;
int current_height = -1;

extern "C" void ui_resize(int width, int height) {
	if (width == current_width && height == current_height) return;
	if (width <= 0 || height <= 0) return;
	current_width = width;
	current_height = height;
	if (!m) return;
	m->ui.window_surface.reset();
	m->ui.indexed_surface.reset();
	m->ui.rgba_surface.reset();
	m->ui.wnd.destroy();
	m->ui.wnd.create("test", 0, 0, width, height);
	m->ui.resize(width, height);
}

extern "C" double replay_get_value(int index) {
	switch (index) {
	case 0:
		return m->ui.game_speed.raw_value / 256.0;
	case 1:
		return m->ui.is_paused ? 1 : 0;
	case 2:
		return (double)m->ui.st.current_frame;
	case 3:
		return (double)m->ui.replay_frame;
	case 4:
		return (double)m->ui.replay_st.end_frame;
	case 5:
		return (double)(uintptr_t)m->ui.replay_st.map_name.data();
	case 6:
		return (double)m->ui.replay_frame / m->ui.replay_st.end_frame;
	default:
		return 0;
	}
}

extern "C" void replay_set_value(int index, double value) {
	switch (index) {
	case 0:
		m->ui.game_speed.raw_value = (int)(value * 256.0);
		if (m->ui.game_speed < 1_fp8) m->ui.game_speed = 1_fp8;
		break;
	case 1:
		m->ui.is_paused = value != 0.0;
		break;
	case 3:
		m->ui.replay_frame = (int)value;
		if (m->ui.replay_frame < 0) m->ui.replay_frame = 0;
		if (m->ui.replay_frame > m->ui.replay_st.end_frame) m->ui.replay_frame = m->ui.replay_st.end_frame;
		break;
	case 6:
		m->ui.replay_frame = (int)(m->ui.replay_st.end_frame * value);
		if (m->ui.replay_frame < 0) m->ui.replay_frame = 0;
		if (m->ui.replay_frame > m->ui.replay_st.end_frame) m->ui.replay_frame = m->ui.replay_st.end_frame;
		break;
	}
}

extern "C" double observer_get_value() {
	if (!m) return 0.0;
	return m->auto_observer_enabled ? 1.0 : 0.0;
}

extern "C" void observer_set_value(double value) {
	if (!m) return;
	m->auto_observer_enabled = value != 0.0;
	if (m->auto_observer_enabled) {
		m->observer_initialized = false;
		m->observer_last_moved = 0;
		m->observer_last_moved_priority = 0;
		m->observer_last_frame_seen = -1;
		m->observer_focus_position = {};
		m->observer_current_camera_position = {};
		m->observer_focus_unit_id = {};
		m->observer_follow_unit = false;
		m->observer_unit_health.clear();
	}
}

#include <emscripten/bind.h>
#include <emscripten/val.h>
using namespace emscripten;

struct js_unit_type {
	const unit_type_t* ut = nullptr;
	js_unit_type() {}
	js_unit_type(const unit_type_t* ut) : ut(ut) {}
	auto id() const {return ut ? (int)ut->id : 228;}
	auto build_time() const {return ut->build_time;}
};

struct js_unit {
	unit_t* u = nullptr;
	js_unit() {}
	js_unit(unit_t* u) : u(u) {}
	auto owner() const {return u->owner;}
	auto remaining_build_time() const {return u->remaining_build_time;}
	auto unit_type() const {return u->unit_type;}
	auto build_type() const {return u->build_queue.empty() ? nullptr : u->build_queue.front();}
};


struct util_functions: state_functions {
	util_functions(state& st) : state_functions(st) {}

	double worker_supply(int owner) {
		double r = 0.0;
		for (const unit_t* u : ptr(st.player_units.at(owner))) {
			if (!ut_worker(u)) continue;
			if (!u_completed(u)) continue;
			r += u->unit_type->supply_required.raw_value / 2.0;
		}
		return r;
	}

	double army_supply(int owner) {
		double r = 0.0;
		for (const unit_t* u : ptr(st.player_units.at(owner))) {
			if (ut_worker(u)) continue;
			if (!u_completed(u)) continue;
			r += u->unit_type->supply_required.raw_value / 2.0;
		}
		return r;
	}

	auto get_all_incomplete_units() {
		val r = val::array();
		size_t i = 0;
		for (unit_t* u : ptr(st.visible_units)) {
			if (u_completed(u)) continue;
			r.set(i++, u);
		}
		for (unit_t* u : ptr(st.hidden_units)) {
			if (u_completed(u)) continue;
			r.set(i++, u);
		}
		return r;
	}

	auto get_all_completed_units() {
		val r = val::array();
		size_t i = 0;
		for (unit_t* u : ptr(st.visible_units)) {
			if (!u_completed(u)) continue;
			r.set(i++, u);
		}
		for (unit_t* u : ptr(st.hidden_units)) {
			if (!u_completed(u)) continue;
			r.set(i++, u);
		}
		return r;
	}

	auto get_all_units() {
		val r = val::array();
		size_t i = 0;
		for (unit_t* u : ptr(st.visible_units)) {
			r.set(i++, u);
		}
		for (unit_t* u : ptr(st.hidden_units)) {
			r.set(i++, u);
		}
		for (unit_t* u : ptr(st.map_revealer_units)) {
			r.set(i++, u);
		}
		return r;
	}

	auto get_completed_upgrades(int owner) {
		val r = val::array();
		size_t n = 0;
		for (size_t i = 0; i != 61; ++i) {
			int level = player_upgrade_level(owner, (UpgradeTypes)i);
			if (level == 0) continue;
			val o = val::object();
			o.set("id", val((int)i));
			o.set("icon", val(get_upgrade_type((UpgradeTypes)i)->icon));
			o.set("level", val(level));
			r.set(n++, o);
		}
		return r;
	}

	auto get_completed_research(int owner) {
		val r = val::array();
		size_t n = 0;
		for (size_t i = 0; i != 44; ++i) {
			if (!player_has_researched(owner, (TechTypes)i)) continue;
			val o = val::object();
			o.set("id", val((int)i));
			o.set("icon", val(get_tech_type((TechTypes)i)->icon));
			r.set(n++, o);
		}
		return r;
	}

	auto get_incomplete_upgrades(int owner) {
		val r = val::array();
		size_t i = 0;
		for (unit_t* u : ptr(st.player_units[owner])) {
			if (u->order_type->id == Orders::Upgrade && u->building.upgrading_type) {
				val o = val::object();
				o.set("id", val((int)u->building.upgrading_type->id));
				o.set("icon", val((int)u->building.upgrading_type->icon));
				o.set("level", val(u->building.upgrading_level));
				o.set("remaining_time", val(u->building.upgrade_research_time));
				o.set("total_time", val(upgrade_time_cost(owner, u->building.upgrading_type)));
				r.set(i++, o);
			}
		}
		return r;
	}

	auto get_incomplete_research(int owner) {
		val r = val::array();
		size_t i = 0;
		for (unit_t* u : ptr(st.player_units[owner])) {
			if (u->order_type->id == Orders::ResearchTech && u->building.researching_type) {
				val o = val::object();
				o.set("id", val((int)u->building.researching_type->id));
				o.set("icon", val((int)u->building.researching_type->icon));
				o.set("remaining_time", val(u->building.upgrade_research_time));
				o.set("total_time", val(u->building.researching_type->research_time));
				r.set(i++, o);
			}
		}
		return r;
	}

};

optional<util_functions> m_util_funcs;

util_functions& get_util_funcs() {
	m_util_funcs.emplace(m->ui.st);
	return *m_util_funcs;
}

const unit_type_t* unit_t_unit_type(const unit_t* u) {
	return u->unit_type;
}
const unit_type_t* unit_t_build_type(const unit_t* u) {
	if (u->build_queue.empty()) return nullptr;
	return u->build_queue.front();
}

int unit_type_t_id(const unit_type_t& ut) {
	return (int)ut.id;
}

void set_volume(double percent) {
	m->ui.set_volume((int)(percent * 100));
}

double get_volume() {
	return m->ui.global_volume / 100.0;
}

EMSCRIPTEN_BINDINGS(openbw) {
	register_vector<js_unit>("vector_js_unit");
	class_<util_functions>("util_functions")
		.function("worker_supply", &util_functions::worker_supply)
		.function("army_supply", &util_functions::army_supply)
		.function("get_all_incomplete_units", &util_functions::get_all_incomplete_units, allow_raw_pointers())
		.function("get_all_completed_units", &util_functions::get_all_completed_units, allow_raw_pointers())
		.function("get_all_units", &util_functions::get_all_units, allow_raw_pointers())
		.function("get_completed_upgrades", &util_functions::get_completed_upgrades)
		.function("get_completed_research", &util_functions::get_completed_research)
		.function("get_incomplete_upgrades", &util_functions::get_incomplete_upgrades)
		.function("get_incomplete_research", &util_functions::get_incomplete_research)
		;
	function("get_util_funcs", &get_util_funcs);

	function("set_volume", &set_volume);
	function("get_volume", &get_volume);

	class_<unit_type_t>("unit_type_t")
		.property("id", &unit_type_t_id)
		.property("build_time", &unit_type_t::build_time)
		;

	class_<unit_t>("unit_t")
		.property("owner", &unit_t::owner)
		.property("remaining_build_time", &unit_t::remaining_build_time)
		.function("unit_type", &unit_t_unit_type, allow_raw_pointers())
		.function("build_type", &unit_t_build_type, allow_raw_pointers())
		;
}

extern "C" double player_get_value(int player, int index) {
	if (player < 0 || player >= 12) return 0;
	switch (index) {
	case 0:
		return m->ui.st.players.at(player).controller == player_t::controller_occupied ? 1 : 0;
	case 1:
		return (double)m->ui.st.players.at(player).color;
	case 2:
		return (double)(uintptr_t)m->ui.replay_st.player_name.at(player).data();
	case 3:
		return m->ui.st.supply_used.at(player)[0].raw_value / 2.0;
	case 4:
		return m->ui.st.supply_used.at(player)[1].raw_value / 2.0;
	case 5:
		return m->ui.st.supply_used.at(player)[2].raw_value / 2.0;
	case 6:
		return std::min(m->ui.st.supply_available.at(player)[0].raw_value / 2.0, 200.0);
	case 7:
		return std::min(m->ui.st.supply_available.at(player)[1].raw_value / 2.0, 200.0);
	case 8:
		return std::min(m->ui.st.supply_available.at(player)[2].raw_value / 2.0, 200.0);
	case 9:
		return (double)m->ui.st.current_minerals.at(player);
	case 10:
		return (double)m->ui.st.current_gas.at(player);
	case 11:
		return util_functions(m->ui.st).worker_supply(player);
	case 12:
		return util_functions(m->ui.st).army_supply(player);
	case 13:
		return (double)(int)m->ui.st.players.at(player).race;
	case 14:
		return (double)m->ui.apm.at(player).current_apm;
	default:
		return 0;
	}
}

bool any_replay_loaded = false;

extern "C" void load_replay(const uint8_t* data, size_t len) {
	m->reset();
	m->ui.load_replay_data(data, len);
	m->ui.set_image_data();
	any_replay_loaded = true;
}

#endif

int main() {

	using namespace bwgame;

	log("v25\n");

	size_t screen_width = 1280;
	size_t screen_height = 800;

	std::chrono::high_resolution_clock clock;
	auto start = clock.now();

#ifdef EMSCRIPTEN
	if (current_width != -1) {
		screen_width = current_width;
		screen_height = current_height;
	}
	auto load_data_file = data_loading::data_files_directory<data_loading::data_files_loader<data_loading::mpq_file<data_loading::js_file_reader<>>>>("");
#else
	auto load_data_file = data_loading::data_files_directory("");
#endif

	game_player player(load_data_file);

	main_t m(std::move(player));
	auto& ui = m.ui;

	m.ui.load_all_image_data(load_data_file);

	ui.load_data_file = [&](a_vector<uint8_t>& data, a_string filename) {
		load_data_file(data, std::move(filename));
	};

	ui.init();

#ifndef EMSCRIPTEN
	ui.load_replay_file("maps/p49.rep");
#endif

	auto& wnd = ui.wnd;
	wnd.create("test", 0, 0, screen_width, screen_height);

	ui.resize(screen_width, screen_height);
	ui.screen_pos = {(int)ui.game_st.map_width / 2 - (int)screen_width / 2, (int)ui.game_st.map_height / 2 - (int)screen_height / 2};

	ui.set_image_data();
	ui.set_volume(80);

	log("loaded in %dms\n", std::chrono::duration_cast<std::chrono::milliseconds>(clock.now() - start).count());

	//set_malloc_fail_handler(malloc_fail_handler);

#ifdef EMSCRIPTEN
	::m = &m;
	::g_m = &m;
	//EM_ASM({js_load_done();});
	emscripten_set_main_loop_arg([](void* ptr) {
		if (!any_replay_loaded) return;
		EM_ASM({js_pre_main_loop();});
		((main_t*)ptr)->update();
		EM_ASM({js_post_main_loop();});
	}, &m, 0, 1);
#else
	::g_m = &m;
	while (true) {
		m.update();
		std::this_thread::sleep_for(std::chrono::milliseconds(20));
	}
#endif
	::g_m = nullptr;

	return 0;
}
