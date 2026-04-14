inline xy main_t::observer_view_center_offset() const {
	return xy((int)ui.view_width / 2, (int)ui.view_height / 2 - 40);
}

inline xy main_t::observer_view_center_position() const {
	return ui.screen_pos + observer_view_center_offset();
}

inline bool main_t::observer_position_in_viewport(xy pos) const {
	return pos.x >= ui.screen_pos.x && pos.x <= ui.screen_pos.x + (int)ui.view_width &&
		pos.y >= ui.screen_pos.y && pos.y <= ui.screen_pos.y + (int)ui.view_height;
}

inline bool main_t::observer_position_in_middle_third(xy pos) const {
	xy center = observer_view_center_position();
	return std::abs(pos.x - center.x) <= (int)ui.view_width / 6 &&
		std::abs(pos.y - center.y) <= (int)ui.view_height / 6;
}

inline double main_t::observer_distance_sq(xy a, xy b) const {
	double dx = (double)a.x - (double)b.x;
	double dy = (double)a.y - (double)b.y;
	return dx * dx + dy * dy;
}

inline bool main_t::unit_is_under_dark_swarm_v3(const unit_t* unit) const {
	if (!unit || !unit->sprite || ui.ut_building(unit)) return false;
	if (ui.st.completed_unit_counts[11][UnitTypes::Spell_Dark_Swarm] == 0) return false;
	return ui.find_unit(ui.unit_sprite_inner_bounding_box(unit), [&](const unit_t* other) {
		return ui.unit_is(other, UnitTypes::Spell_Dark_Swarm);
	}) != nullptr;
}

inline bool main_t::unit_is_under_disruption_web_v3(const unit_t* unit) const {
	if (!unit || !unit->sprite) return false;
	if (ui.st.completed_unit_counts[11][UnitTypes::Spell_Disruption_Web] == 0) return false;
	return ui.find_unit(ui.unit_sprite_inner_bounding_box(unit), [&](const unit_t* other) {
		return ui.unit_is(other, UnitTypes::Spell_Disruption_Web);
	}) != nullptr;
}

inline bool main_t::unit_has_v3_attention_status(unit_t* unit) {
	if (!unit || !unit->sprite) return false;
	return unit->ground_weapon_cooldown != 0 || unit->air_weapon_cooldown != 0 ||
		unit_is_under_attack(unit) ||
		unit_is_under_dark_swarm_v3(unit) ||
		unit_is_under_disruption_web_v3(unit) ||
		unit->storm_timer != 0 ||
		unit->maelstrom_timer != 0 ||
		unit->lockdown_timer != 0 ||
		unit->irradiate_timer != 0 ||
		unit->stasis_timer != 0;
}

inline bool main_t::observer_v3_unit_eligible(unit_t* unit) const {
	if (!unit || !unit->sprite || !is_occupied_player(unit->owner)) return false;
	if (ui.unit_is(unit, UnitTypes::Zerg_Larva) ||
		ui.unit_is(unit, UnitTypes::Zerg_Overlord) ||
		ui.unit_is(unit, UnitTypes::Terran_Supply_Depot) ||
		ui.unit_is(unit, UnitTypes::Protoss_Pylon) ||
		ui.unit_is(unit, UnitTypes::Terran_Vulture_Spider_Mine)) return false;
	return true;
}

inline void main_t::observer_v3_apply_center(xy pos, bool reset_velocity) {
	observer_focus_position = pos;
	observer_current_camera_position = pos;
	observer_v3_camera_x = (double)pos.x;
	observer_v3_camera_y = (double)pos.y;
	if (reset_velocity) {
		observer_v3_velocity_x = 0.0;
		observer_v3_velocity_y = 0.0;
	}
	ui.screen_pos = pos - observer_view_center_offset();
	clamp_screen_pos();
}

