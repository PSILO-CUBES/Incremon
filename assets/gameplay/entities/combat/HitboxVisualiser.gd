extends Node
class_name HitboxVisualizer

@export var visual_scene: PackedScene = preload("res://assets/gameplay/entities/combat/SwingHitboxVisual.tscn")

func _ready() -> void:
	WebSocketClient.register_handler("hitboxSpawned", Callable(self, "_on_hitbox_spawned"))

func _exit_tree() -> void:
	WebSocketClient.unregister_handler("hitboxSpawned", Callable(self, "_on_hitbox_spawned"))

func _on_hitbox_spawned(payload: Dictionary) -> void:
	var entity_id := str(payload.get("entityId", ""))
	if entity_id == "":
		return

	var owner_node := _find_entity_node(entity_id)
	var visual := visual_scene.instantiate()
	if owner_node != null:
		owner_node.add_child(visual)
	else:
		add_child(visual)

	visual.setup(owner_node, payload)

func _find_entity_node(entity_id: String) -> Node2D:
	for n in get_tree().get_nodes_in_group("Entities"):
		if n is Node2D:
			var id_val := ""
			if n.has_method("get"):
				id_val = str(n.get("entity_id"))
			if id_val == entity_id:
				return n
	return null
