extends Node2D

@onready var map_root: Node = self

const MAPS := {
	"area1/m1": "res://assets/gameplay/maps/area1/m1.tscn"
}

const PLAYER_SCENE := preload("res://assets/gameplay/entities/player/Player.tscn")
const TokenStorage = preload("res://assets/network/scripts/TokenStorage.gd")

# --- Net sync tuning (you can tweak) ---
const INTERP_DELAY_MS := 150     # how far "behind" we render remote entities
const BUFFER_LIMIT := 50         # max buffered snapshots per entity
const HARD_SNAP_DIST := 64.0     # if local error > this, teleport
const SOFT_ALPHA := 0.15         # small blend when correcting local drift

var _local_player: Node2D
var _player_entity_id: String = ""

# entity_id -> Array[Dictionary{t:int, pos:Vector2}]
var _remote_buffers: Dictionary = {}

func _ready() -> void:
	WebSocketClient.register_handler("worldInit", Callable(self, "_on_world_init"))
	WebSocketClient.register_handler("worldInitFailed", Callable(self, "_on_world_init_failed"))
	WebSocketClient.register_handler("playerSpawn", Callable(self, "_on_player_spawn"))
	WebSocketClient.register_handler("changePosition", Callable(self, "_on_change_position"))
	WebSocketClient.register_handler("entitySpawned", Callable(self, "_on_entity_spawn"))
	WebSocketClient.send_action("worldEnter")

func _exit_tree() -> void:
	WebSocketClient.unregister_handler("worldInit", Callable(self, "_on_world_init"))
	WebSocketClient.unregister_handler("worldInitFailed", Callable(self, "_on_world_init_failed"))
	WebSocketClient.unregister_handler("playerSpawn", Callable(self, "_on_player_spawn"))
	WebSocketClient.unregister_handler("changePosition", Callable(self, "_on_change_position"))
	WebSocketClient.unregister_handler("entitySpawned", Callable(self, "_on_entity_spawn"))

func _physics_process(_dt: float) -> void:
	var now_ms: int = Time.get_ticks_msec()
	var target_time: int = now_ms - INTERP_DELAY_MS

	for eid in _remote_buffers.keys():
		var buf: Array = _remote_buffers[eid]
		if buf.is_empty():
			continue

		buf.sort_custom(func(a, b): return a.t < b.t)

		while buf.size() > 2 and buf[1].t <= target_time:
			buf.pop_front()

		var node := _get_entity_node(eid)
		if node == null:
			continue

		if buf.size() == 1:
			node.global_position = buf[0].pos
		else:
			var a = buf[0]
			var b = buf[1]
			var span := float(max(1, b.t - a.t))
			var t = clamp((target_time - a.t) / span, 0.0, 1.0)
			var p = a.pos.lerp(b.pos, t)
			node.global_position = p

func _on_world_init(payload: Dictionary) -> void:
	var map_id: String = str(payload.get("mapId", "area1/m1"))
	var scene_path: String = MAPS.get(map_id, "")
	if scene_path == "":
		push_error("Unknown map id from server: %s" % map_id)
		return

	var packed := load(scene_path) as PackedScene
	if packed == null:
		push_error("Failed to load scene: %s" % scene_path)
		return

	var instance := packed.instantiate()
	map_root.add_child(instance)
	
	WebSocketClient.send_action("worldReady", {"mapId": map_id})

func _on_world_init_failed(payload: Dictionary) -> void:
	push_error(str(payload.get("message", "world init failed")))

func _on_player_spawn(payload: Dictionary) -> void:
	_player_entity_id = str(payload.get("entityId", ""))
	
	if _local_player and is_instance_valid(_local_player):
		_local_player.queue_free()
	
	var player_scene: PackedScene = PLAYER_SCENE
	if player_scene == null:
		push_error("PLAYER_SCENE not found")
		return
	
	_local_player = player_scene.instantiate()
	_local_player.add_to_group("LocalPlayer")
	_local_player.entity_id = _player_entity_id
	_local_player.data = payload.get("playerData", {})
	_local_player.get_node("UsernameLabel").text = TokenStorage.get_username()
	
	if _local_player.data == {}:
		push_error("Somehow no player data was found")
	
	if map_root.has_node("AlliedEntities"):
		map_root.get_node("AlliedEntities").add_child(_local_player)
	else:
		map_root.add_child(_local_player)
	
	var s: Dictionary = payload.get("spawn", {}) as Dictionary
	var spawn := Vector2(float(s.get("x", 0.0)), float(s.get("y", 0.0)))
	if _local_player.has_method("set_position"):
		_local_player.set_position(spawn)
	elif "global_position" in _local_player:
		_local_player.global_position = spawn
	
	WebSocketClient.send_action("playerSpawnAck", {"entityId": _player_entity_id})

