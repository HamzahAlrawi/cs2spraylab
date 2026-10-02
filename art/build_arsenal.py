"""Export native world meshes and transparent loadout previews, in background Blender."""
import bpy
import json
from pathlib import Path
from mathutils import Vector

root = Path(globals().get('SPRAYLAB_ROOT', Path.cwd()))
ids = list(json.loads((root / 'src/range/game-data.json').read_text())['weapons']) + ['knife', 'knife-butterfly']
out = root / 'public/revamp/models'
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 12
scene.render.resolution_x = 480
scene.render.resolution_y = 240
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.5, .55, .6, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .8
for ident in ids:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(root / 'research/raw-models' / (ident + '.glb')))
    meshes = [o for o in scene.objects if o.type == 'MESH']
    if any('hd' in o.name.lower() for o in meshes):
        meshes = [o for o in meshes if 'legacy' not in o.name.lower()]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in scene.objects:
        obj.hide_render = obj not in meshes
    for obj in meshes:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out / (ident + '.glb')), export_format='GLB', use_selection=True, export_animations=False)
    points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector([min(p[i] for p in points) for i in range(3)])
    hi = Vector([max(p[i] for p in points) for i in range(3)])
    center = (lo + hi) / 2
    cam = bpy.data.objects.new('Preview camera', bpy.data.cameras.new('Preview camera'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(hi - lo) * 1.4
    cam.location = center + Vector((2.4, -1.3, .7))
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    for location in [(2, -3, 4), (-2, 1, 2)]:
        light = bpy.data.objects.new('Softbox', bpy.data.lights.new('Softbox', 'AREA'))
        scene.collection.objects.link(light)
        light.location = location
        light.data.energy = 220
        light.data.size = 4
        light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(out / (ident + '.png'))
    bpy.ops.render.render(write_still=True)
    print('EXPORTED world and preview', ident, flush=True)
