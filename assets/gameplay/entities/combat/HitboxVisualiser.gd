extends Node
class_name HitboxVisualizer

@export var swing_scene: PackedScene = preload("res://assets/gameplay/entities/combat/SwingHitboxVisual.tscn")
@export var rect_scene: PackedScene  = preload("res://assets/gameplay/entities/combat/RectHitboxVisual.tscn")

func _ready() -> void:
	WebSocketClient.register_handler("hitboxSpawned", Callable(self, "_on_hitbox_spawned"))

func _exit_tree() -> void:
	WebSocketClient.unregister_handler("hitboxSpawned", Callable(self, "_on_hitbox_spawned"))

func _on_hitbox_spawned(payload: Dictionary) -> void:
	var entity_id := str(payload.get("entityId", ""))
	if entity_id == "":
		return

	# Find the live owner entity in the scene
	var world_root := get_tree().get_current_scene()
	if world_root == null:
		return
	var owner := _find_entity_node(world_root, entity_id)
	if owner == null:
		return

	# Read common fields from server (server sends radians for baseAngle)
	var shape_type := str(payload.get("shapeType", ""))
	var elapsed_at_send_ms := int(payload.get("elapsedAtSendMs", 0))
	var duration_ms := int(payload.get("durationMs", 0))
	var base_angle := float(payload.get("baseAngle", 0.0))

	# Instance the correct visual
	var visual: Node2D = null
	if shape_type == "cone":
		visual = swing_scene.instantiate()
		visual.attack_owner = owner
		visual.radius_px = float(_get_any(payload, ["radiusPx", "rangePx"], 96.0))
		visual.arc_degrees = float(payload.get("arcDegrees", 90.0))
		visual.sweep_degrees = float(payload.get("sweepDegrees", 120.0))
		visual.duration_ms = duration_ms
		visual.base_angle = base_angle
		visual.elapsed_at_send_ms = elapsed_at_send_ms
	elif shape_type == "rect":
		visual = rect_scene.instantiate()
		visual.attack_owner = owner
		visual.width_px = float(payload.get("widthPx", 48.0))
		visual.height_px = float(payload.get("heightPx", 48.0))
		visual.offset_px = float(payload.get("offsetPx", 16.0))
		visual.duration_ms = duration_ms
		visual.base_angle = base_angle
		visual.elapsed_at_send_ms = elapsed_at_send_ms
	else:
		return

	# Parent alongside the owner (same world layer) to avoid double transforms.
	# We do not add as a child of the owner; the visual fetches owner.global_position to draw.
	var parent := owner.get_parent()
	if parent == null:
		parent = world_root
	parent.add_child(visual)
	visual.z_index = owner.z_index + 1

func _get_any(data: Dictionary, keys: Array, default_val) -> Variant:
	var i := 0
	while i < keys.size():
		var k := str(keys[i])
		if data.has(k):
			return data[k]
		i += 1
	return default_val

func _find_entity_node(root: Node, entity_id: String) -> Node2D:
	if root == null:
		return null
	if root is Node2D and "entity_id" in root:
		var val := str(root.get("entity_id"))
		if val == entity_id:
			return root
	for c in root.get_children():
		var found := _find_entity_node(c, entity_id)
		if found != null:
			return found
	return null
