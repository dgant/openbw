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

inline bool main_t::observer_v3_unit_has_combat_interest(unit_t* unit) {
	if (!unit || !unit->sprite) return false;
	int unit_key = (int)ui.get_unit_id_32(unit).raw_value;
	if (unit_has_v3_attention_status(unit)) {
		observer_v3_combat_interest_until_frame[unit_key] = ui.st.current_frame + 96;
		return true;
	}
	auto it = observer_v3_combat_interest_until_frame.find(unit_key);
	return it != observer_v3_combat_interest_until_frame.end() && ui.st.current_frame <= it->second;
}

inline int main_t::observer_v3_combat_cluster_count(unit_t* unit, const a_vector<unit_t*>& eligible_units) {
	if (!unit || !unit->sprite || !observer_v3_unit_has_combat_interest(unit)) return 0;
	int count = 0;
	double radius_sq = 192.0 * 192.0;
	for (unit_t* other : eligible_units) {
		if (!other || !other->sprite) continue;
		if (!observer_v3_unit_has_combat_interest(other)) continue;
		if (observer_distance_sq(unit->sprite->position, other->sprite->position) <= radius_sq) ++count;
	}
	return count;
}

inline xy main_t::observer_v3_clamp_target_center(xy target) const {
	xy screen_pos = target - observer_view_center_offset();
	if (screen_pos.y + (int)ui.view_height > ui.game_st.map_height) screen_pos.y = ui.game_st.map_height - ui.view_height;
	if (screen_pos.y < 0) screen_pos.y = 0;
	if (screen_pos.x + (int)ui.view_width > ui.game_st.map_width) screen_pos.x = ui.game_st.map_width - ui.view_width;
	if (screen_pos.x < 0) screen_pos.x = 0;
	return screen_pos + observer_view_center_offset();
}

inline bool main_t::observer_v3_pan_would_break_hysteresis(unit_t* unit, xy target) const {
	if (!unit || !unit->sprite) return false;
	if (!observer_position_in_middle_third(unit->sprite->position)) return false;
	xy clamped_target = observer_v3_clamp_target_center(target);
	return std::abs(unit->sprite->position.x - clamped_target.x) > (int)ui.view_width / 6 ||
		std::abs(unit->sprite->position.y - clamped_target.y) > (int)ui.view_height / 6;
}

inline void main_t::observer_v3_apply_center(xy pos, bool reset_velocity) {
	if (reset_velocity) {
		observer_v3_velocity_x = 0.0;
		observer_v3_velocity_y = 0.0;
	}
	observer_v3_last_apply_center_input_position = pos;
	ui.screen_pos = pos - observer_view_center_offset();
	observer_v3_last_apply_center_unclamped_screen_pos = ui.screen_pos;
	clamp_screen_pos();
	observer_current_camera_position = observer_view_center_position();
	observer_focus_position = observer_current_camera_position;
	observer_v3_camera_x = (double)observer_current_camera_position.x;
	observer_v3_camera_y = (double)observer_current_camera_position.y;
}

