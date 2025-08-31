extends Node

const TokenStorage = preload("res://assets/network/scripts/TokenStorage.gd")

var ws: WebSocketPeer
var sl_refresh_timer: Timer

func start_sl_refresh(ws_client: WebSocketPeer, interval_seconds: int = 9 * 60) -> void:
	ws = ws_client
	_start_sl_refresh_timer(interval_seconds)

func stop() -> void:
	if sl_refresh_timer:
		sl_refresh_timer.stop()
		sl_refresh_timer.queue_free()
		sl_refresh_timer = null

func _start_sl_refresh_timer(interval_seconds: int) -> void:
	if sl_refresh_timer:
		sl_refresh_timer.stop()
		sl_refresh_timer.queue_free()

	sl_refresh_timer = Timer.new()
	sl_refresh_timer.wait_time = float(interval_seconds)
	sl_refresh_timer.one_shot = false
	sl_refresh_timer.timeout.connect(Callable(self, "_request_sl_refresh"))
	add_child(sl_refresh_timer)
	sl_refresh_timer.start()

func _request_sl_refresh() -> void:
	# If your server doesn’t require sending the old SL token, this can be just:
	# ws.send_text(JSON.stringify({ "action": "slTokenRefresh" }))
	var sl_token := TokenStorage.get_sltoken()
	
	if sl_token == "":
		return

	var payload := {
		"action": "slTokenRefresh",
		"shortLivedToken": sl_token
	}
	
	ws.send_text(JSON.stringify(payload))
