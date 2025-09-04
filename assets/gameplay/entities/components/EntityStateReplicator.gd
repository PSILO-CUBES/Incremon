extends Node

var entity_id: String
@export var event_name := "entityStateUpdate"
@onready var sm := $"../StateMachine"

func _ready() -> void:
	WebSocketClient.register_handler(event_name, Callable(self, "_on_state_update"))
	entity_id = get_parent().entity_id

func _on_state_update(payload: Dictionary) -> void:
	# WebSocketClient already passes the *inner* payload here.
	# Shape: { entityId, state, dir?, ... }
	if payload.get("entityId","") != entity_id:
		return

	var s = payload.get("state","")
	if s == "":
		return

	# Pass the FULL payload to the FSM so states can read 'last_payload' (e.g., dir)
	if sm and sm.has_method("apply_state"):
		sm.apply_state(s, payload)
