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
		var payload: Dictionary = sm.get_meta("last_payload")
		if payload.has("pos"):
			var p = payload.get("pos")
			if typeof(p) == TYPE_DICTIONARY:
				var x := float(p.get("x", 0.0))
				var y := float(p.get("y", 0.0))
				aim_pos = Vector2(x, y)
				got = true

	if not got:
		var viewport := get_viewport()
		var camera := viewport.get_camera_2d()
		if camera:
			aim_pos = camera.get_global_mouse_position()

	if entity and entity.animation_sprite:
		var dx = aim_pos.x - entity.global_position.x
		if abs(dx) > 0.001:
			var facing_left = dx < 0.0
			entity.animation_sprite.flip_h = facing_left
			entity.last_facing_left = facing_left

func _exit():
	super._exit()
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if dir != Vector2.ZERO:
		if emitter and emitter.has_method("move_start"):
			emitter.move_start(dir.normalized())
	else:
		# Explicitly tell server that movement is not being held anymore
		if emitter and emitter.has_method("move_stop"):
			emitter.move_stop()

func _physics_update(delta):
	super._physics_update(delta)
