extends Node

@onready var ws = WebSocketClient.ws

@onready var name_field = %SignUpUserNameInput
@onready var email_field = %SignUpEmailInput
@onready var password_field = %SignUpPasswordInput
@onready var send_button = %CreateButton
@onready var message_label = %MessageLabel

#func _ready():
	#ws.connect_to_url("ws://localhost:3000")
	#send_button.pressed.connect(_on_send_pressed)

func _on_send_pressed():
	var username = name_field.text.strip_edges()
	var email = email_field.text.strip_edges()
	var password = password_field.text.strip_edges()
	
	#if username.length() < 3:
		#show_error("Username too short!")
		#return
	#if password.length() < 5:
		#show_error("Message too short!")
		#return
	#
	#var email_regex = RegEx.new()
	#email_regex.compile(r"^[^@]+@[^@]+\.[^@]+$")
	#if not email_regex.search(email):
		#show_error("Invalid email address!")
		#return
	
	var payload = {
		"action": "createAccount",
		"username": username,
		"email": email,
		"password": password
	}
	
	ws.send_text(JSON.stringify(payload))

func show_error(msg: String):
	message_label.text = msg
	message_label.visible = true
	message_label.modulate.a = 1.0
