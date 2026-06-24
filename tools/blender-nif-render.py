"""Headless Blender render of a NIF to a PNG (self-check glow/shape).
  blender.exe --background --python tools/blender-nif-render.py -- <nif_path> <out_png>
"""
import sys, bpy, addon_utils, math, mathutils
addon_utils.enable("io_scene_nifly", default_set=False, persistent=True)
nif_path, out_png = sys.argv[-2], sys.argv[-1]
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.pynifly(filepath=nif_path)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
# world bbox
mins = mathutils.Vector(( 1e18,)*3); maxs = mathutils.Vector((-1e18,)*3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        for k in range(3):
            mins[k]=min(mins[k],w[k]); maxs[k]=max(maxs[k],w[k])
center = (mins+maxs)/2; size = (maxs-mins); rad = max(size)/2 or 100

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types,'RaytraceEEVEE') else 'BLENDER_EEVEE'
scene.render.resolution_x = 700; scene.render.resolution_y = 700
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w"); scene.world.use_nodes=True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.02,0.02,0.03,1)  # dark bg to see glow

cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam)
cam_data.clip_start = max(0.1, rad*0.01); cam_data.clip_end = rad*50   # avoid clipping the big mesh
dist = rad*3.2
cam.location = center + mathutils.Vector((dist*0.6, -dist, dist*0.5))
d = (center - cam.location).normalized()
cam.rotation_euler = d.to_track_quat('-Z','Y').to_euler()
scene.camera = cam

sun_d = bpy.data.lights.new("s",'SUN'); sun_d.energy=2.0
sun = bpy.data.objects.new("s", sun_d); scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50),0,math.radians(30))

scene.render.filepath = out_png
bpy.ops.render.render(write_still=True)
print("RENDERED", out_png, "| meshes:", len(meshes), "| bbox rad:", round(rad,1))
