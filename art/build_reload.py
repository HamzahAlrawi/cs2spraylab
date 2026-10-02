"""Bake native first-person arms and matching weapon-part motion into one GLB.

Invoked in isolated background Blender by tools/build-reload.mjs. Never uses world
animations or invents a missing action. Native bind exports are owned by importers.
"""
import bpy
import json
import os
import sys
from pathlib import Path

ROOT = Path(os.getcwd())
spec = json.loads((ROOT / sys.argv[sys.argv.index('--') + 1]).read_text())
ident = spec['id']
asset_key = spec.get('assetKey', ident)
variant = spec.get('variant', 'hd')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.fps = 30


def load(file):
    before, actions = set(scene.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / file))
    return list(set(scene.objects) - before), list(set(bpy.data.actions) - actions)


source, actions = load(spec['source'])
# Native four-decimal seconds and float32 storage can put a 30 Hz endpoint
# within 0.002 frames of an integer. NLA flooring otherwise drops a full frame.
for action in actions:
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for key in curve.keyframe_points:
                        rounded = round(key.co.x)
                        if abs(key.co.x - rounded) < .002:
                            shift = rounded - key.co.x
                            key.co.x = rounded
                            key.handle_left.x += shift
                            key.handle_right.x += shift
character = next(o for o in source if o.type == 'ARMATURE' and 'ctm_sas' in o.name)
hands = [o for o in source if o.type == 'MESH' and 'firstperson_' in o.name]
if not hands:
    raise RuntimeError('Native first-person arm meshes are missing')
for obj in source:
    if obj.animation_data:
        obj.animation_data.action = None
        for track in list(obj.animation_data.nla_tracks):
            obj.animation_data.nla_tracks.remove(track)

imported, _ = load(spec['bind'])
meshes = [o for o in imported if o.type == 'MESH' and o.vertex_groups]
# Bodygroups such as the Dualies world holster must never enter the viewmodel.
bodygroups = [o for o in meshes if 'body_' in o.name.lower()]
if bodygroups:
    meshes = [o for o in bodygroups if ('legacy' if variant == 'legacy' else 'hd') in o.name.lower()]
    if not meshes:
        raise RuntimeError(f'{ident}: missing native {variant} bodygroup')
elif variant == 'legacy':
    raise RuntimeError(f'{ident}: no legacy bodygroup')
if not meshes:
    raise RuntimeError('Native skinned weapon meshes are missing')
rigs = {m.object for obj in meshes for m in obj.modifiers if m.type == 'ARMATURE'}
if len(rigs) != 1:
    raise RuntimeError('Selected bodygroup must share exactly one native skin rig')
rig = rigs.pop()
skeleton = spec['skeleton'].split('.vnmskel')[0]
secondary = next((o for o in source if o.type == 'ARMATURE' and o.name.split('.vnmskel')[0] == skeleton), None)
if secondary is None:
    raise RuntimeError('No authored secondary skeleton for ' + skeleton)
original_world = rig.matrix_world.copy()
bind_root = original_world @ rig.data.bones['weapon'].matrix_local
anim_root = secondary.matrix_world @ secondary.data.bones['weapon'].matrix_local


def slot_for(action, obj):
    slot = next((s for s in action.slots if s.identifier[2:] == obj.name), None)
    if slot is None:
        raise RuntimeError('Missing native action slot: ' + action.name + ' / ' + obj.name)
    return slot


def pose(action):
    for obj in source:
        if obj.type != 'ARMATURE':
            continue
        obj.animation_data_create()
        obj.animation_data.action = None
        for bone in obj.pose.bones:
            bone.matrix_basis.identity()
        slot = next((s for s in action.slots if s.identifier[2:] == obj.name), None)
        if slot:
            obj.animation_data.action = action
            obj.animation_data.action_slot = slot


def matrix_error(actual, expected):
    return max(abs(actual[r][c] - expected[r][c]) for r in range(4) for c in range(4))


def continuous_quaternion(obj, previous):
    rotation = obj.rotation_quaternion
    if previous is not None and rotation.dot(previous) < 0:
        rotation.negate()
    return rotation.copy()


