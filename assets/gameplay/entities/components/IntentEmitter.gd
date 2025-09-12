extends Node

var entity_id: String = ""

const INTENT_TO_ACTION := {
	"moveStart": "moveIntentStart",
	"moveStop":  "moveIntentStop",
	"attack":    "attackIntentStart",
}

var next_attack_time_ms: int = 0
const ATTACK_COOLDOWN_MS := 1000

func _ready() -> void:
	entity_id = str(get_parent().entity_id)

func _now_ms() -> int:
	return Time.get_ticks_msec()

func send_intent(intent: String, payload: Dictionary = {}) -> void:
	if entity_id == "":
		return

	var action = INTENT_TO_ACTION.get(intent, intent)
	var msg := {
		"entityId": entity_id
	}

	for k in payload.keys():
		msg[k] = payload[k]

	WebSocketClient.send_action(action, msg)

func move_start(dir: Vector2) -> void:
	send_intent("moveStart", {"dir": {"x": dir.x, "y": dir.y}})

func move_stop() -> void:
	send_intent("moveStop")

func attack_start(pos: Vector2) -> void:
	# Local spam guard to match server cooldown
	var now := _now_ms()
	if now < next_attack_time_ms:
		return

	# Do NOT send moveStop here — the server freezes movement during attack
	# and will auto-resume if the player was moving.
	send_intent("attack", {"pos": {"x": pos.x, "y": pos.y}})

	# Begin local cooldown window immediately after sending intent
	next_attack_time_ms = now + ATTACK_COOLDOWN_MS
