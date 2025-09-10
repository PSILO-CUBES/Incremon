extends WalkState
class_name EnemyWalk

var _base_speed: float
var _prev_pos: Vector2 = Vector2.ZERO
var _has_prev: bool = false

func _enter() -> void:
	super._enter()
	_refresh_speed()
	# Ensure walk anim plays while snapshots move the body
	if entity and entity.has_anim("walk"):
		entity.animation_sprite.play("walk")

func _exit() -> void:
	super._exit()

func _physics_update(_delta: float) -> void:
	# We do NOT move here anymore. WorldPosApplier already set global_position
	# from authoritative snapshots. Keep velocity near zero so base WalkState
	# doesn't try to steer or create extra slide.
	if entity:
		entity.velocity = Vector2.ZERO
	# super handles flip if velocity changed; we handle facing from snapshots in apply_server_snapshot()

func _refresh_speed() -> void:
	if entity and typeof(entity.data) == TYPE_DICTIONARY:
		var stats := entity.data.get("stats", {}) as Dictionary
		if typeof(stats) == TYPE_DICTIONARY and stats.has("spd"):
			_base_speed = float(stats["spd"])

# Called by WorldPosApplier every time we apply a smoothed server position.
# Use this to keep the sprite's facing coherent with actual motion.
func apply_server_snapshot(snapshot: Dictionary) -> void:
	if entity == null:
		return

	var pos_d := snapshot.get("pos", {}) as Dictionary
	var server_pos := Vector2(float(pos_d.get("x", 0.0)), float(pos_d.get("y", 0.0)))

	if _has_prev:
		var dx := server_pos.x - _prev_pos.x
		if absf(dx) > 0.1:
			entity.last_facing_left = dx < 0.0
			entity.animation_sprite.flip_h = entity.last_facing_left

	_prev_pos = server_pos
	_has_prev = true
