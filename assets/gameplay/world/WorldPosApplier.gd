extends Node
class_name WorldPosApplier

const DEFAULT_SPEED := 60.0          # px/s if no stats.spd present
const SNAP_DIST := 3.0               # px; consider “arrived”, zero vel, optional micro-snap
const CATCHUP_DIST := 96.0           # px; beyond this, add catch-up
const MAX_CATCHUP_MUL := 5.0         # cap total speed at spd * this when far behind

func apply_node_pos_from_buffer(node: Node, buf: Array, target_time: float) -> void:
	if node == null or buf.is_empty():
		return

	var target: Vector2
	if buf.size() == 1:
		target = buf[0].pos
	else:
		var a = buf[0]
		var b = buf[1]
		var span := float(max(1, b.t - a.t))
		var t = clamp((target_time - a.t) / span, 0.0, 1.0)
		target = a.pos.lerp(b.pos, t)

	# Prefer kinematic movement if this is a CharacterBody2D-like node
	var can_slide := node.has_method("move_and_slide") and ("velocity" in node)
	if can_slide:
		var pos: Vector2 = node.global_position
		var dt := 1.0 / float(Engine.get_physics_ticks_per_second())

		var to_target: Vector2 = target - pos
		var dist := to_target.length()

		var speed := _get_base_speed(node)
		if dist > CATCHUP_DIST:
			var over := dist - CATCHUP_DIST
			var mul = 1.0 + clamp(over / CATCHUP_DIST, 0.0, 1.0) * (MAX_CATCHUP_MUL - 1.0)
			speed *= mul

		var vel := Vector2.ZERO
		if dist > SNAP_DIST:
			var dir = to_target / max(dist, 0.0001)
			vel = dir * speed

			# Prevent overshooting the target within this physics step
			var max_step := speed * dt
			if max_step > 0.0 and dist < max_step:
				vel = dir * (dist / dt)

		node.velocity = vel
		node.move_and_slide()

		# Close enough: stop and micro-snap to kill jitter
		if dist <= SNAP_DIST:
			node.velocity = Vector2.ZERO
			if dist <= 0.5:
				# micro-snap (safe; tiny error only)
				if node.has_method("set_global_position"):
					node.set_global_position(target)
				else:
					node.global_position = target
	else:
		# Fallback for non-kinematic nodes
		if node.has_method("set_global_position"):
			node.set_global_position(target)
		else:
			node.global_position = target

	# Notify EnemyWalk (if present) so it can update facing/FX based on motion
	var walk := _find_enemy_walk_recursive(node)
	if walk and walk.has_method("apply_server_snapshot"):
		var cur = node.global_position
		walk.call_deferred("apply_server_snapshot", {
			"pos": {"x": cur.x, "y": cur.y},
			"target": {"x": target.x, "y": target.y}
		})

func _get_base_speed(node: Node) -> float:
	var spd := DEFAULT_SPEED
	if "data" in node and typeof(node.data) == TYPE_DICTIONARY:
		var stats := node.data.get("stats", {}) as Dictionary
		if typeof(stats) == TYPE_DICTIONARY and stats.has("spd"):
			spd = float(stats["spd"])
	return spd

func _find_enemy_walk_recursive(node: Node) -> Node:
	if node == null:
		return null
	for child in node.get_children():
		if child is EnemyWalk:
			return child
		var found := _find_enemy_walk_recursive(child)
		if found:
			return found
	return null
