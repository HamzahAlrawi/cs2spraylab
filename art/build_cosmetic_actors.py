"""Native actor-only exports in isolated background Blender; no assembly edits."""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path.cwd()
spec = json.loads((ROOT / sys.argv[sys.argv.index('--') + 1]).read_text())
scene = bpy.context.scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def load(file):
    before, actions = set(scene.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / file))
    return list(set(scene.objects) - before), list(set(bpy.data.actions) - actions)


objects, actions = load(spec['raw'])
rig = next(obj for obj in objects if obj.type == 'ARMATURE' and obj.data.bones.get('hand_R'))
if spec['equipment'] == 'agent':
    meshes = [obj for obj in objects if obj.type == 'MESH' and
              ('thirdperson_' in obj.name or obj.name.endswith('.defusekit'))]
else:
    meshes = [obj for obj in objects if obj.type == 'MESH' and obj.vertex_groups and obj.name.endswith('.viewmodel')]
if not meshes:
    raise RuntimeError('No native actor meshes: ' + spec['id'])
for obj in objects:
    if obj.animation_data:
        obj.animation_data.action = None
        for track in list(obj.animation_data.nla_tracks):
            obj.animation_data.nla_tracks.remove(track)

if spec['equipment'] == 'gloves':
    # Use the canonical agent's transformed bind coordinates, not its animated
    # idle pose. Per-bone inverse binds remain native and are rebound by name.
    reference, _ = load(spec['reference'])
    canonical = next(obj for obj in reference if obj.type == 'ARMATURE' and 'ctm_sas' in obj.name)
    source_hand = rig.matrix_world @ rig.data.bones['hand_R'].matrix_local
    target_hand = canonical.matrix_world @ canonical.data.bones['hand_R'].matrix_local
    transform = target_hand @ source_hand.inverted()
    # Native glove exports use the same humanoid bind proportions. Fail instead
    # of silently fitting a mismatched skeleton with a guessed offset.
    error = max(max(abs((transform @ rig.matrix_world @ rig.data.bones[name].matrix_local)[r][c] -
                        (canonical.matrix_world @ canonical.data.bones[name].matrix_local)[r][c])
                    for r in range(4) for c in range(4))
                for name in ['hand_L', 'hand_R', 'finger_index_1_L', 'finger_index_1_R'])
    if error > .002:
        raise RuntimeError(f'Incompatible native glove bind coordinates: {error}')
    # Transform root objects once; children already inherit their parent matrix.
    for obj in objects:
        if obj.parent not in objects:
            obj.matrix_world = transform @ obj.matrix_world
    for obj in reference:
        obj.hide_render = True
        obj.hide_set(True)
    color = next(t for t in spec['textures'] if t['name'] == 'approxAlbedo')
    normal = next((t for t in spec['textures'] if t['name'] == 'g_tNormal'), None)
    for obj in meshes:
        for index, existing in enumerate(obj.data.materials):
            # Bare forearms/fingertips retain their authored skin material.
            if not any(word in existing.name.lower() for word in ['glove', 'handwrap']):
                continue
            material = existing.copy()
            material.name = spec['id'] + '_' + existing.name
            material.use_nodes = True
            nodes, links = material.node_tree.nodes, material.node_tree.links
            shader = nodes.get('Principled BSDF')
            image = nodes.new('ShaderNodeTexImage')
            image.image = bpy.data.images.load(str(ROOT / color['file']), check_existing=True)
            links.new(image.outputs['Color'], shader.inputs['Base Color'])
            shader.inputs['Metallic'].default_value = .05
            shader.inputs['Roughness'].default_value = .65
            if normal:
                bump = nodes.new('ShaderNodeTexImage')
                bump.image = bpy.data.images.load(str(ROOT / normal['file']), check_existing=True)
                bump.image.colorspace_settings.name = 'Non-Color'
                normal_map = nodes.new('ShaderNodeNormalMap')
                links.new(bump.outputs['Color'], normal_map.inputs['Color'])
                links.new(normal_map.outputs['Normal'], shader.inputs['Normal'])
            obj.data.materials[index] = material

