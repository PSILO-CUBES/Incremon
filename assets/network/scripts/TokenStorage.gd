extends Node

static var sl_token: String = ""  # memory only

static func save_lltoken(token: String) -> void:
	var f = FileAccess.open("user://token", FileAccess.WRITE)
	if f:
		f.store_string(token)
		f.close()

static func load_lltoken() -> String:
	if FileAccess.file_exists("user://token"):
		var f = FileAccess.open("user://token", FileAccess.READ)
		if f:
			var token = f.get_as_text()
			f.close()
			return token
	return ""

static func delete_lltoken() -> void:
	if FileAccess.file_exists("user://token"):
		var dir = DirAccess.open("user://")
		if dir:
			dir.remove("token")

static func set_sltoken(token: String) -> void:
	sl_token = token

static func get_sltoken() -> String:
	return sl_token
