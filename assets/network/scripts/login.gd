extends Node

@onready var user_name_input: LineEdit = %SignInUserNameInput
@onready var password_input: LineEdit = %SignInPasswordInput

const Game = preload("res://assets/gameplay/game.tscn")
const TokenStorage = preload("res://assets/network/scripts/TokenStorage.gd")

func _ready():
	WebSocketClient.register_handler("loginSuccess", Callable(self, "_on_login_success"))
	WebSocketClient.register_handler("loginFailed", Callable(self, "_on_login_failed"))

	var token = TokenStorage.load_lltoken()
	if token != "":
		WebSocketClient.send_action("tokenLogin", {"token": token})

func sign_in() -> void:
	var username := user_name_input.text.strip_edges()
	var password := password_input.text
	if username == "" or password == "":
		return
	WebSocketClient.send_action("login", {"username": username, "password": password})

func _on_login_success(payload: Dictionary) -> void:
	_change_to_game()

func _on_login_failed(payload: Dictionary) -> void:
	print(payload.get("message", "Login failed"))

func _change_to_game():
	var tree = get_tree()
	if tree:
		tree.change_scene_to_packed(Game)
	else:
		push_error("SceneTree not available, cannot change scene!")

func _on_connect_button_pressed() -> void:
	sign_in()
