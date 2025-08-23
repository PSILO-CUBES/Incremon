class_name HoverableButton
extends Button

const POINTING_HAND = preload("res://assets/utils/icons/pointing_hand.png")

func _on_mouse_entered():
	Input.set_custom_mouse_cursor(POINTING_HAND, Input.CURSOR_ARROW, Vector2(0, 0))

func _on_mouse_exited():
	Input.set_custom_mouse_cursor(null, Input.CURSOR_ARROW)
