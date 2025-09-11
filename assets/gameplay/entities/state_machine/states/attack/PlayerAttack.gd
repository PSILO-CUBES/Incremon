extends AttackState
class_name PlayerAttack

var emitter: Node

func _enter():
	super._enter()
	emitter = null
	if entity and entity.has_node("IntentEmitter"):
		emitter = entity.get_node("IntentEmitter")

	var aim_pos := Vector2.ZERO
	var got := false

	var sm := get_parent()
	if sm and sm.has_meta("last_payload"):
		var p = sm.get_meta("last_payload")
		if typeof(p) == TYPE_DICTIONARY and p.has("pos"):
			var v = p.get("pos")
			if typeof(v) == TYPE_DICTIONARY and v.has("x") and v.has("y"):
				aim_pos = Vector2(float(v.x), float(v.y))
				got = true

	if not got and entity and entity.has_method("get_global_mouse_position"):
		aim_pos = entity.get_global_mouse_position()
		got = true

	if got and entity and entity.animation_sprite:
		var dx = aim_pos.x - entity.global_position.x
		if abs(dx) > 0.001:
			var facing_left = dx < 0.0
			entity.animation_sprite.flip_h = facing_left
			entity.last_facing_left = facing_left

func _exit():
	super._exit()
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if dir != Vector2.ZERO and emitter and emitter.has_method("move_start"):
		emitter.move_start(dir.normalized())

func _physics_update(delta):
	super._physics_update(delta)
