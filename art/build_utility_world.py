"""Native grenade meshes in meters, with spent pins/levers omitted in flight."""
import bpy
import bmesh
import sys
import json
from pathlib import Path

root = Path.cwd()
spec = json.loads((root / sys.argv[sys.argv.index('--') + 1]).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root / spec['bind']))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.vertex_groups]
if not meshes:
    raise RuntimeError('Native grenade skin is missing')
originals = list(meshes)
for variant in ['world', 'projectile']:
    baked = []
    for source in originals:
        obj = source.copy()
        obj.data = source.data.copy()
        bpy.context.scene.collection.objects.link(obj)
        omitted = {'lighter', 'lighter_flame', 'lighter_hinge', 'lighter_lever'}
        if variant == 'projectile':
            omitted |= {'pin', 'ring', 'handle'}
        groups = {group.index for group in obj.vertex_groups if group.name in omitted}
        remove = {v.index for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in groups) > .5}
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index in remove], context='VERTS')
        bm.to_mesh(obj.data)
        bm.free()
        bpy.context.view_layer.update()
        data = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()), preserve_all_data_layers=True,
                                              depsgraph=bpy.context.evaluated_depsgraph_get())
        data.transform(obj.matrix_world)
        static = bpy.data.objects.new(spec['id'] + '-' + variant, data)
        bpy.context.scene.collection.objects.link(static)
        static['native_utility_build'] = spec['build']
        static['native_utility_source'] = spec['bindSha256']
        static['native_utility_variant'] = variant
        bpy.data.objects.remove(obj, do_unlink=True)
        baked.append(static)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in baked:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(root / 'research/blender-exports' / (spec['id'] + '-' + variant + '.glb')),
                             export_format='GLB', use_selection=True, export_animations=False, export_extras=True)
    for obj in baked:
        bpy.data.objects.remove(obj, do_unlink=True)