exported_actions = []
collapsed_helpers = []
if spec['equipment'] == 'gloves':
    # These fixed attachment helpers carry no animation. Folding their weights
    # into their native hand parent preserves the bind deformation exactly.
    for side in ['L', 'R']:
        name = 'attachHand_' + side
        helper = rig.data.bones.get(name)
        if not helper:
            continue
        parent = helper.parent
        if not parent or parent.name != 'hand_' + side or helper.children:
            raise RuntimeError('Unexpected native hand attachment hierarchy: ' + name)
        for obj in meshes:
            old = obj.vertex_groups.get(name)
            if not old:
                continue
            target = obj.vertex_groups.get(parent.name) or obj.vertex_groups.new(name=parent.name)
            for vertex in obj.data.vertices:
                weight = sum(group.weight for group in vertex.groups if group.group == old.index)
                if weight:
                    target.add([vertex.index], weight, 'ADD')
            obj.vertex_groups.remove(old)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode='EDIT')
        rig.data.edit_bones.remove(rig.data.edit_bones[name])
        bpy.ops.object.mode_set(mode='OBJECT')
        collapsed_helpers.append(name)
if spec['equipment'] == 'agent':
    for action in actions:
        if '/world/' not in action.name:
            continue
        slot = next((slot for slot in action.slots if slot.identifier[2:] == rig.name), None)
        if slot:
            rig.animation_data_create()
            track = rig.animation_data.nla_tracks.new()
            track.name = action.name
            strip = track.strips.new(action.name, 0, action)
            strip.action_slot = slot
            track.mute = not action.name.endswith('/idle_rifle')
            exported_actions.append(action.name)

for obj in meshes:
    obj['actor_cosmetic'] = spec['id']
    obj['actor_equipment'] = spec['equipment']
    obj['native_model'] = spec['source']
    obj['native_build'] = spec['build']
    if spec['equipment'] == 'gloves':
        obj.name = 'firstperson_cosmetic_gloves_' + obj.name.split('.')[-1]
        obj['bind_space'] = 'native-ctm-sas-transformed-bind-v1'

scene.frame_set(0)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for obj in [rig] + meshes:
    obj.hide_set(False)
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT / spec['output']), export_format='GLB', use_selection=True,
    export_animations=spec['equipment'] == 'agent', export_animation_mode='NLA_TRACKS',
    export_anim_single_armature=False, export_frame_range=False, export_extras=True)

# Render the exported geometry, with an authored idle only for agent previews.
for obj in scene.objects:
    obj.hide_render = obj not in meshes
if spec['equipment'] == 'agent':
    idle = next((action for action in actions if action.name.endswith('/world/idle_rifle')), None)
    if idle:
        for track in rig.animation_data.nla_tracks:
            track.mute = True
        rig.animation_data.action = idle
        rig.animation_data.action_slot = next(slot for slot in idle.slots if slot.identifier[2:] == rig.name)
scene.frame_set(0)
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.evaluated_get(deps).bound_box]
lo = Vector([min(p[i] for p in points) for i in range(3)])
hi = Vector([max(p[i] for p in points) for i in range(3)])
center = (lo + hi) / 2
scene.render.engine = 'CYCLES'
scene.cycles.samples = 12
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.45, .5, .55, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .8
scene.view_settings.view_transform = 'AgX'
camera = bpy.data.objects.new('Actor preview', bpy.data.cameras.new('Actor preview'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.type = 'ORTHO'
camera.data.ortho_scale = max(hi - lo) * 1.25
camera.location = center + Vector((2.5, -4, 1.6) if spec['equipment'] == 'agent' else (.1, -1, 2))
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
for offset in [(2, -3, 4), (-2, 1, 3)]:
    light = bpy.data.objects.new('Actor softbox', bpy.data.lights.new('Actor softbox', 'AREA'))
    scene.collection.objects.link(light)
    light.location = center + Vector(offset)
    light.data.energy = 220
    light.data.size = 4
    light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = str(ROOT / spec['preview'])
bpy.ops.render.render(write_still=True)
audit = {'vertices': sum(len(obj.data.vertices) for obj in meshes),
         'triangles': sum(len(face.vertices) - 2 for obj in meshes for face in obj.data.polygons),
         'meshes': [obj.name for obj in meshes], 'bones': [bone.name for bone in rig.data.bones],
         'bounds': [list(lo), list(hi)], 'animations': exported_actions,
         'bindSpace': 'native-ctm-sas-transformed-bind-v1' if spec['equipment'] == 'gloves' else 'native-agent',
         'heldWeapon': False, 'collapsedFixedHandHelpers': collapsed_helpers}
(ROOT / 'research/cosmetic-actors' / (spec['id'] + '-export.json')).write_text(json.dumps(audit, indent=2) + '\n')
print('EXPORTED actor', spec['id'], audit['vertices'], flush=True)
