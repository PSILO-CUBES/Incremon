extends Node

var entity_id: String

func _ready() -> void:
	entity_id = get_parent().entity_id

func move_start(dir: Vector2) -> void:
	if entity_id == "": return
	WebSocketClient.send_action("moveIntentStart", {
		"entityId": entity_id,
		"dir": {"x": dir.x, "y": dir.y}
	})

func move_stop() -> void:
	if entity_id == "": return
	WebSocketClient.send_action("moveIntentStop", {
		"entityId": entity_id
	})
