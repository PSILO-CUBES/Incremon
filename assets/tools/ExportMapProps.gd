# res://assets/tools/export_map_props.gd
extends EditorScript

# Exports all CollisionShape2D / CollisionPolygon2D that are under a node in group "solid"
# from the currently open map scene, and writes them to:
#   res://server/maps/colliders/<mapId>.json
#
# Shapes are exported as either:
#   { "kind": "poly", "verts": [ { "x":..., "y":... }, ... ] }
#   { "kind": "circle", "x":..., "y":..., "r":... }
#
# Map bounds are read from MapArea/MapShape if present (RectangleShape2D).
# The <mapId> is derived from the scene path like "assets/gameplay/maps/area1/m1/m1.tscn" -> "area1/m1".
#
# Usage:
#  1) Open your map scene
#  2) Put prop/obstacle parents (or the shapes themselves) in editor group "prop"
#  3) Run this EditorScript. It prints where it wrote the JSON.

const GROUP_PROP := "prop"

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
	if map_id == "":
		printerr("Could not infer map_id from: ", scene_path)
		return

	# Gather shapes limited to anything under a node in group 'prop'
	var shape_nodes := _gather_exportable_shapes(root)

	# Convert to world-space props JSON
	var props: Array = []
	for n in shape_nodes:
		if n is CollisionPolygon2D:
			var poly := (n as CollisionPolygon2D).polygon
			if poly.size() >= 3:
				var gt = n.get_global_transform()
				var verts: Array = []
				for p in poly:
					var wp = gt * p
					verts.append({ "x": wp.x, "y": wp.y })
				props.append({ "kind": "poly", "verts": verts })
		elif n is CollisionShape2D:
			var cs := n as CollisionShape2D
			if cs.shape == null:
				continue
			var gt = n.get_global_transform()
			var gs = n.global_scale
			match cs.shape:
				RectangleShape2D:
					var rect := cs.shape as RectangleShape2D
					var half := rect.size * 0.5
					var local := [
						Vector2(-half.x, -half.y),
						Vector2( half.x, -half.y),
						Vector2( half.x,  half.y),
						Vector2(-half.x,  half.y),
					]
					var verts: Array = []
					for p in local:
						verts.append({ "x": (gt * p).x, "y": (gt * p).y })
					props.append({ "kind": "poly", "verts": verts })
				CircleShape2D:
					var circ := cs.shape as CircleShape2D
					var center = gt.origin
					# scale radius conservatively by the larger axis
					var r = circ.radius * max(abs(gs.x), abs(gs.y))
					props.append({ "kind": "circle", "x": center.x, "y": center.y, "r": r })
				CapsuleShape2D:
					# Export capsule as a 16-gon polygon approximation (good enough for static props)
					var cap := cs.shape as CapsuleShape2D
					var r = cap.radius * max(abs(gs.x), abs(gs.y))
					var h = cap.height * abs(gs.y)
					var verts: Array = []
					var steps := 16
					for i in steps:
						var a := TAU * float(i) / float(steps)
						var px = r * cos(a)
						var py = r * sin(a)
						# two semicircles bridged by a vertical segment: shift based on sign of py
						var y_shift: float
						if py >= 0.0:
							y_shift = h * 0.5
						else:
							y_shift = -h * 0.5
							
						var wp = gt * Vector2(px, py + y_shift)
						verts.append({ "x": wp.x, "y": wp.y })
					props.append({ "kind": "poly", "verts": verts })
				_:
					# Fallback: try to read a polygon from the shape's AABB as a poly
					var aabb = cs.get_transformed_aabb()
					var verts := [
						{ "x": aabb.position.x,                    "y": aabb.position.y },
						{ "x": aabb.position.x + aabb.size.x,      "y": aabb.position.y },
						{ "x": aabb.position.x + aabb.size.x,      "y": aabb.position.y + aabb.size.y },
						{ "x": aabb.position.x,                    "y": aabb.position.y + aabb.size.y },
					]
					props.append({ "kind": "poly", "verts": verts })

	# Bounds from MapArea/MapShape (RectangleShape2D)
	var bounds := _extract_bounds(root)

	var payload := {
		"mapId": map_id,
		"version": int(Time.get_unix_time_from_system()),
		"bounds": bounds,
		"props": props
	}

	var out_path := _out_path_for_map_id(map_id)
	_ensure_dirs_for(out_path)

	var fh := FileAccess.open(out_path, FileAccess.WRITE)
	if fh == null:
		printerr("Failed to open for write: ", out_path)
		return
	fh.store_string(JSON.stringify(payload, "\t"))
	fh.flush()
	fh.close()

	print("Exported ", props.size(), " props for ", map_id, " to: ", out_path)

func _gather_exportable_shapes(root: Node) -> Array:
	# Only export shapes that are under a node in group "prop"
	var exportable: Array = []
	var queue: Array = [root]
	while not queue.is_empty():
		var n: Node = queue.pop_back()
		for c in n.get_children():
			queue.append(c)

		if not (n is CollisionPolygon2D or n is CollisionShape2D):
			continue

		# Skip the map’s own bounding rect (we export bounds separately)
		var path_str := str(n.get_path())
		if path_str.find("MapArea/MapShape") != -1:
			continue

		if _has_prop_ancestor(n):
			exportable.append(n)

	return exportable

func _has_prop_ancestor(n: Node) -> bool:
	var cur := n
	while cur:
		if cur.is_in_group(GROUP_PROP):
			return true
		cur = cur.get_parent()
	return false

func _extract_bounds(root: Node) -> Dictionary:
	if root.has_node("MapArea/MapShape"):
		var cs: CollisionShape2D = root.get_node("MapArea/MapShape")
		if cs.shape is RectangleShape2D:
			var rect := cs.shape as RectangleShape2D
			var gt := cs.get_global_transform()
			var half := rect.size * 0.5
			var local := [
				Vector2(-half.x, -half.y),
				Vector2( half.x, -half.y),
				Vector2( half.x,  half.y),
				Vector2(-half.x,  half.y),
			]
			var xs: Array = []
			var ys: Array = []
			for p in local:
				var wp = gt * p
				xs.append(wp.x)
				ys.append(wp.y)
			var minx = xs.min()
			var maxx = xs.max()
			var miny = ys.min()
			var maxy = ys.max()
			return { "x": minx, "y": miny, "w": (maxx - minx), "h": (maxy - miny) }
	return {}

func _infer_map_id_from_scene_path(p: String) -> String:
	# Expect something like: res://assets/gameplay/maps/area1/m1/m1.tscn
	var lower := p.to_lower()
	var anchor := "/assets/gameplay/maps/"
	var idx := lower.find(anchor)
	if idx == -1:
		return ""
	var rel := lower.substr(idx + anchor.length())
	if rel.ends_with(".tscn"):
		rel = rel.substr(0, rel.length() - 5)
	return rel.replace("\\", "/") # "area1/m1"

func _out_path_for_map_id(map_id: String) -> String:
	# Write to a mirrored directory under server/maps/colliders/<area>/<map>.json
	var parts := map_id.split("/")
	var base_dir := "res://server/maps/colliders"
	var dir := base_dir
	for i in range(0, parts.size() - 1):
		dir += "/" + parts[i]
	var file := parts[parts.size() - 1] + ".json"
	return dir + "/" + file

func _ensure_dirs_for(res_path: String) -> void:
	var dir_path := res_path.get_base_dir()
	var abs := ProjectSettings.globalize_path(dir_path)
	DirAccess.make_dir_recursive_absolute(abs)
