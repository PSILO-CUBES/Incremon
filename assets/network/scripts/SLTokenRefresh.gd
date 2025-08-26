extends Node

const TokenStorage = preload("res://assets/network/scripts/TokenStorage.gd")

var ws: WebSocketPeer
var sl_refresh_timer: Timer

func start_sl_refresh(ws_client):
	ws = ws_client
	_start_sl_refresh_timer()

func _start_sl_refresh_timer():
	if sl_refresh_timer:
		sl_refresh_timer.stop()
		sl_refresh_timer.queue_free()
	
	sl_refresh_timer = Timer.new()
	sl_refresh_timer.wait_time = 9 * 60 # 540 seconds = 9 minutes
	sl_refresh_timer.one_shot = false
	sl_refresh_timer.connect("timeout", Callable(self, "_request_sl_refresh"))
	add_child(sl_refresh_timer)
	sl_refresh_timer.start()

func _request_sl_refresh():
	var sl_token = TokenStorage.get_sltoken()
	if sl_token == "":
		return
	
	var payload = {
		"action": "slTokenRefresh",
		"shortLivedToken": sl_token
	}
	
	ws.send_text(JSON.stringify(payload))
