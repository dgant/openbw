
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
#include <algorithm>
#include <cmath>

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
void free_memory();
constexpr size_t max_saved_states = 96;

struct main_t {
	ui_functions ui;
	bool auto_observer_enabled = true;
	bool fog_of_war_enabled = true;
	uint32_t fog_of_war_player_mask = 0;
	bool fog_of_war_player_mask_custom = false;
	bool force_red_blue_player_colors = false;
	bool observer_initialized = false;
	int observer_last_frame_seen = -1;
	xy observer_current_camera_position;
	xy observer_focus_position;
	std::unordered_map<int, int> observer_unit_health;
	std::chrono::steady_clock::time_point observer_manual_override_until = std::chrono::steady_clock::time_point::min();
	std::chrono::steady_clock::time_point observer_v3_jump_cooldown_until = std::chrono::steady_clock::time_point::min();
	std::chrono::steady_clock::time_point observer_v3_nuke_hold_until = std::chrono::steady_clock::time_point::min();
	std::chrono::steady_clock::time_point observer_v3_last_update_time = std::chrono::steady_clock::time_point::min();
	xy observer_v3_nuke_hold_position;
	double observer_v3_camera_x = 0.0;
	double observer_v3_camera_y = 0.0;
	double observer_v3_velocity_x = 0.0;
	double observer_v3_velocity_y = 0.0;
	size_t observer_v3_interest_cursor = 0;
	std::unordered_map<int, double> observer_v3_interest_scores;
	std::unordered_map<int, int> observer_v3_last_viewport_frame;
	std::unordered_map<int, bool> observer_v3_ever_viewport_visible;

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
		fog_of_war_enabled = true;
		fog_of_war_player_mask = 0;
		fog_of_war_player_mask_custom = false;
		force_red_blue_player_colors = false;
		reset_observer_runtime_state();
	}

	void reset_observer_runtime_state() {
		observer_initialized = false;
		observer_last_frame_seen = -1;
		observer_current_camera_position = {};
		observer_focus_position = {};
		observer_unit_health.clear();
		observer_manual_override_until = std::chrono::steady_clock::time_point::min();
		observer_v3_jump_cooldown_until = std::chrono::steady_clock::time_point::min();
		observer_v3_nuke_hold_until = std::chrono::steady_clock::time_point::min();
		observer_v3_last_update_time = std::chrono::steady_clock::time_point::min();
		observer_v3_nuke_hold_position = {};
		observer_v3_camera_x = 0.0;
		observer_v3_camera_y = 0.0;
		observer_v3_velocity_x = 0.0;
		observer_v3_velocity_y = 0.0;
		observer_v3_interest_cursor = 0;
		observer_v3_interest_scores.clear();
		observer_v3_last_viewport_frame.clear();
		observer_v3_ever_viewport_visible.clear();
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

	uint32_t fog_of_war_vision_mask() const {
		uint32_t mask = 0;
		for (int owner = 0; owner != 12; ++owner) {
			if (!is_occupied_player(owner)) continue;
			if (fog_of_war_player_mask_custom && (fog_of_war_player_mask & (1u << owner)) == 0) continue;
			mask |= 1u << owner;
		}
		if (fog_of_war_player_mask_custom && mask == 0) return 0;
		return mask;
	}

	void sync_fog_of_war() {
		ui.vision = fog_of_war_enabled ? fog_of_war_vision_mask() : 0;
		ui.force_full_fog = fog_of_war_enabled && ui.vision == 0;
	}

	bool get_forced_red_blue_players(int& first_player, int& second_player) const {
		first_player = -1;
		second_player = -1;
		for (int owner = 0; owner != 12; ++owner) {
			if (!is_occupied_player(owner)) continue;
			if (first_player == -1) first_player = owner;
			else if (second_player == -1) second_player = owner;
			else return false;
		}
		return first_player != -1 && second_player != -1;
	}

	int display_player_color(int player) const {
		if (!is_occupied_player(player)) return ui.st.players.at(player).color;
		if (!force_red_blue_player_colors) return ui.st.players.at(player).color;
		int first_player = -1;
		int second_player = -1;
		if (!get_forced_red_blue_players(first_player, second_player)) return ui.st.players.at(player).color;
		if (player == first_player) return 0;
		if (player == second_player) return 1;
		return ui.st.players.at(player).color;
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
		observer_current_camera_position = ui.screen_pos + xy((int)ui.view_width / 2, (int)ui.view_height / 2);
		observer_focus_position = observer_current_camera_position;
		for (int owner = 0; owner != 12; ++owner) {
			if (!observer_has_start_location(owner)) continue;
			observer_current_camera_position = observer_player_start_location(owner);
			observer_focus_position = observer_current_camera_position;
			break;
		}
	}

	xy observer_view_center_offset() const;
	xy observer_view_center_position() const;
	bool observer_position_in_viewport(xy pos) const;
	bool observer_position_in_middle_third(xy pos) const;
	double observer_distance_sq(xy a, xy b) const;
	bool unit_is_under_dark_swarm_v3(const unit_t* unit) const;
	bool unit_is_under_disruption_web_v3(const unit_t* unit) const;
	bool unit_has_v3_attention_status(unit_t* unit);
	bool observer_v3_unit_eligible(unit_t* unit) const;
	void observer_v3_apply_center(xy pos, bool reset_velocity);
	bool observer_v3_focus_nukes(std::chrono::steady_clock::time_point now);
	double observer_v3_compute_interest(unit_t* unit);
	template <typename T>
	void observer_v3_collect_eligible_units(T&& list, a_vector<unit_t*>& out);
	void observer_v3_update_interest_queue(const a_vector<unit_t*>& eligible_units);
	int observer_v3_try_jump_to_interest(const a_vector<unit_t*>& eligible_units, std::chrono::steady_clock::time_point now, xy& direct_pan_target);
	void observer_v3_update_motion(std::chrono::steady_clock::time_point now);
	void update_observer_camera_v3(std::chrono::steady_clock::time_point now);

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

	void pause_observer_for_manual_camera() {
		observer_manual_override_until = std::chrono::steady_clock::now() + std::chrono::seconds(5);
	}

	void update_observer_camera() {
		if (!auto_observer_enabled || !any_replay_loaded) return;
		if (ui.st.current_frame != ui.replay_frame) return;
		if (ui.is_paused || ui.is_done()) return;
		if (std::chrono::steady_clock::now() < observer_manual_override_until) return;
		if (observer_last_frame_seen != -1 && ui.st.current_frame < observer_last_frame_seen) {
			reset_observer_runtime_state();
		}
		observer_last_frame_seen = ui.st.current_frame;
		update_observer_camera_v3(std::chrono::steady_clock::now());
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
					while (saved_states.size() > max_saved_states) free_memory();
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

		sync_fog_of_war();
		int forced_first_player = -1;
		int forced_second_player = -1;
		uint8_t forced_first_color = 0;
		uint8_t forced_second_color = 0;
		bool force_player_colors = force_red_blue_player_colors && get_forced_red_blue_players(forced_first_player, forced_second_player);
		if (force_player_colors) {
			forced_first_color = ui.st.players.at(forced_first_player).color;
			forced_second_color = ui.st.players.at(forced_second_player).color;
			ui.st.players.at(forced_first_player).color = 0;
			ui.st.players.at(forced_second_player).color = 1;
		}
		auto previous_screen_pos = ui.screen_pos;
		ui.update();
		if (ui.screen_pos != previous_screen_pos) pause_observer_for_manual_camera();
		if (force_player_colors) {
			ui.st.players.at(forced_first_player).color = forced_first_color;
			ui.st.players.at(forced_second_player).color = forced_second_color;
		}
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

#include "observer_camera_v3.h"

main_t* m;

int current_width = -1;
int current_height = -1;

namespace {
constexpr uint64_t max_resize_surface_bytes = 80ull * 1024ull * 1024ull;
constexpr uint64_t estimated_resize_bytes_per_pixel = 12ull;

bool ui_resize_dimensions_safe(int width, int height) {
	if (width <= 0 || height <= 0) return false;
	uint64_t pixels = (uint64_t)width * (uint64_t)height;
	return pixels <= max_resize_surface_bytes / estimated_resize_bytes_per_pixel;
}
}

extern "C" int ui_can_resize(int width, int height) {
	return ui_resize_dimensions_safe(width, height) ? 1 : 0;
}

extern "C" void ui_resize(int width, int height) {
	if (width == current_width && height == current_height) return;
	if (width <= 0 || height <= 0) return;
	if (!ui_resize_dimensions_safe(width, height)) return;
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

extern "C" void ui_set_minimap_reference_size(int width, int height) {
	if (!m) return;
	m->ui.set_minimap_reference_size(width, height);
}

extern "C" double ui_get_screen_pos(int axis) {
	if (!m) return 0.0;
	if (axis == 1) return (double)m->ui.screen_pos.y;
	return (double)m->ui.screen_pos.x;
}

extern "C" void ui_set_screen_center(int x, int y) {
	if (!m) return;
	m->ui.screen_pos = {x - (int)m->ui.view_width / 2, y - (int)m->ui.view_height / 2};
	if (m->ui.screen_pos.y + (int)m->ui.view_height > m->ui.game_st.map_height) m->ui.screen_pos.y = m->ui.game_st.map_height - m->ui.view_height;
	if (m->ui.screen_pos.y < 0) m->ui.screen_pos.y = 0;
	if (m->ui.screen_pos.x + (int)m->ui.view_width > m->ui.game_st.map_width) m->ui.screen_pos.x = m->ui.game_st.map_width - m->ui.view_width;
	if (m->ui.screen_pos.x < 0) m->ui.screen_pos.x = 0;
}

extern "C" void ui_set_screen_center_manual(int x, int y) {
	if (!m) return;
	ui_set_screen_center(x, y);
	m->pause_observer_for_manual_camera();
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

extern "C" double observer_get_mode() {
	return 3.0;
}

extern "C" void observer_set_mode(double value) {
	(void)value;
}

extern "C" void observer_set_value(double value) {
	if (!m) return;
	m->auto_observer_enabled = value != 0.0;
	if (m->auto_observer_enabled) {
		m->reset_observer_runtime_state();
	}
}

extern "C" double fog_of_war_get_value() {
	if (!m) return 0.0;
	return m->fog_of_war_enabled ? 1.0 : 0.0;
}

extern "C" void fog_of_war_set_value(double value) {
	if (!m) return;
	m->fog_of_war_enabled = value != 0.0;
	m->sync_fog_of_war();
}

extern "C" double fog_of_war_player_get_value(int player) {
	if (!m) return 0.0;
	if (player < 0 || player >= 12) return 0.0;
	if (!m->is_occupied_player(player)) return 0.0;
	if (!m->fog_of_war_player_mask_custom) return 1.0;
	return (m->fog_of_war_player_mask & (1u << player)) ? 1.0 : 0.0;
}

extern "C" void fog_of_war_player_set_value(int player, double value) {
	if (!m) return;
	if (player < 0 || player >= 12) return;
	if (!m->is_occupied_player(player)) return;
	uint32_t occupied_mask = 0;
	for (int owner = 0; owner != 12; ++owner) {
		if (m->is_occupied_player(owner)) occupied_mask |= 1u << owner;
	}
	if (!occupied_mask) return;
	uint32_t mask = m->fog_of_war_player_mask_custom ? m->fog_of_war_player_mask : occupied_mask;
	if (value != 0.0) mask |= 1u << player;
	else mask &= ~(1u << player);
	m->fog_of_war_player_mask = mask;
	m->fog_of_war_player_mask_custom = true;
	m->sync_fog_of_war();
}

extern "C" double force_red_blue_colors_get_value() {
	if (!m) return 0.0;
	return m->force_red_blue_player_colors ? 1.0 : 0.0;
}

extern "C" void force_red_blue_colors_set_value(double value) {
	if (!m) return;
	m->force_red_blue_player_colors = value != 0.0;
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
			o.set("max_level", val(get_upgrade_type((UpgradeTypes)i)->max_level));
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
				o.set("max_level", val(u->building.upgrading_type->max_level));
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
		return (double)m->display_player_color(player);
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
