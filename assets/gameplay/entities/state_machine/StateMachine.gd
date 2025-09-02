extends Node
class_name StateMachine

@export var server_authoritative := true
@export var current_state: Node
var states := {}

func _ready() -> void:
	states.clear()
	for child in get_children():
		# Collect children as states; names become keys ("idle", "walk", etc.)
		states[child.name.to_lower()] = child
		# Keep wiring if you want, but we'll ignore local transitions in server mode.
		if child.has_signal("Transitioned"):
			if child.Transitioned.is_connected(_on_child_transition):
				child.Transitioned.disconnect(_on_child_transition)
			child.Transitioned.connect(_on_child_transition)

	# Optional: pick a default so visuals aren’t blank
	if states.has("idle"):
		_apply("idle", {})

func _process(delta: float) -> void:
	if current_state and current_state.has_method("_update"):
		current_state._update(delta)

func _physics_process(delta: float) -> void:
	if current_state and current_state.has_method("_physics_update"):
		current_state._physics_update(delta)

# Block client-driven transitions when server_authoritative
func _on_child_transition(new_state_name := "") -> void:
	if server_authoritative:
		return
	if typeof(new_state_name) == TYPE_STRING and new_state_name != "":
		_apply(new_state_name, {})

# --- this is the door the server uses ---
func apply_state(stateName: String, payload := {}) -> void:
	_apply(stateName, payload)

func _apply(stateName: String, payload := {}) -> void:
	var next = states.get(stateName.to_lower())
	if next == null:
		push_warning("Unknown state: %s" % stateName)
		return
	if current_state and current_state.has_method("_exit"):
		current_state._exit()
	current_state = next
	get_parent().current_state = current_state.name
	# If your states want data from server, you can read it from the FSM each frame:
	self.set_meta("last_payload", payload)
	if current_state.has_method("_enter"):
		current_state._enter()
