static func save_token(token: String) -> void:
	var f = FileAccess.open("user://token", FileAccess.WRITE)
	if f:
		f.store_string(token)
		f.close()

static func load_token() -> String:
	if FileAccess.file_exists("user://token"):
		var f = FileAccess.open("user://token", FileAccess.READ)
		if f:
			var token = f.get_as_text()
			f.close()	
			return token
	return ""

static  func delete_token() -> void:
	if FileAccess.file_exists("user://token"):
		var dir = DirAccess.open("user://")
		if dir:
			dir.remove("token")
