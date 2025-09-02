extends Node

var entity_id: String = ""

# Map high-level intents to the *wire* action names your server expects.
const INTENT_TO_ACTION := {
	"moveStart": "moveIntentStart",
	"moveStop":  "moveIntentStop",
}

func _ready() -> void:
	entity_id = str(get_parent().entity_id)

func send_intent(intent: String, payload: Dictionary = {}) -> void:
	if entity_id == "":
		return
	var action = INTENT_TO_ACTION.get(intent, "")
	if action == "":
		push_warning("Unknown intent: %s" % intent)
		return

	var msg := {"entityId": entity_id}
	# Shallow-merge payload keys (e.g., {"dir": {...}})
	for k in payload.keys():
		msg[k] = payload[k]

	WebSocketClient.send_action(action, msg)

# Optional convenience wrappers, if you still want direct calls elsewhere
func move_start(dir: Vector2) -> void:
	send_intent("moveStart", {"dir": {"x": dir.x, "y": dir.y}})

func move_stop() -> void:
	send_intent("moveStop")
