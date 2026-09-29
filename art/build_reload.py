"""Export native skinned hands and weapon-part reloads. Run in background Blender."""
import bpy, json, os, sys
from pathlib import Path

ROOT = Path(os.getcwd())
OUT = ROOT / 'public/revamp/models'
data = json.loads((ROOT / 'src/range/game-data.json').read_text())['weapons']
data.update(json.loads((ROOT / 'src/range/equipment-data.json').read_text())['weapons'])
names = dict(ak47='ak', m4a4='m4a4', m4a1s='rifle', galil='galilar', famas='famas', sg553='sg556',
             aug='aug', mp9='mp9', mp7='mp7', mp5sd='mp5sd', mac10='mac10', ump45='ump45', p90='p90',
             bizon='bizon', m249='m249', negev='negev', cz75a='cz75a', usp='pistol')
ids = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(names)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.fps = 30

def load(name):
    before, actions = set(scene.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'research/raw-models' / (name + '.glb')))
    return list(set(scene.objects) - before), list(set(bpy.data.actions) - actions)

source, actions = load('reload-arms')
character = next(o for o in source if o.type == 'ARMATURE' and 'ctm_sas' in o.name)
hands = [o for o in source if o.type == 'MESH' and 'firstperson_' in o.name]

def pose(action):
    for obj in source:
        if obj.type != 'ARMATURE': continue
        slot = next((s for s in action.slots if s.identifier[2:] == obj.name), None)
        if slot:
            obj.animation_data_create()
            obj.animation_data.action = action
            obj.animation_data.action_slot = slot

for ident in ids:
    for obj in source:
        if obj.animation_data:
            for track in list(obj.animation_data.nla_tracks): obj.animation_data.nla_tracks.remove(track)
    imported, _ = load(ident + '-rigged')
    rig = next(o for o in imported if o.type == 'ARMATURE')
    meshes = [o for o in imported if o.type == 'MESH' and o.vertex_groups]
    if any('hd' in o.name.lower() for o in meshes): meshes = [o for o in meshes if 'legacy' not in o.name.lower()]
    secondary = next(o for o in source if o.type == 'ARMATURE' and o.name.split('.vnmskel')[0] == data[ident]['skeleton'].split('.vnmskel')[0])
    original_world = rig.matrix_world.copy()
    bind_root = original_world @ rig.data.bones['weapon'].matrix_local
    anim_root = secondary.matrix_world @ secondary.data.bones['weapon'].matrix_local
    exported = []
    for label in ['idle', 'reload']:
        clip_name = ('idle1_m249' if ident == 'm249' else 'idle_' + names[ident]) if label == 'idle' else 'reload_' + names[ident]
        native = next(a for a in actions if '/viewmodel/' in a.name and a.name.split('/')[-1].split('.')[0] == clip_name)
        pose(native)
        action = bpy.data.actions.new(ident + '_' + label)
        rig.animation_data_create(); rig.animation_data.action = action
        rig.rotation_mode = 'QUATERNION'
        frames = range(int(native.frame_range[0]), int(native.frame_range[1]) + 1)
        for frame in frames:
            scene.frame_set(frame); bpy.context.view_layer.update()
            for bone in sorted(rig.pose.bones, key=lambda b: len(b.parent_recursive)):
                authored = secondary.pose.bones.get(bone.name)
                if authored:
                    bone.rotation_mode = 'QUATERNION'
                    bone.matrix = original_world.inverted() @ bind_root @ anim_root.inverted() @ secondary.matrix_world @ authored.matrix
                    bpy.context.view_layer.update()
                    for prop in ['location', 'rotation_quaternion', 'scale']: bone.keyframe_insert(prop, frame=frame)
            rig.matrix_world = character.matrix_world @ character.pose.bones['wpn'].matrix @ bind_root.inverted() @ original_world
            for prop in ['location', 'rotation_quaternion', 'scale']: rig.keyframe_insert(prop, frame=frame)
        exported.append((label, native, action))
    for obj in [character, rig]: obj.animation_data.action = None
    for label, native, baked in exported:
        for obj, action in [(character, native), (rig, baked)]:
            track = obj.animation_data.nla_tracks.new(); track.name = label
            strip = track.strips.new(label, 0, action)
            strip.action_slot = next(s for s in action.slots if s.identifier[2:] == obj.name)
            track.mute = label != 'idle'
    scene.frame_set(0); bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [character, rig] + hands + meshes: obj.select_set(True)
    for obj in meshes:
        obj['assembly_version'] = 3
        obj['native_reload'] = 'reload_' + names[ident]
    bpy.ops.export_scene.gltf(filepath=str(OUT / ('view-' + ident + '.glb')), export_format='GLB',
        use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS',
        export_anim_single_armature=False, export_frame_range=False, export_extras=True)
    print('EXPORTED native reload', ident, flush=True)
    for obj in imported: bpy.data.objects.remove(obj, do_unlink=True)
