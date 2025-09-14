extends VBoxContainer
class_name ProgressBarManagement

var hp_content := {}
var mp_content := {}
var xp_content := {}

var last_hp: int = 0
var last_max_hp: int = 1
var last_mp: int = 0
var last_max_mp: int = 1
var last_exp: int = 0
var last_exp_to_next: int = 0

func _ready() -> void:
	hp_content = {
		"progressBar": get_tree().get_root().get_node("Game").find_child("HPProgressBar"),
		"label": get_tree().get_root().get_node("Game").find_child("HPLabel")
	}
	mp_content = {
		"progressBar": get_tree().get_root().get_node("Game").find_child("MPProgressBar"),
		"label": get_tree().get_root().get_node("Game").find_child("MPLabel")
	}
	xp_content = {
		"progressBar": get_tree().get_root().get_node("Game").find_child("XPProgressBar"),
		"label": get_tree().get_root().get_node("Game").find_child("XPLabel")
	}

	_init_bar(hp_content)
	_init_bar(mp_content)
	_init_bar(xp_content)

	WebSocketClient.register_handler("playerSpawn", Callable(self, "_on_player_spawn"))
	WebSocketClient.register_handler("statsUpdate", Callable(self, "_on_stats_update"))

func _exit_tree() -> void:
	WebSocketClient.unregister_handler("playerSpawn", Callable(self, "_on_player_spawn"))
	WebSocketClient.unregister_handler("statsUpdate", Callable(self, "_on_stats_update"))

func _init_bar(content: Dictionary) -> void:
	if content.has("progressBar") and content.progressBar:
		content.progressBar.min_value = 0
		content.progressBar.max_value = 100
		content.progressBar.value = 0

func _on_player_spawn(payload: Dictionary) -> void:
	var stats := _extract_stats_from_payload(payload)
	_apply_stats(stats)

func _on_stats_update(payload: Dictionary) -> void:
	var stats := _extract_stats_from_payload(payload)
	print(stats)
	_apply_stats(stats)

func _extract_stats_from_payload(payload: Dictionary) -> Dictionary:
	var root := payload
	if payload.has("playerData"):
		root = payload.playerData
	elif payload.has("player_data"):
		root = payload.player_data

	var stats := root
	if typeof(root) == TYPE_DICTIONARY and root.has("stats"):
		stats = root.stats

	return stats

func _opt_int(v):
	var t := typeof(v)
	if t == TYPE_INT:
		return v
	if t == TYPE_FLOAT:
		if is_finite(v):
			return int(v)
		return null
	if t == TYPE_STRING:
		var s := String(v)
		if s.is_valid_int():
			return int(s)
		if s.is_valid_float():
			return int(float(s))
	return null

func _apply_stats(stats: Dictionary) -> void:
	if typeof(stats) != TYPE_DICTIONARY:
		return

	var inc_max_hp = _opt_int(stats.get("maxHp", null))
	var inc_hp = _opt_int(stats.get("hp", null))
	var inc_max_mp = _opt_int(stats.get("maxMp", null))
	var inc_mp = _opt_int(stats.get("mp", null))
	var inc_exp = _opt_int(stats.get("exp", null))
	var inc_exp_to_next = _opt_int(stats.get("expToNext", null))

	var max_hp := last_max_hp
	if inc_max_hp != null and inc_max_hp > 0:
		max_hp = inc_max_hp
	if max_hp <= 0:
		max_hp = 1

	var hp := last_hp
	if inc_hp != null:
		hp = inc_hp
	if hp < 0:
		hp = 0
	if hp > max_hp:
		hp = max_hp

	var max_mp := last_max_mp
	if inc_max_mp != null and inc_max_mp > 0:
		max_mp = inc_max_mp
	if max_mp <= 0:
		max_mp = 1

	var mp := last_mp
	if inc_mp != null:
		mp = inc_mp
	if mp < 0:
		mp = 0
	if mp > max_mp:
		mp = max_mp

	var exp := last_exp
	if inc_exp != null:
		exp = inc_exp

	var has_exp_to_next := false
	var exp_to_next := last_exp_to_next
	if inc_exp_to_next != null:
		has_exp_to_next = true
		exp_to_next = inc_exp_to_next
		if exp_to_next < 0:
			exp_to_next = 0
		if exp < 0:
			exp = 0
		if exp_to_next > 0 and exp > exp_to_next:
			exp = exp_to_next

	_set_bar_and_label(hp_content, hp, max_hp)
	_set_bar_and_label(mp_content, mp, max_mp)

	if has_exp_to_next and exp_to_next > 0:
		_set_bar_and_label(xp_content, exp, exp_to_next)
	else:
		_set_label_only(xp_content, str(exp))

	last_hp = hp
	last_max_hp = max_hp
	last_mp = mp
	last_max_mp = max_mp
	last_exp = exp
	last_exp_to_next = exp_to_next

func _set_bar_and_label(content: Dictionary, current_value: int, max_value: int) -> void:
	var pct := 0.0
	if max_value > 0:
		pct = float(current_value) / float(max_value) * 100.0
	if content.has("progressBar") and content.progressBar:
		content.progressBar.value = pct
	if content.has("label") and content.label:
		var txt := str(current_value) + "/" + str(max_value)
		content.label.text = txt

func _set_label_only(content: Dictionary, text_value: String) -> void:
	if content.has("label") and content.label:
		content.label.text = text_value
	if content.has("progressBar") and content.progressBar:
		content.progressBar.value = 0
