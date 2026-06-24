"""Headless Blender NIF validator: import a NIF via the (properly installed) PyNifly addon =
an INDEPENDENT parse. A malformed NIF errors here instead of CTD-ing the game.
  blender.exe --background --python tools/blender-nif-validate.py -- <nif_path>
Exit 0 = imported clean; exit 2 = import error (suspect file).
"""
import sys, bpy, traceback, addon_utils
addon_utils.enable("io_scene_nifly", default_set=False, persistent=True)

nif_path = sys.argv[-1]
print("=== VALIDATE:", nif_path, "===")
# empty the default scene WITHOUT read_factory_settings (which would disable the addon)
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
try:
    res = bpy.ops.import_scene.pynifly(filepath=nif_path)
    print("import result:", res)
except Exception:
    print("IMPORT FAILED (suspect NIF):"); traceback.print_exc(); sys.exit(2)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
tv = sum(len(o.data.vertices) for o in meshes)
tf = sum(len(o.data.polygons) for o in meshes)
print(f"objects:{len(bpy.data.objects)} meshes:{len(meshes)} verts:{tv} faces:{tf}")
print("VALIDATION OK — Blender parsed the NIF with no error")