inline bool main_t::observer_v3_focus_nukes(std::chrono::steady_clock::time_point now) {
	auto maybe_focus_visible_falling_nuke = [&](auto&& list) -> bool {
		for (unit_t* unit : list) {
			if (!unit || !unit->sprite) continue;
			if (!ui.unit_is(unit, UnitTypes::Terran_Nuclear_Missile)) continue;
			if (unit->velocity.y <= 0_fp8) continue;
			observer_v3_nuke_hold_position = unit->sprite->position;
			observer_v3_nuke_hold_until = now + std::chrono::seconds(6);
			observer_v3_last_apply_center_reason = 1;
			observer_v3_apply_center(observer_v3_nuke_hold_position, true);
			return true;
		}
		return false;
	};
	if (maybe_focus_visible_falling_nuke(ptr(ui.st.visible_units))) return true;
	if (now < observer_v3_nuke_hold_until) {
		observer_v3_last_apply_center_reason = 2;
		observer_v3_apply_center(observer_v3_nuke_hold_position, true);
		return true;
	}

	unit_t* nearest_ghost = nullptr;
	double nearest_distance = std::numeric_limits<double>::max();
	auto maybe_find_nuke_paint_ghost = [&](auto&& list, bool use_anchor, xy anchor) {
		for (unit_t* unit : list) {
			if (!unit || !unit->sprite || !is_occupied_player(unit->owner)) continue;
			if (!ui.unit_is(unit, UnitTypes::Terran_Ghost)) continue;
			if (!unit->order_type || unit->order_type->id != Orders::NukePaint) continue;
			double distance = use_anchor ? observer_distance_sq(unit->sprite->position, anchor) : 0.0;
			if (distance < nearest_distance) {
				nearest_distance = distance;
				nearest_ghost = unit;
			}
		}
	};

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
	maybe_find_nuke_paint_ghost(ptr(ui.st.visible_units), has_nuke_dot, nuke_dot_position);
	if (has_nuke_dot) {
		if (nearest_ghost && nearest_ghost->sprite) {
			nuke_dot_position = xy(
				(nuke_dot_position.x + nearest_ghost->sprite->position.x) / 2,
				(nuke_dot_position.y + nearest_ghost->sprite->position.y) / 2);
		}
		observer_v3_last_apply_center_reason = 4;
		observer_v3_apply_center(nuke_dot_position, true);
		return true;
	}
	if (!nearest_ghost || !nearest_ghost->sprite) return false;
	observer_v3_last_apply_center_reason = 3;
	observer_v3_apply_center(nearest_ghost->sprite->position, true);
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
	bool has_combat_interest = observer_v3_unit_has_combat_interest(unit);
	double score =
		(1.0 +
			((is_building || is_worker) ? 0.0 : 1.0) +
			((seen_in_viewport || !is_building || is_supply_building) ? 0.0 : 2.0) +
			(has_combat_interest ? 100.0 : 0.0)) *
		(1.0 + std::min(2.0, 0.002 * (double)frames_since_viewport));
	observer_v3_interest_scores[unit_key] = score;
	return score;
}

inline double main_t::observer_v3_effective_interest_score(unit_t* unit) {
	int unit_key = (int)ui.get_unit_id_32(unit).raw_value;
	bool has_combat_interest = observer_v3_unit_has_combat_interest(unit);
	auto it = observer_v3_interest_scores.find(unit_key);
	if (it == observer_v3_interest_scores.end()) return observer_v3_compute_interest(unit);
	if (has_combat_interest || it->second > 100.0 || observer_position_in_viewport(unit->sprite->position)) {
		return observer_v3_compute_interest(unit);
	}
	return it->second;
}

template <typename T>
inline void main_t::observer_v3_collect_eligible_units(T&& list, a_vector<unit_t*>& out) {
	for (unit_t* unit : list) {
		if (!observer_v3_unit_eligible(unit)) continue;
		out.push_back(unit);
	}
}

inline void main_t::observer_v3_update_interest_queue(const a_vector<unit_t*>& eligible_units, int frame_delta) {
	if (eligible_units.empty()) {
		observer_v3_interest_cursor = 0;
		return;
	}
	if (observer_v3_interest_cursor >= eligible_units.size()) observer_v3_interest_cursor = 0;
	if (frame_delta < 1) frame_delta = 1;
	size_t updates = std::min<size_t>(eligible_units.size(), (size_t)frame_delta * 50);
	for (size_t i = 0; i != updates; ++i) {
		size_t index = (observer_v3_interest_cursor + i) % eligible_units.size();
		observer_v3_compute_interest(eligible_units[index]);
	}
	observer_v3_interest_cursor = (observer_v3_interest_cursor + updates) % eligible_units.size();
}

