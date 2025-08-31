extends Node2D

@onready var map_root: Node = self

const MAPS := { "area1/m1": "res://assets/gameplay/maps/area1/m1.tscn" }
const PLAYER_SCENE := preload("res://assets/gameplay/entities/player/Player.tscn")

const TokenStorage = preload("res://assets/network/scripts/TokenStorage.gd")

var _local_player: Node
var _player_entity_id: String = ""

func _ready() -> void:
	WebSocketClient.register_handler("worldInit", Callable(self, "_on_world_init"))
	WebSocketClient.register_handler("worldInitFailed", Callable(self, "_on_world_init_failed"))
	WebSocketClient.register_handler("playerSpawn", Callable(self, "_on_player_spawn"))
	
	WebSocketClient.send_action("worldEnter")

func _exit_tree() -> void:
	WebSocketClient.unregister_handler("worldInit", Callable(self, "_on_world_init"))
	WebSocketClient.unregister_handler("worldInitFailed", Callable(self, "_on_world_init_failed"))
	WebSocketClient.unregister_handler("playerSpawn", Callable(self, "_on_player_spawn"))

func _on_world_init(payload: Dictionary) -> void:
	var map_id = payload.get("mapId", "area1/m1")
	var scene_path = MAPS.get(map_id, "")
	if scene_path == "":
		push_error("Unknown map id from server: %s" % map_id)
		return

	var packed: PackedScene = load(scene_path)
	if packed == null:
		push_error("Failed to load scene: %s" % scene_path)
		return

	var instance := packed.instantiate()
	map_root.add_child(instance)

	WebSocketClient.send_action("worldReady", {"mapId": map_id})

func _on_world_init_failed(payload: Dictionary) -> void:
	push_error(payload.get("message", "world init failed"))

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
	
	map_root.get_node('AlliedEntities').add_child(_local_player)

	var s = payload.get("spawn", {})
	var spawn := Vector2(s.get("x", 0.0), s.get("y", 0.0))

	if _local_player.has_method("set_position"):
		_local_player.set_position(spawn)
	elif "global_position" in _local_player:
		_local_player.global_position = spawn

	WebSocketClient.send_action("playerSpawnAck", {"entityId": _player_entity_id})
