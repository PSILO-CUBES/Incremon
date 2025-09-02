extends Node

# Catch-all for unhandled events
signal message_received(event: String, payload: Dictionary)
# Connection lifecycle
signal connection_open
signal connection_closed(code: int, reason: String)

const TokenStorage   = preload("res://assets/network/scripts/TokenStorage.gd")
const SlTokenRefresh = preload("res://assets/network/scripts/SLTokenRefresh.gd")

var ws: WebSocketPeer = WebSocketPeer.new()
var _connected: bool = false

# event:String -> Array[Dictionary] where item = { "cb": Callable, "mode": int }
var _handlers := {}

# Call modes so we don't need per-event if/else in _dispatch
const CALL_NONE := 0                     # call: ()
const CALL_PAYLOAD := 1                  # call: (payload)
const CALL_EVENT_AND_PAYLOAD := 2        # call: (event, payload)

var sl_token_refresh: SlTokenRefresh

func _ready() -> void:
	# Load cached auth/profile once at startup so tokens & username are available
	TokenStorage.load_data()
	set_process(true)

# ----------------- Public API -----------------

func register_handler(event: String, handler: Callable, mode: int = CALL_PAYLOAD) -> void:
	if not _handlers.has(event):
		_handlers[event] = []
	var arr: Array = _handlers[event]
	# prevent duplicates of same callable+mode
	for it in arr:
		if it.cb == handler and it.mode == mode:
			return
	arr.append({ "cb": handler, "mode": mode })

func register_noarg(event: String, handler: Callable) -> void:
	register_handler(event, handler, CALL_NONE)

func unregister_handler(event: String, handler: Callable, mode: int = -1) -> void:
	if not _handlers.has(event):
		return
	var arr: Array = _handlers[event]
	for i in range(arr.size() - 1, -1, -1):
		var it = arr[i]
		if it.cb == handler and (mode == -1 or it.mode == mode):
			arr.remove_at(i)
	if arr.is_empty():
		_handlers.erase(event)

func clear_handlers(event: String = "") -> void:
	if event == "":
		_handlers.clear()
	else:
		_handlers.erase(event)

# Convenience: send { action, ...data } to the server
func send_action(action: String, data: Dictionary = {}) -> void:
	var msg := {
		"action": action,
		"shortLivedToken": TokenStorage.get_short_lived_token()
	}
	for k in data.keys():
		msg[k] = data[k]
	# Guard: only send when socket is open
	if ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		ws.send_text(JSON.stringify(msg))
	else:
		push_warning("send_action while socket not open: %s" % action)

# ----------------- Internals ------------------

func _process(_delta: float) -> void:
	# Always poll, even while CONNECTING
	ws.poll()

	var state := ws.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		if not _connected:
			_connected = true
			_dispatch("connection_open", {})
			emit_signal("connection_open")

		# Drain packets
		while ws.get_available_packet_count() > 0:
			var pkt: PackedByteArray = ws.get_packet()
			var text := pkt.get_string_from_utf8()
			var parsed = JSON.parse_string(text)

			if typeof(parsed) == TYPE_DICTIONARY:
				# Accept event/type/op
				var ev: String = parsed.get("event", parsed.get("type", parsed.get("op", "")))

				# Prefer explicit payload; else use top-level (minus event keys)
				var payload: Dictionary
				if parsed.has("payload") and typeof(parsed.payload) == TYPE_DICTIONARY:
					payload = parsed.payload
				else:
					payload = parsed.duplicate()
					payload.erase("event")
					payload.erase("type")
					payload.erase("op")

				# -------- Token side-effects (using your TokenStorage API) --------
				if ev == "loginSuccess":
					# Server typically returns: playerId, username, longLivedToken, shortLivedToken, (optional) shortLivedExpiresAt
					TokenStorage.set_login_success(parsed)

					# Start/ensure SL refresh once we’re authenticated
					if sl_token_refresh == null:
						sl_token_refresh = SlTokenRefresh.new()
						add_child(sl_token_refresh)
					sl_token_refresh.start_sl_refresh(ws)  # default cadence inside the script

				elif ev == "slTokenRefreshed":
					# Server typically returns: shortLivedToken, (optional) shortLivedExpiresAt
					var new_sl := str(parsed.get("shortLivedToken", ""))
					var sl_exp := int(parsed.get("shortLivedExpiresAt", 0))
					if new_sl != "":
						# Keep existing LL as-is; update SL only
						TokenStorage.set_tokens(
							TokenStorage.get_long_lived_token(),
							new_sl,
							sl_exp
						)

				# -----------------------------------------------------------------

				_dispatch(ev, payload)
			else:
				push_warning("Malformed network packet: %s" % text)

	elif state == WebSocketPeer.STATE_CLOSED:
		if _connected:
			_connected = false
			var code := ws.get_close_code()
			var reason := ws.get_close_reason()
			if sl_token_refresh:
				sl_token_refresh.stop()
			_dispatch("connection_closed", {"code": code, "reason": reason})
			emit_signal("connection_closed", code, reason)

func _dispatch(ev: String, payload: Dictionary) -> void:
	var consumed := false
	if _handlers.has(ev):
		for it in _handlers[ev]:
			var cb: Callable = it.cb
			var mode: int = it.mode
			if cb.is_valid():
				match mode:
					CALL_NONE:
						cb.call()
					CALL_EVENT_AND_PAYLOAD:
						cb.call(ev, payload)
					_:
						cb.call(payload)
				consumed = true
	if not consumed:
		emit_signal("message_received", ev, payload)
