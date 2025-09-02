extends WalkState
class_name EnemyWalk

# Movement speed cached from server-provided stats (entity.data.spd)
var _speed: float = 60.0
var _entity: Node = null

func _ready() -> void:
	_entity = _find_entity_root()
	_refresh_speed()

func _enter() -> void:
	super._enter()
	# If your FSM calls _enter on activation
	_refresh_speed()

func _physics_update(dt: float) -> void:
	super._physics_update(dt)
	
	if _entity == null:
		return

	# Read desired direction set by controllers/net (Vector2 or null)
	var dir_val = _entity.get("move_dir")  # safe even if property missing → null
	var dir: Vector2 = Vector2.ZERO
	if typeof(dir_val) == TYPE_VECTOR2:
		dir = dir_val

	var vel: Vector2 = dir * _speed

	# Single source of truth: apply motion here
	if _entity is CharacterBody2D:
		_entity.velocity = vel
		_entity.move_and_slide()
	else:
		# Fallback if you aren't using CharacterBody2D
		if _entity.has_method("get_global_position") and _entity.has_method("set_global_position"):
			var p: Vector2 = _entity.get_global_position()
			_entity.set_global_position(p + vel * dt)

# --- Helpers ---------------------------------------------------------------

func _find_entity_root() -> Node:
	# Walk up until we find a node that *looks like* an entity:
	# - has 'move_dir' (Vector2) and 'data' (Dictionary with 'spd')
	var n: Node = get_parent()
	while n:
		var md = n.get("move_dir") if n.has_method("get") else null
		var data = n.get("data") if n.has_method("get") else null
		if typeof(md) == TYPE_VECTOR2 and typeof(data) == TYPE_DICTIONARY:
			return n
		n = n.get_parent()
	return null

func _refresh_speed() -> void:
	if _entity == null:
		return
	var d = _entity.get("data")  # Dictionary or null
	if typeof(d) == TYPE_DICTIONARY and d.has("spd"):
		_speed = float(d["spd"])
