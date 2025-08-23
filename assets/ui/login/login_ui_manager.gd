extends Node2D

@onready var sign_in_container: VBoxContainer = %SignInContainer
@onready var sign_up_container: VBoxContainer = %SignUpContainer
@onready var forgot_password_container: VBoxContainer = %ForgotPasswordContainer

@onready var sign_up_button: Button = %SignUpButton
@onready var sign_in_button: Button = %SignInButton
@onready var forgot_password_button: Button = %ForgotPasswordButton

@onready var message_label: Label = %MessageLabel

var login_menu_state : String = ''

func _ready() -> void:
	if not WebSocketClient.is_connected("login_error", Callable(self, "_show_error")):
		WebSocketClient.connect("login_error", Callable(self, "_show_error"))
	
	if not WebSocketClient.is_connected("login_confirmation", Callable(self, "_show_confirmation")):
		WebSocketClient.connect("login_confirmation", Callable(self, "_show_confirmation"))
	
	await get_tree().create_timer(0.1).timeout
	update_login_ui('sign_in')

var pre_fade_out_timer := 3.0
var fade_speed := 1.0

func _process(delta):
	fade_out_error(delta)

func _on_change_ui_button_pressed(ui_type : String) -> void:
	update_login_ui(ui_type)

func _show_error(msg: String):
	message_label.text = msg
	message_label.visible = true
	message_label.add_theme_color_override("font_color", Color.RED)
	message_label.modulate.a = 1.0
	pre_fade_out_timer = 3.0

func _show_confirmation(msg: String):
	message_label.text = msg
	message_label.visible = true
	message_label.add_theme_color_override("font_color", Color.GREEN)
	message_label.modulate.a = 1.0
	pre_fade_out_timer = 3.0

func fade_out_error(delta):
	if message_label.visible and message_label.modulate.a > 0:
		if pre_fade_out_timer > 0:
			pre_fade_out_timer -= delta
			return
		
		message_label.modulate.a = max(message_label.modulate.a - fade_speed * delta, 0)
		if message_label.modulate.a == 0:
			message_label.visible = false
			pre_fade_out_timer = 3.0

func update_login_ui(ui_type) :
	if login_menu_state == ui_type : return
	
	login_menu_state = ui_type
	
	match ui_type :
		'sign_in' :
			sign_in_container.visible = true
			sign_up_button.visible = true
			forgot_password_button.visible = true
			
			sign_up_container.visible = false
			forgot_password_container.visible = false
			sign_in_button.visible = false
		'sign_up' :
			sign_up_container.visible = true
			sign_in_button.visible = true
			forgot_password_button.visible = true
			
			sign_in_container.visible = false
			forgot_password_container.visible = false
			sign_up_button.visible = false
		'recover_password' :
			forgot_password_container.visible = true
			sign_in_button.visible = true
			
			sign_up_container.visible = false
			sign_in_container.visible = false
			sign_up_button.visible = false
			forgot_password_button.visible = false
