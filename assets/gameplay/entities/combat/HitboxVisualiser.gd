extends Node
class_name HitboxVisualizer

@export var visual_scene: PackedScene = preload("res://assets/gameplay/entities/combat/SwingHitboxVisual.tscn")

const RectHitboxVisual = preload("res://assets/gameplay/entities/combat/RectHitboxVisual.gd")
const SwingHitboxVisual = preload("res://assets/gameplay/entities/combat/SwingHitboxVisual.gd")

func _ready() -> void:
	WebSocketClient.register_handler("hitboxSpawned", Callable(self, "_on_hitbox_spawned"))

func _exit_tree() -> void:
	WebSocketClient.unregister_handler("hitboxSpawned", Callable(self, "_on_hitbox_spawned"))

func _on_hitbox_spawned(payload: Dictionary) -> void:
	var entity_id := str(payload.get("entityId", ""))
	if entity_id == "":
		return

	var hb_type := ""
	if payload.has("type"):
		hb_type = str(payload.get("type"))
	else:
		if payload.has("widthPx") or payload.has("heightPx"):
			hb_type = "rect"
		else:
			hb_type = "cone"

	var owner_node := _find_entity_node(entity_id)

	var visual: Node2D = null
	if hb_type == "rect":
		visual = RectHitboxVisual.new()
	elif hb_type == "cone":
		if visual_scene != null:
			visual = visual_scene.instantiate()
		else:
			visual = SwingHitboxVisual.new()
	else:
		if payload.has("widthPx") or payload.has("heightPx"):
			visual = RectHitboxVisual.new()
		else:
			if visual_scene != null:
				visual = visual_scene.instantiate()
			else:
				visual = SwingHitboxVisual.new()

	if owner_node != null and owner_node.is_inside_tree():
		owner_node.add_child(visual)
	else:
		add_child(visual)

	if visual != null and visual.has_method("setup"):
		visual.setup(owner_node, payload)

func _find_entity_node(entity_id: String) -> Node2D:
	var root: Node = get_tree().current_scene
	if root == null:
		root = get_tree().get_root()
	return _find_entity_node_recursive(root, entity_id)

func _find_entity_node_recursive(node: Node, entity_id: String) -> Node2D:
	for c in node.get_children():
		if c is Node2D:
			if "entity_id" in c:
				var val := ""
				val = str(c.get("entity_id"))
				if val == entity_id:
					return c
		var found := _find_entity_node_recursive(c, entity_id)
		if found != null:
			return found
	return null
