extends Area2D

func _input_event(viewport, event, shape_idx):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var focused = get_viewport().gui_get_focus_owner()
		if focused and (focused is LineEdit or focused is TextEdit):
			focused.release_focus()
