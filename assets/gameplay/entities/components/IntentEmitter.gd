extends Node

var entity_id: String = ""

const INTENT_TO_ACTION := {
	"moveStart": "moveIntentStart",
	"moveStop":  "moveIntentStop",
	"attack":    "attackIntentStart",
}

func _ready() -> void:
	entity_id = str(get_parent().entity_id)

func send_intent(intent: String, payload: Dictionary = {}) -> void:
	if entity_id == "":
		return
	var action = INTENT_TO_ACTION.get(intent, "")
	if action == "":
		return
	var msg := {
		"action": action,
		"entityId": entity_id,
	}
	for k in payload.keys():
		msg[k] = payload[k]
	WebSocketClient.send_action(action, msg)

func move_start(dir: Vector2) -> void:
	send_intent("moveStart", {"dir": {"x": dir.x, "y": dir.y}})

func move_stop() -> void:
	send_intent("moveStop")

func attack_start(pos) -> void:
	# Do NOT send moveStop here — the server freezes movement during attack
	# and will auto-resume if the player was moving.
	send_intent("attack", {"pos": {"x": pos.x, "y": pos.y}})