inline bool main_t::observer_v3_focus_nukes(std::chrono::steady_clock::time_point now) {
	auto maybe_focus_falling_nuke = [&](auto&& list) -> bool {
		for (unit_t* unit : list) {
			if (!unit || !unit->sprite) continue;
			if (!ui.unit_is(unit, UnitTypes::Terran_Nuclear_Missile)) continue;
			if (unit->velocity.y == 0_fp8) continue;
			observer_v3_nuke_hold_position = unit->sprite->position;
			observer_v3_nuke_hold_until = now + std::chrono::seconds(3);
			observer_v3_apply_center(observer_v3_nuke_hold_position, true);
			return true;
		}
		return false;
	};
	if (maybe_focus_falling_nuke(ptr(ui.st.visible_units))) return true;
	if (maybe_focus_falling_nuke(ptr(ui.st.hidden_units))) return true;
	if (now < observer_v3_nuke_hold_until) {
		observer_v3_apply_center(observer_v3_nuke_hold_position, true);
		return true;
	}

	xy nuke_dot_position;
	bool has_nuke_dot = false;
	auto find_nuke_dot = [&](auto&& list) {
		for (unit_t* unit : list) {
			if (!unit || !is_occupied_player(unit->owner) || !ui.unit_is(unit, UnitTypes::Terran_Ghost)) continue;
			if (unit->ghost.nuke_dot && unit->ghost.nuke_dot->sprite) {
				nuke_dot_position = unit->ghost.nuke_dot->sprite->position;
				has_nuke_dot = true;
				return;
			}
		}
	};
	find_nuke_dot(ptr(ui.st.visible_units));
	if (!has_nuke_dot) find_nuke_dot(ptr(ui.st.hidden_units));
	if (!has_nuke_dot) return false;

	unit_t* nearest_ghost = nullptr;
	double nearest_distance = std::numeric_limits<double>::max();
	auto maybe_find_nuke_paint_ghost = [&](auto&& list) {
		for (unit_t* unit : list) {
			if (!unit || !unit->sprite || !is_occupied_player(unit->owner)) continue;
			if (!ui.unit_is(unit, UnitTypes::Terran_Ghost)) continue;
			if (!unit->order_type || unit->order_type->id != Orders::NukePaint) continue;
			double distance = observer_distance_sq(unit->sprite->position, nuke_dot_position);
			if (distance < nearest_distance) {
				nearest_distance = distance;
				nearest_ghost = unit;
			}
		}
	};
	maybe_find_nuke_paint_ghost(ptr(ui.st.visible_units));
	maybe_find_nuke_paint_ghost(ptr(ui.st.hidden_units));
	if (nearest_ghost && nearest_ghost->sprite) {
		nuke_dot_position = xy(
			(nuke_dot_position.x + nearest_ghost->sprite->position.x) / 2,
			(nuke_dot_position.y + nearest_ghost->sprite->position.y) / 2);
	}
	observer_v3_apply_center(nuke_dot_position, true);
	return true;
}

inline double main_t::observer_v3_compute_interest(unit_t* unit) {
	int unit_key = (int)ui.get_unit_id_32(unit).raw_value;
	bool is_building = ui.ut_building(unit);
	bool is_worker = ui.ut_worker(unit);
	bool is_supply_building = ui.unit_is(unit, UnitTypes::Terran_Supply_Depot) || ui.unit_is(unit, UnitTypes::Protoss_Pylon);
	bool seen_in_viewport = observer_v3_ever_viewport_visible[unit_key];
	if (observer_position_in_viewport(unit->sprite->position)) {
		observer_v3_ever_viewport_visible[unit_key] = true;
		observer_v3_last_viewport_frame[unit_key] = ui.st.current_frame;
		seen_in_viewport = true;
	}
	int last_viewport_frame = seen_in_viewport ? observer_v3_last_viewport_frame[unit_key] : 0;
	int frames_since_viewport = seen_in_viewport ? ui.st.current_frame - last_viewport_frame : ui.st.current_frame;
	if (frames_since_viewport < 0) frames_since_viewport = 0;
	double score =
		(1.0 +
			((is_building || is_worker) ? 0.0 : 1.0) +
			((seen_in_viewport || !is_building || is_supply_building) ? 0.0 : 2.0) +
			(unit_has_v3_attention_status(unit) ? 100.0 : 0.0)) *
		(1.0 + std::min(2.0, 0.002 * (double)frames_since_viewport));
	observer_v3_interest_scores[unit_key] = score;
	return score;
}

template <typename T>
inline void main_t::observer_v3_collect_eligible_units(T&& list, a_vector<unit_t*>& out) {
	for (unit_t* unit : list) {
		if (!observer_v3_unit_eligible(unit)) continue;
		out.push_back(unit);
	}
}

inline void main_t::observer_v3_update_interest_queue(const a_vector<unit_t*>& eligible_units) {
	if (eligible_units.empty()) {
		observer_v3_interest_cursor = 0;
		return;
	}
	if (observer_v3_interest_cursor >= eligible_units.size()) observer_v3_interest_cursor = 0;
	size_t updates = std::min<size_t>(50, eligible_units.size());
	for (size_t i = 0; i != updates; ++i) {
		size_t index = (observer_v3_interest_cursor + i) % eligible_units.size();
		observer_v3_compute_interest(eligible_units[index]);
	}
	observer_v3_interest_cursor = (observer_v3_interest_cursor + updates) % eligible_units.size();
}