exported, inventory = [], {}
for label, resource in spec['clips'].items():
    native_path = resource.removesuffix('.vnmclip_c')
    # Blender truncates long action IDs. Accept only an unambiguous full prefix
    # of the audited resource, and still verify both native action slots below.
    matching = [a for a in actions if a.name.split('.')[0] == native_path or
                len(a.name.split('.')[0]) >= 59 and native_path.startswith(a.name.split('.')[0])]
    if not matching and label == 'reload-empty':
        print('Native optional empty-reload is not referenced by this agent model:', resource, flush=True)
        continue
    if len(matching) != 1:
        raise RuntimeError('Missing/ambiguous exact first-person action: ' + native_path)
    native = matching[0]
    slot_for(native, character)
    slot_for(native, secondary)
    pose(native)
    action = bpy.data.actions.new(asset_key + '_' + label)
    rig.animation_data_create()
    rig.animation_data.action = action
    rig.rotation_mode = 'QUATERNION'
    rig.matrix_world = original_world
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    # Source2Viewer converts native timestamps to seconds; Blender imports at scene FPS.
    start, end = map(float, native.frame_range)
    frames = [float(frame) for frame in range(int(start), int(end) + 1)]
    if not frames or frames[-1] < end - 1e-5:
        frames.append(end)
    max_error, max_mount_error = 0, 0
    rotations, root_rotation = {}, None
    for frame in frames:
        scene.frame_set(int(frame), subframe=frame - int(frame))
        bpy.context.view_layer.update()
        for bone in sorted(rig.pose.bones, key=lambda b: len(b.parent_recursive)):
            authored = secondary.pose.bones.get(bone.name)
            if not authored:
                continue
            bone.rotation_mode = 'QUATERNION'
            expected = original_world.inverted() @ bind_root @ anim_root.inverted() @ secondary.matrix_world @ authored.matrix
            bone.matrix = expected
            bpy.context.view_layer.update()
            rotations[bone.name] = continuous_quaternion(bone, rotations.get(bone.name))
            max_error = max(max_error, matrix_error(bone.matrix, expected))
            for prop in ['location', 'rotation_quaternion', 'scale']:
                bone.keyframe_insert(prop, frame=frame)
        expected_mount = character.matrix_world @ character.pose.bones['wpn'].matrix @ bind_root.inverted() @ original_world
        rig.matrix_world = expected_mount
        root_rotation = continuous_quaternion(rig, root_rotation)
        bpy.context.view_layer.update()
        max_mount_error = max(max_mount_error, matrix_error(rig.matrix_world, expected_mount))
        for prop in ['location', 'rotation_quaternion', 'scale']:
            rig.keyframe_insert(prop, frame=frame)
    if max_error > 1e-4:
        raise RuntimeError(f'{ident}/{label}: weapon retarget matrix error {max_error}')
    if max_mount_error > 1e-4:
        raise RuntimeError(f'{ident}/{label}: weapon attachment matrix error {max_mount_error}')
    exported.append((label, native, action))
    inventory[label] = {**spec['nativeFiles'][label], 'seconds': (end - start) / scene.render.fps,
                        'samples': len(frames), 'maxPartMatrixError': max_error,
                        'maxMountMatrixError': max_mount_error, 'quaternionContinuity': True,
                        'armSlot': slot_for(native, character).identifier,
                        'weaponSlot': slot_for(native, secondary).identifier}

for obj in [character, rig]:
    obj.animation_data.action = None
    for track in list(obj.animation_data.nla_tracks):
        obj.animation_data.nla_tracks.remove(track)
for label, native, baked in exported:
    for obj, action in [(character, native), (rig, baked)]:
        track = obj.animation_data.nla_tracks.new()
        track.name = label
        strip = track.strips.new(label, 0, action)
        strip.action_slot = slot_for(action, obj)
        track.mute = label != 'idle'
scene.frame_set(0)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for obj in [character, rig] + hands + meshes:
    obj.select_set(True)
for obj in meshes:
    obj['assembly_version'] = 5
    obj['native_view_variant'] = variant
    obj['native_view_weapon'] = ident
    obj['native_view_build'] = spec['build']
    obj['native_actions'] = spec['clips']
    if 'reload' in spec['clips']:
        obj['native_reload'] = Path(spec['clips']['reload']).name.removesuffix('.vnmclip_c')
bpy.ops.export_scene.gltf(filepath=str(ROOT / spec['output']), export_format='GLB',
    use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS',
    export_anim_single_armature=False, export_frame_range=False, export_extras=True)
(ROOT / 'research/weapon-actions' / (asset_key + '-export.json')).write_text(json.dumps({
    'assetKey': asset_key, 'variant': variant, 'assemblyVersion': 5,
    'build': spec['build'], 'sourceModel': 'agents/models/ctm_sas/ctm_sas.vmdl_c',
    'sourceSha256': spec['sourceSha256'], 'bindSha256': spec['bindSha256'],
    'skeleton': spec['skeleton'], 'pickup': spec['pickup'], 'clips': inventory,
    'actionAudit': spec.get('actionAudit'),
    'meshes': [o.name for o in hands + meshes],
    'limitations': ['Native twist/IK runtime solvers are not reproduced; authored arm tracks retained.',
                    'Call prepareNativeViewAssembly after GLTF load to prevent stale skinned frustum bounds.'],
}, indent=2) + '\n')
print('EXPORTED native view actions', ident, list(inventory), flush=True)
