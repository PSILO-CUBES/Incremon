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

	var owner_node = _find_entity_node(get_tree().get_root(), entity_id)
	if owner_node == null:
		owner_node = get_tree().get_root()

	var vtype := str(payload.get("shapeType", "cone"))
	var visual: Node2D = null

	if vtype == "rect":
		if rect_scene != null:
			visual = rect_scene.instantiate()
		else:
			visual = RectHitboxVisual.new()
	else:
		if swing_scene != null:
			visual = swing_scene.instantiate()
		else:
			visual = SwingHitboxVisual.new()

	if visual == null:
		return

	# --- SIMPLE BUFFER FIX ---
	# Derive how long the hitbox has been alive *at the moment we received it*
	# using epoch ms. Then reuse your existing visual logic that backdates from
	# elapsedAtSendMs by overriding it here.
	var start_ms := int(payload.get("startMs", 0))
	var epoch_now_ms := int(Time.get_unix_time_from_system() * 1000.0)
	var elapsed_at_recv_ms := epoch_now_ms - start_ms
	if elapsed_at_recv_ms < 0:
		elapsed_at_recv_ms = 0

	# Overwrite the field your visuals already read for backdating
	payload["elapsedAtSendMs"] = elapsed_at_recv_ms

	# Optional debug to verify
	var recv_now_ticks := Time.get_ticks_msec()
	print(JSON.stringify({
		"tag": "clientHitboxSpawned",
		"entity_id": entity_id,
		"shape_type": vtype,
		"start_ms": start_ms,
		"elapsed_at_recv_ms": elapsed_at_recv_ms,
		"recv_now_ticks": recv_now_ticks
	}))

	if owner_node != null and owner_node.is_inside_tree():
		owner_node.add_child(visual)
	else:
		add_child(visual)

	if "setup" in visual:
		visual.call("setup", owner_node, payload)
	
	print("DEBUG buffer filled: elapsedAtSendMs =", payload["elapsedAtSendMs"])


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
