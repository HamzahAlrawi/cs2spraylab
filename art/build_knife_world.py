"""Export native skinned knife binds; paint masks stay in their authored UV space."""
import bpy
import json
import sys
from pathlib import Path

root = Path.cwd()
spec = json.loads((root / sys.argv[sys.argv.index('--') + 1]).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root / spec['bind']))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.vertex_groups]
body = [o for o in meshes if 'body_' in o.name.lower()]
if body:
    meshes = [o for o in body if spec['variant'] in o.name.lower()]
if not meshes:
    raise RuntimeError('No selected native knife bodygroup')
rigs = {m.object for o in meshes for m in o.modifiers if m.type == 'ARMATURE'}
if len(rigs) != 1:
    raise RuntimeError('Knife meshes must share one native skeleton')
bpy.ops.object.select_all(action='DESELECT')
for obj in list(rigs) + meshes:
    obj.select_set(True)
    obj['native_knife_asset'] = spec['assetKey']
bpy.ops.export_scene.gltf(filepath=str(root / 'research/blender-exports' / (spec['assetKey'] + '.glb')),
    export_format='GLB', use_selection=True, export_animations=False, export_extras=True)