func _on_change_position(payload: Dictionary) -> void:
	var eid := str(payload.get("entityId", ""))
	var pos_d: Dictionary = payload.get("pos", {}) as Dictionary
	var server_pos := Vector2(float(pos_d.get("x", 0.0)), float(pos_d.get("y", 0.0)))
	var ts: int = int(payload.get("ts", Time.get_ticks_msec()))

	if eid == _player_entity_id and _local_player and _is_player_in_manual_mode(_local_player):
		_reconcile_local(server_pos)
		return

	if not _remote_buffers.has(eid):
		_remote_buffers[eid] = []
	var buf: Array = _remote_buffers[eid]
	buf.append({ "t": ts, "pos": server_pos })
	if buf.size() > BUFFER_LIMIT:
		buf.pop_front()

func _on_entity_spawn(payload: Dictionary) -> void:
	# Server payload:
	# { event:"entitySpawn", entityId, entity:{ pos:{x,y}, mobType, scenePath, stats?, ... } }
	var eid := str(payload.get("entityId", ""))
	var ent: Dictionary = payload.get("entity", {}) as Dictionary

	var p: Dictionary = ent.get("pos", {}) as Dictionary
	var pos := Vector2(float(p.get("x", 0.0)), float(p.get("y", 0.0)))

	var scene_path: String = str(ent.get("scenePath", ""))
	if scene_path == "":
		push_warning("No scenePath for mob '%s' (eid=%s) — using placeholder." % [str(ent.get("mobType","")), eid])
		var placeholder := Node2D.new()
		placeholder.set("entity_id", eid)
		placeholder.name = "Mob_%s" % eid
		placeholder.global_position = pos
		if map_root.get_node("Map").has_node("EnemyEntities"):
			map_root.get_node("Map").get_node("EnemyEntities").add_child(placeholder)
		else:
			map_root.add_child(placeholder)
	else:
		var packed := load(scene_path) as PackedScene
		if packed == null:
			push_error("Failed to load mob scene: %s" % scene_path)
			return
		var mob := packed.instantiate() as Node2D
		mob.set("entity_id", eid)
		var stats = payload.entity.stats
		stats['maxHp'] = payload.entity.stats.hp
		mob.set("data", {
			'type' = payload.entity.mobType,
			'stats' = stats
		})
		
		if ent.has("stats"):
			mob.set("stats", ent.get("stats"))
		mob.global_position = pos
		if map_root.get_node("Map").has_node("EnemyEntities"):
			map_root.get_node("Map").get_node("EnemyEntities").add_child(mob)
		else:
			map_root.add_child(mob)

	# Seed interpolation buffer so it renders immediately and smooths afterward
	if not _remote_buffers.has(eid):
		_remote_buffers[eid] = []
	var buf: Array = _remote_buffers[eid]
	buf.append({ "t": Time.get_ticks_msec(), "pos": pos })
	if buf.size() > BUFFER_LIMIT:
		buf.pop_front()

# --- Helpers ---

func _reconcile_local(server_pos: Vector2) -> void:
	if not _local_player:
		return
	var client_pos: Vector2 = _local_player.global_position
	var delta := server_pos - client_pos
	var dist := delta.length()

	if dist > HARD_SNAP_DIST:
		_local_player.global_position = server_pos
	else:
		_local_player.global_position = client_pos.lerp(server_pos, SOFT_ALPHA)

func _is_player_in_manual_mode(p: Node) -> bool:
	var v = p.get("auto_mode")
	if v != null:
		return not bool(v)
	return p.is_in_group("LocalPlayer")

func _get_entity_node(eid: String) -> Node2D:
	if _local_player and eid == _player_entity_id and not _is_player_in_manual_mode(_local_player):
		return _local_player

	if map_root.has_node("AlliedEntities"):
		var allies := map_root.get_node("AlliedEntities")
		for c in allies.get_children():
			if "entity_id" in c and str(c.entity_id) == eid:
				return c

	if map_root.get_node("Map").has_node("EnemyEntities"):
		var foes := map_root.get_node("Map").get_node("EnemyEntities")
		for c in foes.get_children():
			if "entity_id" in c and str(c.entity_id) == eid:
				return c

	return null
