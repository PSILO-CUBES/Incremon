extends Camera2D

@export var player_path: NodePath

var player: Node2D
var map_rect: CollisionShape2D

func _ready():
	if player_path != null:
		player = get_node(player_path) as CharacterBody2D
	
	map_rect = get_tree().get_root().get_node("Game/World/Map/MapArea/MapShape") as CollisionShape2D

func _process(_delta):
	if player == null or map_rect == null:
		return
	
	var map_pos = map_rect.global_position
	var map_size = map_rect.shape.size
	
	var target_pos = player.global_position
	target_pos.x = clamp(target_pos.x, map_pos.x, map_pos.x + map_size.x)
	target_pos.y = clamp(target_pos.y, map_pos.y, map_pos.y + map_size.y)
	
	global_position = target_pos.floor()
	global_position = global_position.lerp(target_pos, 0.3)
