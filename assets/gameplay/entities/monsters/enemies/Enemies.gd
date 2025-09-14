extends Entity
class_name Enemy

@onready var health_bar_container = $"HealthBarContainer"
@onready var hp_progress_bar = $"HealthBarContainer/ProgressBar"

var last_hp := -1
var last_max_hp := -1
var is_dying := false

func _ready() -> void:
	super._ready()
	_init_bar()
	_init_from_local_data()
	WebSocketClient.register_handler("entityStatsUpdate", Callable(self, "_on_entity_stats_update"))

func _exit_tree() -> void:
	WebSocketClient.unregister_handler("entityStatsUpdate", Callable(self, "_on_entity_stats_update"))

func _init_bar() -> void:
	if health_bar_container:
		health_bar_container.visible = true
	if hp_progress_bar:
		hp_progress_bar.min_value = 0
		hp_progress_bar.max_value = 100
		hp_progress_bar.value = 100

func _init_from_local_data() -> void:
	var hp := 0
	var max_hp := 0
	if typeof(data) == TYPE_DICTIONARY and data.has("stats"):
		var stats = data.stats
		if typeof(stats) == TYPE_DICTIONARY:
			if stats.has("hp"):
				hp = int(stats.hp)
			if stats.has("maxHp"):
				max_hp = int(stats.maxHp)
	if max_hp <= 0:
		max_hp = hp
	_apply_hp(hp, max_hp)

func _on_entity_stats_update(payload: Dictionary) -> void:
	if is_dying:
		return
	if typeof(payload) != TYPE_DICTIONARY:
		return
	if not payload.has("entityId"):
		return
	if str(payload.entityId) != str(entity_id):
		return

	var stats := {}
	if payload.has("stats"):
		stats = payload.stats

	var hp := last_hp
	var max_hp := last_max_hp
	if typeof(stats) == TYPE_DICTIONARY:
		if stats.has("hp"):
			hp = int(stats.hp)
		if stats.has("maxHp"):
			max_hp = int(stats.maxHp)

	if max_hp <= 0:
		if hp > 0:
			max_hp = hp
		else:
			max_hp = 1

	_apply_hp(hp, max_hp)

func _apply_hp(hp: int, max_hp: int) -> void:
	last_hp = hp
	last_max_hp = max_hp
	var pct := 0.0
	if max_hp > 0:
		pct = float(hp) / float(max_hp) * 100.0
	if hp_progress_bar:
		hp_progress_bar.value = pct
	if hp <= 0:
		_begin_death_fade()

func _begin_death_fade() -> void:
	if is_dying:
		return
	is_dying = true
	if hp_progress_bar:
		hp_progress_bar.value = 0
	_disable_collisions_and_processing()
	if modulate.a < 1.0:
		modulate = Color(modulate.r, modulate.g, modulate.b, 1.0)
	var t := create_tween()
	t.tween_property(self, "modulate:a", 0.0, 0.35)
	t.finished.connect(_on_death_fade_finished)

func _disable_collisions_and_processing() -> void:
	set_physics_process(false)
	set_process(false)
	if "collision_layer" in self:
		collision_layer = 0
	if "collision_mask" in self:
		collision_mask = 0

func _on_death_fade_finished() -> void:
	queue_free()

func force_despawn() -> void:
	_begin_death_fade()
