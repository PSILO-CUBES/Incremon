extends Node2D

@onready var map_root: Node = self

const MAPS := {
	# FIX: match actual file casing in repo
	"area1/m1": "res://assets/gameplay/maps/Area1/M1/M1.tscn"
}

const PLAYER_SCENE := preload("res://assets/gameplay/entities/player/Player.tscn")
const TokenStorage = preload("res://assets/network/scripts/TokenStorage.gd")
# WorldPosApplier has class_name, but preload is fine too if you prefer:
const WorldPosApplier = preload("res://assets/gameplay/world/WorldPosApplier.gd")

const INTERP_DELAY_MS := 150
const BUFFER_LIMIT := 50

var _pos_applier: WorldPosApplier
var _remote_buffers := {}                # eid -> Array[{ t:int, pos:Vector2 }]
var _local_player: Node2D = null
var _player_entity_id: String = ""

func _ready() -> void:
	_pos_applier = WorldPosApplier.new()
	add_child(_pos_applier)

	WebSocketClient.register_handler("worldInit", Callable(self, "_on_world_init"))
	WebSocketClient.register_handler("worldInitFailed", Callable(self, "_on_world_init_failed"))
	WebSocketClient.register_handler("playerSpawn", Callable(self, "_on_player_spawn"))
	WebSocketClient.register_handler("changePosition", Callable(self, "_on_change_position"))
	WebSocketClient.register_handler("entitySpawned", Callable(self, "_on_entity_spawn"))

	# FIX: kick the world handshake; server replies with worldInit
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

		# Keep the buffer ordered and trim old points ahead of our target time
		buf.sort_custom(func(a, b): return a.t < b.t)
		while buf.size() > 2 and buf[1].t <= target_time:
			buf.pop_front()

		var node := _get_entity_node(eid)
		if node == null:
			continue

		# Route through applier so EnemyWalk can reconcile server snapshots
		_pos_applier.apply_node_pos_from_buffer(node, buf, target_time)

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

	# Tell server we finished loading the map so it can send playerSpawn
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

	var name_label := _local_player.get_node_or_null("UsernameLabel")
	if name_label:
		name_label.text = TokenStorage.get_username()

	if _local_player.data == {}:
		push_warning("No player data on spawn payload")

	if map_root.has_node("AlliedEntities"):
		map_root.get_node("AlliedEntities").add_child(_local_player)
	else:
		map_root.add_child(_local_player)

	var s: Dictionary = payload.get("spawn", {}) as Dictionary
	var spawn := Vector2(float(s.get("x", 0.0)), float(s.get("y", 0.0)))
	if _local_player.has_method("set_position"):
		_local_player.set_position(spawn)
	else:
		_local_player.global_position = spawn

	# ACK so server stops resending spawn and marks hasSpawned
	WebSocketClient.send_action("playerSpawnAck", {"entityId": _player_entity_id})

func _on_change_position(payload: Dictionary) -> void:
	var eid := str(payload.get("entityId", ""))
	var pos_d: Dictionary = payload.get("pos", {}) as Dictionary
	var server_pos := Vector2(float(pos_d.get("x", 0.0)), float(pos_d.get("y", 0.0)))
	# CRUCIAL: use server timestamp if present
	var ts: int = int(pos_d.get("t", Time.get_ticks_msec()))

	# Local player → reconcile only; mobs go through buffer
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
	var eid := str(payload.get("entityId", ""))  # note: server sometimes wraps under entity.entityId
	var ent: Dictionary = payload.get("entity", {}) as Dictionary
	if eid == "" and ent.has("entityId"):
		eid = str(ent.get("entityId", ""))

	var p: Dictionary = ent.get("pos", {}) as Dictionary
	var pos := Vector2(float(p.get("x", 0.0)), float(p.get("y", 0.0)))

	var scene_path: String = str(ent.get("scenePath", ""))
	var node_to_add: Node2D = null

	if scene_path == "":
		var placeholder := Node2D.new()
		placeholder.set("entity_id", eid)
		placeholder.name = "Mob_%s" % eid
		placeholder.global_position = pos
		node_to_add = placeholder
	else:
		var packed := load(scene_path) as PackedScene
		if packed == null:
			push_error("Failed to load mob scene: %s" % scene_path)
			return
		var mob := packed.instantiate() as Node2D
		mob.set("entity_id", eid)
		mob.name = "Mob_%s" % eid

		var stats: Dictionary = ent.get("stats", {})
		var spd_val := float(stats.get("spd", 60.0))
		var hp_val := int(stats.get("hp", 5))
		mob.set("data", {
			"type": str(ent.get("mobType","")),
			"stats": { "spd": spd_val, "hp": hp_val, "atk": int(stats.get("atk", 1)) }
		})

		mob.global_position = pos
		node_to_add = mob

	if map_root.has_node("Map") and map_root.get_node("Map").has_node("EnemyEntities"):
		map_root.get_node("Map").get_node("EnemyEntities").add_child(node_to_add)
	else:
		map_root.add_child(node_to_add)

	# Seed buffer so applier has a baseline
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
	var me := _local_player as CharacterBody2D
	if me == null:
		_local_player.global_position = server_pos
		return
	var err := server_pos - me.global_position
	if err.length() > 64.0:
		me.global_position = server_pos
		me.velocity = Vector2.ZERO

func _is_player_in_manual_mode(_node: Node) -> bool:
	return true

func _get_entity_node(eid: String) -> Node2D:
	if _local_player and str(_local_player.get("entity_id")) == eid:
		return _local_player

	if map_root.has_node("AlliedEntities"):
		var allies := map_root.get_node("AlliedEntities")
		for c in allies.get_children():
			if "entity_id" in c and str(c.entity_id) == eid:
				return c

	if map_root.has_node("Map") and map_root.get_node("Map").has_node("EnemyEntities"):
		var foes := map_root.get_node("Map").get_node("EnemyEntities")
		for c in foes.get_children():
			if "entity_id" in c and str(c.entity_id) == eid:
				return c

	return null
