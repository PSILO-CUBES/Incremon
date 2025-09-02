extends Node

var entity_id: String
@export var event_name := "entityStateUpdate"
@onready var sm := $"../StateMachine"

func _ready() -> void:
	WebSocketClient.register_handler(event_name, Callable(self, "_on_state_update"))
	entity_id = get_parent().entity_id

func _on_state_update(payload: Dictionary) -> void:
	if payload.get("entityId","") != entity_id:
		return
	
	var s = payload.get("state","")
	if s == "": return
	var data = payload.get("payload", {})
	if sm and sm.has_method("apply_state"):
		sm.apply_state(s, data)