inline int main_t::observer_v3_try_jump_to_interest(const a_vector<unit_t*>& eligible_units, std::chrono::steady_clock::time_point now, xy& direct_pan_target, double& best_viewport_score, bool live_viewport_fight, bool stale_viewport_fight_hold) {
	if (now < observer_v3_jump_cooldown_until) return 0;
	unit_t* best_unit = nullptr;
	unit_t* best_offscreen_unit = nullptr;
	double best_score = -1.0;
	best_viewport_score = 0.0;
	double best_offscreen_score = 0.0;
	int best_cluster_count = -1;
	int best_offscreen_cluster_count = -1;
	for (unit_t* unit : eligible_units) {
		double score = observer_v3_effective_interest_score(unit);
		bool in_viewport = observer_position_in_viewport(unit->sprite->position);
		bool has_combat_interest = observer_v3_unit_has_combat_interest(unit);
		int cluster_count = has_combat_interest ? observer_v3_combat_cluster_count(unit, eligible_units) : 0;
		if (in_viewport && score > best_viewport_score) best_viewport_score = score;
		if (!in_viewport && (
			score > best_offscreen_score ||
			(score == best_offscreen_score && has_combat_interest && cluster_count > best_offscreen_cluster_count)
		)) {
			best_offscreen_score = score;
			best_offscreen_unit = unit;
			best_offscreen_cluster_count = cluster_count;
		}
		if (
			score > best_score ||
			(score == best_score && has_combat_interest && cluster_count > best_cluster_count)
		) {
			best_score = score;
			best_unit = unit;
			best_cluster_count = cluster_count;
		}
	}
	observer_v3_last_best_offscreen_score = best_offscreen_score;
	if (!best_unit || !best_unit->sprite) return 0;
	bool much_stronger_offscreen = best_offscreen_score > best_viewport_score * 2.0;
	if (observer_position_in_viewport(best_unit->sprite->position)) {
		if (best_offscreen_unit && best_offscreen_unit->sprite && much_stronger_offscreen) {
			observer_v3_last_apply_center_reason = 5;
			observer_v3_apply_center(best_offscreen_unit->sprite->position, true);
			observer_v3_jump_cooldown_until = now + std::chrono::duration_cast<std::chrono::steady_clock::duration>(
				std::chrono::duration<double>(5.0 + std::min(5.0, best_viewport_score)));
			return 2;
		}
		direct_pan_target = best_unit->sprite->position;
		return 1;
	}
	if (live_viewport_fight && !much_stronger_offscreen) return 0;
	if (stale_viewport_fight_hold && best_viewport_score >= best_offscreen_score) return 0;
	observer_v3_last_apply_center_reason = 6;
	observer_v3_apply_center(best_unit->sprite->position, true);
	observer_v3_jump_cooldown_until = now + std::chrono::duration_cast<std::chrono::steady_clock::duration>(
		std::chrono::duration<double>(5.0 + std::min(5.0, best_viewport_score)));
	return 2;
}