inline int main_t::observer_v3_try_jump_to_interest(const a_vector<unit_t*>& eligible_units, std::chrono::steady_clock::time_point now, xy& direct_pan_target) {
	if (now < observer_v3_jump_cooldown_until) return 0;
	unit_t* best_unit = nullptr;
	double best_score = -1.0;
	double best_viewport_score = 0.0;
	for (unit_t* unit : eligible_units) {
		int unit_key = (int)ui.get_unit_id_32(unit).raw_value;
		double score = observer_v3_interest_scores.count(unit_key) ? observer_v3_interest_scores[unit_key] : observer_v3_compute_interest(unit);
		if (observer_position_in_viewport(unit->sprite->position) && score > best_viewport_score) best_viewport_score = score;
		if (score > best_score) {
			best_score = score;
			best_unit = unit;
		}
	}
	if (!best_unit || !best_unit->sprite) return 0;
	if (observer_position_in_viewport(best_unit->sprite->position)) {
		direct_pan_target = best_unit->sprite->position;
		return 1;
	}
	observer_v3_apply_center(best_unit->sprite->position, true);
	observer_v3_jump_cooldown_until = now + std::chrono::duration_cast<std::chrono::steady_clock::duration>(
		std::chrono::duration<double>(5.0 + std::min(5.0, best_viewport_score)));
	return 2;
}

