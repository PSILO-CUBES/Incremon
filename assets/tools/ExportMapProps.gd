# res://assets/tools/ExportMapProps.gd
@tool
extends EditorScript

# Exports all CollisionShape2D / CollisionPolygon2D found under nodes in group
# "Props" or "Solid"/"Solids" from the currently open map scene.
# Output is written to: res://server/maps/colliders/<area>/<map>/<map>.json
#
# Shapes are exported as either:
#   { "kind": "poly",   "verts": [ { "x":..., "y":... }, ... ] }
#   { "kind": "circle", "x":..., "y":..., "r":... }
#
# Bounds come from MapArea/MapShape (RectangleShape2D) if present.

func _run() -> void:
	var ei := get_editor_interface()
	if not ei:
		printerr("No EditorInterface.")
		return
	var root := ei.get_edited_scene_root()
	if root == null:
		printerr("Open a map scene and try again.")
		return

	var scene_path := root.scene_file_path
	if scene_path.is_empty():
		printerr("Edited root has no scene file path. Save your scene and retry.")
		return

	var map_id := _infer_map_id_from_scene_path(scene_path)
	if map_id.is_empty():
		printerr("Could not infer map_id from scene path: %s" % scene_path)
		return

	var solids: Array = []
	_collect_colliders(root, solids)

	var bounds := _read_bounds_from_map(root)
	var out := {
		"mapId": map_id,
		"version": int(Time.get_unix_time_from_system()),
		"bounds": bounds,
		"solids": solids,
	}

	var out_path := _out_path_for_map_id(map_id)
	_ensure_dirs_for(out_path)

	var abs := ProjectSettings.globalize_path(out_path)
	var f := FileAccess.open(abs, FileAccess.WRITE)
	if f == null:
		printerr("Failed to open for write: %s" % out_path)
		return

	var json := JSON.stringify(out, "\t")
	f.store_string(json)
	f.flush()
	f.close()

	print("[ExportMapProps] Wrote %d solids to %s" % [solids.size(), out_path])


# --- Map id & paths ----------------------------------------------------------

func _infer_map_id_from_scene_path(scene_path: String) -> String:
	var p := scene_path.strip_edges().replace("\\", "/")
	var anchor := "res://assets/gameplay/maps/"
	var idx := p.find(anchor)
	if idx == -1:
		return ""

	var tail := p.substr(idx + anchor.length())
	var parts := tail.split("/")
	if parts.size() < 2:
		return ""

	var area := parts[0].to_lower()
	var map_name := ""
	if parts.size() >= 3:
		map_name = parts[1].to_lower()
	else:
		var fname := parts[1]
		if fname.ends_with(".tscn"):
			fname = fname.left(fname.length() - 5)
		map_name = fname.to_lower()

	return "%s/%s" % [area, map_name]


func _out_path_for_map_id(map_id: String) -> String:
	var parts := map_id.split("/")
	if parts.size() < 2:
		return ""
	var area := parts[0]
	var map_name := parts[1]
	# res://server/maps/colliders/<area>/<map>/<map>.json
	var dir := "res://server/maps/colliders/%s/%s" % [area, map_name]
	return "%s/%s.json" % [dir, map_name]


func _ensure_dirs_for(res_path: String) -> void:
	var dir_path := res_path.get_base_dir()
	var abs := ProjectSettings.globalize_path(dir_path)
	DirAccess.make_dir_recursive_absolute(abs)


# --- Bounds (MapArea/MapShape) -----------------------------------------------

func _read_bounds_from_map(root: Node) -> Dictionary:
	var map_area := root.get_node_or_null("MapArea")
	if map_area == null:
		return { "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0 }

	var map_shape: CollisionShape2D = map_area.get_node_or_null("MapShape")
	if map_shape == null or map_shape.shape == null:
		return { "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0 }

	var rect := map_shape.shape
	if not (rect is RectangleShape2D):
		return { "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0 }

	var size: Vector2 = rect.size
	var hw := size.x * 0.5
	var hh := size.y * 0.5
	var xform: Transform2D = map_shape.global_transform

	var pts := [
		Vector2(-hw, -hh),
		Vector2( hw, -hh),
		Vector2( hw,  hh),
		Vector2(-hw,  hh),
	]

	var min_x := INF
	var min_y := INF
	var max_x := -INF
	var max_y := -INF
	for p in pts:
		var wp = xform * p
		min_x = min(min_x, wp.x)
		min_y = min(min_y, wp.y)
		max_x = max(max_x, wp.x)
		max_y = max(max_y, wp.y)

	return { "x": min_x, "y": min_y, "w": max_x - min_x, "h": max_y - min_y }


# --- Collider harvesting ------------------------------------------------------

func _collect_colliders(root: Node, solids: Array) -> void:
	var tree := root.get_tree()
	if tree == null:
		return

	var groups := ["Props", "Solid", "Solids"]
	var sources: Array = []
	for g in groups:
		for n in tree.get_nodes_in_group(g):
			if n is Node:
				sources.append(n)

	var seen := {}
	for src in sources:
		_collect_from_node(src, solids, seen)


func _collect_from_node(n: Node, solids: Array, seen: Dictionary) -> void:
	if n == null or seen.has(n):
		return
	seen[n] = true

	if n is CollisionPolygon2D:
		_emit_poly(n, solids)
	elif n is CollisionShape2D:
		_emit_shape(n, solids)

	for child in n.get_children():
		if child is Node:
			_collect_from_node(child, solids, seen)


func _emit_poly(poly: CollisionPolygon2D, solids: Array) -> void:
	var arr: PackedVector2Array = poly.polygon
	if arr.is_empty():
		return
	var xform: Transform2D = poly.global_transform

	var out_verts: Array = []
	for v in arr:
		var wp := xform * v
		out_verts.append({ "x": float(wp.x), "y": float(wp.y) })

	if out_verts.size() >= 3:
		solids.append({ "kind": "poly", "verts": out_verts })


func _emit_shape(cshape: CollisionShape2D, solids: Array) -> void:
	var shape := cshape.shape
	if shape == null:
		return

	var xform: Transform2D = cshape.global_transform
	var sx := xform.x.length()
	var sy := xform.y.length()

	if shape is CircleShape2D:
		var rad = shape.radius * max(sx, sy)
		if rad > 0.0:
			var c := xform.origin
			solids.append({ "kind": "circle", "x": float(c.x), "y": float(c.y), "r": float(rad) })
		return

	if shape is RectangleShape2D:
		var size: Vector2 = shape.size
		var hw := size.x * 0.5
		var hh := size.y * 0.5
		var pts := [
			Vector2(-hw, -hh),
			Vector2( hw, -hh),
			Vector2( hw,  hh),
			Vector2(-hw,  hh),
		]
		var out_verts: Array = []
		for pt in pts:
			var wp = xform * pt
			out_verts.append({ "x": float(wp.x), "y": float(wp.y) })
		solids.append({ "kind": "poly", "verts": out_verts })
