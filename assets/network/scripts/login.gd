extends Node

@onready var user_name_input: LineEdit = %SignInUserNameInput
@onready var password_input: LineEdit = %SignInPasswordInput

const Game = preload("res://assets/gameplay/game.tscn")
const TokenStorage = preload("res://assets/network/scripts/token_storage.gd")

var handler = {}

func _ready():
	if not WebSocketClient.is_connected("login_successful", Callable(self, "_on_login_success")):
		WebSocketClient.connect("login_successful", Callable(self, "_on_login_success"))
	
	var token = TokenStorage.load_token()
	if token != "":
		send_token_payload(token)

func _on_pressed():
	send_login_payload()

func send_login_payload():
	var ws = WebSocketClient.ws
	if ws and ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		var username = user_name_input.text
		var password = password_input.text
		
		var payload = {
			"action": "login",
			"username": username,
			"password": password
		}
		ws.send_text(JSON.stringify(payload))
	else:
		print("WebSocket not connected!")

func send_token_payload(token: String):
	var ws = WebSocketClient.ws
	if ws and ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		var payload = {
			"action": "tokenLogin",
			"token": token
		}
		ws.send_text(JSON.stringify(payload))
	else:
		print("WebSocket not connected!")

func _on_login_success(playerId, sl_token):
	print(sl_token)
	_change_to_game()

func _change_to_game():
	var tree = get_tree()
	if tree:
		tree.change_scene_to_packed(Game)
	else:
		push_error("SceneTree not available, cannot change scene!")