inline void main_t::observer_v3_update_motion(std::chrono::steady_clock::time_point now) {
	double dt = observer_v3_last_update_time == std::chrono::steady_clock::time_point::min()
		? (1.0 / 60.0)
		: std::chrono::duration_cast<std::chrono::duration<double>>(now - observer_v3_last_update_time).count();
	if (dt < 0.0) dt = 0.0;
	if (dt > 0.25) dt = 0.25;
	observer_v3_last_update_time = now;

	a_vector<unit_t*> eligible_units;
	observer_v3_collect_eligible_units(ptr(ui.st.visible_units), eligible_units);
	observer_v3_update_interest_queue(eligible_units);
	if (eligible_units.empty()) {
		double velocity_length = std::sqrt(observer_v3_velocity_x * observer_v3_velocity_x + observer_v3_velocity_y * observer_v3_velocity_y);
		if (velocity_length > 0.0) {
			double decel = 128.0 * dt;
			double next_length = std::max(0.0, velocity_length - decel);
			double scale = velocity_length == 0.0 ? 0.0 : next_length / velocity_length;
			observer_v3_velocity_x *= scale;
			observer_v3_velocity_y *= scale;
		}
	} else {
		xy direct_pan_target{};
		int jump_action = observer_v3_try_jump_to_interest(eligible_units, now, direct_pan_target);
		if (jump_action == 1) {
			observer_focus_position = direct_pan_target;
			double dx = (double)direct_pan_target.x - observer_v3_camera_x;
			double dy = (double)direct_pan_target.y - observer_v3_camera_y;
			double length = std::sqrt(dx * dx + dy * dy);
			if (length > 0.0) {
				double accel = 64.0 * dt;
				observer_v3_velocity_x += (dx / length) * accel;
				observer_v3_velocity_y += (dy / length) * accel;
			}
		} else if (jump_action == 0) {
			double weight_sum = 0.0;
			double weighted_x = 0.0;
			double weighted_y = 0.0;
			xy camera_center = xy((int)std::lround(observer_v3_camera_x), (int)std::lround(observer_v3_camera_y));
			double half_view_width = (double)ui.view_width;
			double half_view_height = (double)ui.view_height;
			double max_velocity = 9.6 * (1000.0 / 42.0) * std::max(1.0 / 128.0, ui.game_speed.raw_value / 256.0);
			double remaining_jump_cooldown = std::max(
				0.0,
				std::chrono::duration_cast<std::chrono::duration<double>>(observer_v3_jump_cooldown_until - now).count());
			for (unit_t* unit : eligible_units) {
				if (!unit || !unit->sprite) continue;
				int unit_key = (int)ui.get_unit_id_32(unit).raw_value;
				double score = observer_v3_interest_scores.count(unit_key) ? observer_v3_interest_scores[unit_key] : observer_v3_compute_interest(unit);
				double dx = (double)unit->sprite->position.x - camera_center.x;
				double dy = (double)unit->sprite->position.y - camera_center.y;
				if (std::abs(dx) > half_view_width || std::abs(dy) > half_view_height) continue;
				double distance_sq = dx * dx + dy * dy;
				double dx_bounds = 0.0;
				if (unit->sprite->position.x < ui.screen_pos.x) dx_bounds = (double)ui.screen_pos.x - unit->sprite->position.x;
				else if (unit->sprite->position.x > ui.screen_pos.x + (int)ui.view_width) dx_bounds = unit->sprite->position.x - (ui.screen_pos.x + (int)ui.view_width);
				double dy_bounds = 0.0;
				if (unit->sprite->position.y < ui.screen_pos.y) dy_bounds = (double)ui.screen_pos.y - unit->sprite->position.y;
				else if (unit->sprite->position.y > ui.screen_pos.y + (int)ui.view_height) dy_bounds = unit->sprite->position.y - (ui.screen_pos.y + (int)ui.view_height);
				double distance_to_bounds = std::sqrt(dx_bounds * dx_bounds + dy_bounds * dy_bounds);
				double time_to_viewport = max_velocity > 0.0 ? distance_to_bounds / max_velocity : 0.0;
				double offscreen_fade = 1.0;
				if (distance_to_bounds > 0.0) {
					double zero_weight_time = std::max(0.0, remaining_jump_cooldown - 2.0);
					if (zero_weight_time <= 0.0 || time_to_viewport >= zero_weight_time) continue;
					offscreen_fade = zero_weight_time > 0.0 ? (zero_weight_time - time_to_viewport) / zero_weight_time : 0.0;
				}
				double weight = score * distance_sq * offscreen_fade;
				if (weight <= 0.0) continue;
				weight_sum += weight;
				weighted_x += weight * unit->sprite->position.x;
				weighted_y += weight * unit->sprite->position.y;
			}
			if (weight_sum > 0.0) {
				xy target = xy((int)std::lround(weighted_x / weight_sum), (int)std::lround(weighted_y / weight_sum));
				observer_focus_position = target;
				if (observer_position_in_middle_third(target)) {
					double velocity_length = std::sqrt(observer_v3_velocity_x * observer_v3_velocity_x + observer_v3_velocity_y * observer_v3_velocity_y);
					if (velocity_length > 0.0) {
						double decel = 128.0 * dt;
						double next_length = std::max(0.0, velocity_length - decel);
						double scale = velocity_length == 0.0 ? 0.0 : next_length / velocity_length;
						observer_v3_velocity_x *= scale;
						observer_v3_velocity_y *= scale;
					}
				} else {
					double dx = (double)target.x - observer_v3_camera_x;
					double dy = (double)target.y - observer_v3_camera_y;
					double length = std::sqrt(dx * dx + dy * dy);
					if (length > 0.0) {
						double accel = 64.0 * dt;
						observer_v3_velocity_x += (dx / length) * accel;
						observer_v3_velocity_y += (dy / length) * accel;
					}
				}
			}
		}
	}

	double velocity_length = std::sqrt(observer_v3_velocity_x * observer_v3_velocity_x + observer_v3_velocity_y * observer_v3_velocity_y);
	double max_velocity = 9.6 * (1000.0 / 42.0) * std::max(1.0 / 128.0, ui.game_speed.raw_value / 256.0);
	if (velocity_length > max_velocity && velocity_length > 0.0) {
		double scale = max_velocity / velocity_length;
		observer_v3_velocity_x *= scale;
		observer_v3_velocity_y *= scale;
	}

	observer_v3_camera_x += observer_v3_velocity_x * dt;
	observer_v3_camera_y += observer_v3_velocity_y * dt;
	observer_current_camera_position = xy((int)std::lround(observer_v3_camera_x), (int)std::lround(observer_v3_camera_y));
	ui.screen_pos = observer_current_camera_position - observer_view_center_offset();
	clamp_screen_pos();
	observer_v3_camera_x = (double)(ui.screen_pos + observer_view_center_offset()).x;
	observer_v3_camera_y = (double)(ui.screen_pos + observer_view_center_offset()).y;
}

inline void main_t::update_observer_camera_v3(std::chrono::steady_clock::time_point now) {
	initialize_observer_camera();
	if (observer_v3_last_update_time == std::chrono::steady_clock::time_point::min()) {
		observer_v3_camera_x = (double)observer_current_camera_position.x;
		observer_v3_camera_y = (double)observer_current_camera_position.y;
	}
	if (observer_v3_focus_nukes(now)) {
		observer_v3_last_update_time = now;
		return;
	}
	observer_v3_update_motion(now);
}
