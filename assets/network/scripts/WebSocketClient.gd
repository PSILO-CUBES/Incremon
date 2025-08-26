extends Node

signal login_successful
signal login_error
signal account_created
signal confirm_connection

const TokenStorage = preload("res://assets/network/scripts/TokenStorage.gd")
const SlTokenRefresh = preload("res://assets/network/scripts/SLTokenRefresh.gd")

var ws: WebSocketPeer = WebSocketPeer.new()
var connected := false
var data := {}
var sl_token_refresh : SlTokenRefresh

func _ready():
	sl_token_refresh = SlTokenRefresh.new()
	add_child(sl_token_refresh)

func _process(_delta):
	if not ws:
		return
	
	ws.poll()
	
	if not connected and ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		connected = true
		emit_signal("confirm_connection")
		sl_token_refresh.start_sl_refresh(ws)
	
	if connected:
		_process_messages()

func _process_messages():
	while ws.get_available_packet_count() > 0:
		var msg = ws.get_packet().get_string_from_utf8()
		
		data = JSON.parse_string(msg)
		if typeof(data) != TYPE_DICTIONARY:
			continue
		
		message_dispatcher()

func message_dispatcher() :
	match data.get("event", ""):
		"loginSuccess":
			var player_id = data.get("playerId", "")
			var ll_token = data.get("longLivedToken", "")
			var sl_token = data.get("shortLivedToken", "")
			
			if ll_token != "":
				TokenStorage.save_lltoken(ll_token)
			
			if sl_token != "":
				TokenStorage.set_sltoken(sl_token)
			
			emit_signal("login_successful", player_id)
		"loginFailed":
			
			print("Login failed:", data.get("message", "Unknown reason"))
			emit_signal("login_error", data.get("message", "Unknown reason"))
		"createAccountSuccess":
			
			emit_signal("account_created", data.get("message", ""))
		"createAccountFailed":
			
			print("Account creation failed:", data.get("message", "Unknown reason"))
			emit_signal("login_error", data.get("message", "Unknown reason"))
		"tokenInvalid" :
			
			print('No valid tokens found: ', data.get("message", "Unknown reason"))
		"slTokenRefreshed":
			var sl_token = data.get("shortLivedToken", "")
			if sl_token != "":
				TokenStorage.set_sltoken(sl_token)
