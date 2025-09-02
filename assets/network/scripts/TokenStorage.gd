extends RefCounted
class_name TokenStorage

const SAVE_PATH := "user://auth.json"

static var _data := {
	"player_id": "",
	"username": "",
	"long_lived_token": "",
	"short_lived_token": "",
	"short_lived_expires_at": 0
}

# ----------------- Public API -----------------

static func set_login_success(payload: Dictionary) -> void:
	# Accept both camelCase and snake_case from server
	var player_id := str(payload.get("playerId", payload.get("player_id", "")))
	var username  := str(payload.get("username", payload.get("user", "")))

	var ll := str(payload.get("longLivedToken", payload.get("long_lived_token", "")))
	var sl := str(payload.get("shortLivedToken", payload.get("short_lived_token", "")))
	var sl_exp := int(payload.get("shortLivedExpiresAt", payload.get("short_lived_expires_at", 0)))

	set_profile(player_id, username)
	# Set tokens only if present (skip empty strings)
	if ll != "":
		set_ll_token(ll, false)
	if sl != "":
		set_sl_token(sl, sl_exp, false)

	save_data()

static func set_profile(player_id: String, username: String) -> void:
	_data.player_id = player_id
	_data.username = username

# Set both tokens, but **skip empty args** so you can update one at a time.
static func set_tokens(long_lived: String = "", short_lived: String = "", short_lived_expires_at_ms: int = 0, save_now: bool = true) -> void:
	if long_lived != "":
		_data.long_lived_token = long_lived
	if short_lived != "":
		_data.short_lived_token = short_lived
		_data.short_lived_expires_at = short_lived_expires_at_ms
	if save_now:
		save_data()

static func set_ll_token(long_lived: String, save_now: bool = true) -> void:
	if long_lived != "":
		_data.long_lived_token = long_lived
		if save_now:
			save_data()

static func set_sl_token(short_lived: String, short_lived_expires_at_ms: int = 0, save_now: bool = true) -> void:
	if short_lived != "":
		_data.short_lived_token = short_lived
		_data.short_lived_expires_at = short_lived_expires_at_ms
		if save_now:
			save_data()

static func get_player_id() -> String:
	return _data.player_id

static func get_username() -> String:
	return _data.username

static func get_long_lived_token() -> String:
	return _data.long_lived_token

static func get_short_lived_token() -> String:
	return _data.short_lived_token

static func get_short_lived_expires_at() -> int:
	return _data.short_lived_expires_at

static func clear() -> void:
	_data = {
		"player_id": "",
		"username": "",
		"long_lived_token": "",
		"short_lived_token": "",
		"short_lived_expires_at": 0
	}
	if FileAccess.file_exists(SAVE_PATH):
		var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
		if f:
			f.store_string(JSON.stringify(_data))
			f.close()

# ----------------- Persistence -----------------

static func save_data() -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(_data))
		f.close()

static func load_data() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if not f:
		return
	var txt := f.get_as_text()
	f.close()
	var parsed = JSON.parse_string(txt)
	if typeof(parsed) == TYPE_DICTIONARY:
		_data.player_id = str(parsed.get("player_id", _data.player_id))
		_data.username = str(parsed.get("username", _data.username))
		_data.long_lived_token = str(parsed.get("long_lived_token", _data.long_lived_token))
		_data.short_lived_token = str(parsed.get("short_lived_token", _data.short_lived_token))
		_data.short_lived_expires_at = int(parsed.get("short_lived_expires_at", _data.short_lived_expires_at))
