extends Camera2D

@export var player_path: NodePath

var player: Node2D
var map_rect: CollisionShape2D

func _ready():
	if player_path != null:
		player = get_node(player_path) as CharacterBody2D
	
	map_rect = get_tree().get_root().get_node("Game/World/Map/MapArea/MapShape") as CollisionShape2D

	if map_rect != null:
		var map_origin = map_rect.global_position - map_rect.shape.extents
		var map_size = map_rect.shape.size

		limit_left = map_origin.x
		limit_top = map_origin.y
		limit_right = map_origin.x + map_size.x
		limit_bottom = map_origin.y + map_size.y

func _process(_delta):
	if player == null:
		return
	var target_pos = player.global_position
	global_position = global_position.lerp(target_pos, 0.3).round()