inline void main_t::observer_v3_update_motion(std::chrono::steady_clock::time_point now) {
	double dt = observer_v3_last_update_frame == -1
		? (1.0 / 24.0)
		: (double)(ui.st.current_frame - observer_v3_last_update_frame) / 24.0;
	int frame_delta = observer_v3_last_update_frame == -1 ? 1 : ui.st.current_frame - observer_v3_last_update_frame;
	if (frame_delta < 1) frame_delta = 1;
	if (dt < 0.0) dt = 0.0;
	if (dt > 0.25) dt = 0.25;
	observer_v3_last_update_frame = ui.st.current_frame;
	observer_v3_last_action = 0;
	observer_v3_last_target_position = observer_current_camera_position;

	a_vector<unit_t*> eligible_units;
	observer_v3_collect_eligible_units(ptr(ui.st.visible_units), eligible_units);
	observer_v3_update_interest_queue(eligible_units, frame_delta);
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
		double best_viewport_score = 0.0;
		int viewport_attention_count = 0;
		auto decelerate_velocity = [&]() {
			double velocity_length = std::sqrt(observer_v3_velocity_x * observer_v3_velocity_x + observer_v3_velocity_y * observer_v3_velocity_y);
			if (velocity_length <= 0.0) return;
			double decel = 128.0 * dt;
			double next_length = std::max(0.0, velocity_length - decel);
			double scale = velocity_length == 0.0 ? 0.0 : next_length / velocity_length;
			observer_v3_velocity_x *= scale;
			observer_v3_velocity_y *= scale;
		};
		auto should_refuse_pan_target = [&](xy target) {
			for (unit_t* unit : eligible_units) {
				if (!unit || !unit->sprite) continue;
				if (!observer_v3_unit_has_combat_interest(unit)) continue;
				if (observer_v3_pan_would_break_hysteresis(unit, target)) return true;
			}
			return false;
		};
		for (unit_t* unit : eligible_units) {
			if (!unit || !unit->sprite) continue;
			if (!observer_position_in_viewport(unit->sprite->position)) continue;
			if (!observer_v3_unit_has_combat_interest(unit)) continue;
			if (ui.ut_worker(unit)) continue;
			if (!ui.unit_can_attack(unit)) continue;
			++viewport_attention_count;
		}
		if (viewport_attention_count != 0) {
			observer_v3_viewport_fight_hold_until = now + std::chrono::seconds(6);
		}
		bool live_viewport_fight = viewport_attention_count != 0;
		bool stale_viewport_fight_hold = !live_viewport_fight && now < observer_v3_viewport_fight_hold_until;
		observer_v3_last_best_viewport_score = best_viewport_score;
		observer_v3_last_best_offscreen_score = 0.0;
		observer_v3_last_live_viewport_fight = live_viewport_fight;
		observer_v3_last_stale_viewport_fight_hold = stale_viewport_fight_hold;
		int jump_action = observer_v3_try_jump_to_interest(eligible_units, now, direct_pan_target, best_viewport_score, live_viewport_fight, stale_viewport_fight_hold);
		observer_v3_last_best_viewport_score = best_viewport_score;
		if (jump_action == 1) {
			if (should_refuse_pan_target(direct_pan_target)) {
				observer_v3_last_target_position = observer_current_camera_position;
				decelerate_velocity();
			} else {
				observer_v3_last_action = 1;
				observer_v3_last_target_position = direct_pan_target;
				observer_focus_position = direct_pan_target;
				double dx = (double)direct_pan_target.x - observer_v3_camera_x;
				double dy = (double)direct_pan_target.y - observer_v3_camera_y;
				double length = std::sqrt(dx * dx + dy * dy);
				if (length > 0.0) {
					double accel = 64.0 * dt;
					observer_v3_velocity_x += (dx / length) * accel;
					observer_v3_velocity_y += (dy / length) * accel;
				}
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
			double best_offscreen_high_interest_score = 0.0;
			xy best_offscreen_high_interest_target{};
			bool use_high_interest_only = false;
			for (unit_t* unit : eligible_units) {
				if (!unit || !unit->sprite) continue;
				if (observer_position_in_viewport(unit->sprite->position)) continue;
				double score = observer_v3_effective_interest_score(unit);
				if (score > best_offscreen_high_interest_score) {
					best_offscreen_high_interest_score = score;
					best_offscreen_high_interest_target = unit->sprite->position;
				}
			}
			if (!live_viewport_fight && best_offscreen_high_interest_score > 100.0 && best_offscreen_high_interest_score > best_viewport_score) {
				use_high_interest_only = true;
			}
			for (unit_t* unit : eligible_units) {
				if (!unit || !unit->sprite) continue;
				double score = observer_v3_effective_interest_score(unit);
				if (live_viewport_fight && !observer_position_in_viewport(unit->sprite->position)) continue;
				if (live_viewport_fight && !observer_v3_unit_has_combat_interest(unit)) continue;
				if (use_high_interest_only && score <= 100.0) continue;
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
			if (weight_sum > 0.0 || use_high_interest_only) {
				xy target = weight_sum > 0.0
					? xy((int)std::lround(weighted_x / weight_sum), (int)std::lround(weighted_y / weight_sum))
					: best_offscreen_high_interest_target;
				if (should_refuse_pan_target(target)) {
					observer_v3_last_target_position = observer_current_camera_position;
					decelerate_velocity();
				} else {
					observer_focus_position = target;
					if (observer_position_in_middle_third(target)) {
						observer_v3_last_target_position = target;
						decelerate_velocity();
					} else {
						observer_v3_last_action = 3;
						observer_v3_last_target_position = target;
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
		} else if (jump_action == 2) {
			observer_v3_last_action = 2;
			observer_v3_last_target_position = observer_current_camera_position;
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
	observer_v3_last_applied_screen_pos = ui.screen_pos;
	observer_current_camera_position = observer_view_center_position();
	observer_focus_position = observer_current_camera_position;
	observer_v3_camera_x = (double)observer_current_camera_position.x;
	observer_v3_camera_y = (double)observer_current_camera_position.y;
}

inline void main_t::update_observer_camera_v3(std::chrono::steady_clock::time_point now) {
	initialize_observer_camera();
	if (observer_v3_last_update_frame == -1) {
		observer_v3_camera_x = (double)observer_current_camera_position.x;
		observer_v3_camera_y = (double)observer_current_camera_position.y;
	}
	if (observer_v3_focus_nukes(now)) {
		observer_v3_last_update_frame = ui.st.current_frame;
		return;
	}
	observer_v3_update_motion(now);
}
