extends WalkState
class_name PlayerWalk

var was_moving := false
var emitter: Node = null   # <-- declare emitter so we can call emitter.move_stop()

func _enter() -> void:
	super._enter()
	_print_client_collider_info_once()

func _physics_update(delta: float) -> void:
	super._physics_update(delta)

	var dir := Vector2.ZERO
	if Input.is_action_pressed("move_right"):
		dir.x += 1
	if Input.is_action_pressed("move_left"):
		dir.x -= 1
	if Input.is_action_pressed("move_down"):
		dir.y += 1
	if Input.is_action_pressed("move_up"):
		dir.y -= 1

	var moving_now := dir != Vector2.ZERO

	if moving_now:
		if not was_moving:
			print("[CLIENT] local startMove pos=", entity.global_position, " dir=", dir)
		entity.move_dir = dir.normalized()
	else:
		if was_moving:
			print("[CLIENT] local stopMove pos=", entity.global_position)
			entity.move_dir = Vector2.ZERO
			entity.velocity = Vector2.ZERO
			if emitter and emitter.has_method("move_stop"):
				print("[CLIENT] calling emitter.move_stop()")
				emitter.move_stop()

	entity.velocity = entity.move_dir * entity.data.stats.spd

	if entity.has_method("move_and_slide"):
		entity.move_and_slide()

		# Log slide collisions this frame
		if entity.has_method("get_slide_collision_count"):
			var cc: int = entity.get_slide_collision_count()
			if cc > 0:
				var i := 0
				while i < cc:
					var col: KinematicCollision2D = entity.get_slide_collision(i)
					if col:
						var collider_name := ""
						if col.get_collider():
							collider_name = col.get_collider().name
						print("[CLIENT] collided with=", collider_name, " at=", col.get_position(), " normal=", col.get_normal())
					i += 1

	was_moving = moving_now

# --- helpers -----------------------------------------------------------------

var _collider_printed := false

func _print_client_collider_info_once() -> void:
	if _collider_printed:
		return
	_collider_printed = true

	var shape: Shape2D = null
	var colliders = entity.find_children("*", "CollisionShape2D", true, false)
	if colliders.size() > 0:
		var cs: CollisionShape2D = colliders[0]
		shape = cs.shape

	if shape == null:
		print("[CLIENT] collider: not found (no Shape2D assigned)")
		return

	if shape is CircleShape2D:
		print("[CLIENT] collider: Circle radius=", shape.radius)
	elif shape is CapsuleShape2D:
		print("[CLIENT] collider: Capsule radius=", shape.radius, " height=", shape.height)
	elif shape is RectangleShape2D:
		print("[CLIENT] collider: Rect extents=", shape.extents)
	elif shape is ConvexPolygonShape2D:
		print("[CLIENT] collider: ConvexPolygon points_count=", shape.points.size())
	elif shape is ConcavePolygonShape2D:
		print("[CLIENT] collider: ConcavePolygon segments_count=", shape.get_segments().size())
	else:
		print("[CLIENT] collider: ", shape.get_class())

func _find_first_shape2d(root: Node) -> Shape2D:
	if root == null:
		return null
	for c in root.get_children():
		if c is CollisionShape2D and c.shape:
			return c.shape
		var sub := _find_first_shape2d(c)
		if sub != null:
			return sub
	return null
