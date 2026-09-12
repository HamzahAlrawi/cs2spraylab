"""Rebuild native posed assets in an isolated Blender scene. Run through MCP."""
import bpy, json, math, os
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(globals().get('SPRAYLAB_ROOT', os.getcwd()))
OUT = ROOT / 'public/revamp/models'; OUT.mkdir(parents=True, exist_ok=True)
weapons = json.loads((ROOT / 'src/range/game-data.json').read_text())['weapons']
clips = dict(ak47='idle_ak', m4a4='idle_m4a4', m4a1s='idle_rifle', galil='idle_galilar', famas='idle_famas', sg553='idle_sg556', aug='idle_aug', mp9='idle_mp9', mp7='idle_mp7', mp5sd='idle_mp5sd', mac10='idle_mac10', ump45='idle_ump45', p90='idle_p90', bizon='idle_bizon', m249='idle1_m249', negev='idle_negev', cz75a='idle_cz75a')
scene = bpy.data.scenes.new('SprayLab Native Assembly'); bpy.context.window.scene = scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 16
scene.render.resolution_x = 640; scene.render.resolution_y = 360; scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.world = bpy.data.worlds.new('SprayLab soft studio'); scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.5, .55, .6, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .8
scene.view_settings.view_transform = 'AgX'

def import_glb(name):
    before = set(scene.objects); actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'research/raw-models' / (name+'.glb')))
    return list(set(scene.objects)-before), list(set(bpy.data.actions)-actions)

def choose_pose(objects, actions, name, category):
    action = next(a for a in actions if '/'+category+'/' in a.name and a.name.split('/')[-1].split('.')[0] == name)
    for rig in [o for o in objects if o.type == 'ARMATURE']:
        slot = next((s for s in action.slots if s.identifier[2:] == rig.name), None)
        if slot:
            rig.animation_data_create(); rig.animation_data.action = action; rig.animation_data.action_slot = slot
    scene.frame_set(0); bpy.context.view_layer.update()
    return action

def bake(obj, name=None):
    deps = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
    result = bpy.data.objects.new(name or obj.name, mesh); scene.collection.objects.link(result)
    result.matrix_world = obj.matrix_world.copy()
    return result

def export(objects, ident, animated=False):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.hide_set(False); obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / (ident+'.glb')), export_format='GLB', use_selection=True, use_active_scene=True,
        export_animations=animated, export_animation_mode='NLA_TRACKS', export_anim_single_armature=False, export_frame_range=False, export_image_format='AUTO')
    print('EXPORTED', ident)

def hide(objects):
    for obj in objects: obj.hide_render = True; obj.hide_set(True)

def bounds(objects):
    pts = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi

cam = bpy.data.objects.new('Native asset camera', bpy.data.cameras.new('Native asset camera')); scene.collection.objects.link(cam); scene.camera = cam
def point(obj, target): obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z', 'Y').to_euler()
for pos, energy, size in [((2,-3,4),220,4), ((-2,1,2),160,3)]:
    lamp = bpy.data.objects.new('Native softbox', bpy.data.lights.new('Native softbox', 'AREA'))
    scene.collection.objects.link(lamp); lamp.location = pos; lamp.data.energy = energy; lamp.data.size = size; point(lamp, (0,0,0))

source, actions = import_glb('view-arms')
character = next(o for o in source if o.type == 'ARMATURE' and 'ctm_sas' in o.name)
hide(source)
for ident in weapons:
    choose_pose(source, actions, clips[ident], 'viewmodel')
    hands = [bake(o, 'view_'+ident+'_'+o.name.split('.')[-1]) for o in source if o.type == 'MESH' and 'firstperson_' in o.name]
    imported, _ = import_glb(ident)
    meshes = [o for o in imported if o.type == 'MESH']
    hd = any('hd' in o.name.lower() for o in meshes)
    meshes = [o for o in meshes if not (hd and 'legacy' in o.name.lower())]
    export(meshes, ident)
    lo, hi = bounds(meshes); center = (lo+hi)/2
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = max(hi-lo)*1.4
    cam.location = center+Vector((2.4,-1.3,.7)); point(cam, center)
    for o in imported: o.hide_render = o not in meshes
    for o in hands: o.hide_render = True
    scene.render.filepath = str(OUT/(ident+'.png')); bpy.ops.render.render(write_still=True)
    bone = character.pose.bones['wpn']
    secondary = next(o for o in source if o.type == 'ARMATURE' and o.name.split('.vnmskel')[0] == weapons[ident]['skeleton'].split('.vnmskel')[0])
    weapon_basis = secondary.matrix_world @ secondary.pose.bones['weapon'].bone.matrix_local
    attachment = character.matrix_world @ bone.matrix @ weapon_basis.inverted()
    posed = [bake(o, 'held_weapon_'+ident) for o in meshes]
    for o in posed: o.matrix_world = attachment @ o.matrix_world
    for o in hands: o.hide_render = False
    hide(imported)
    export(hands+posed, 'view-'+ident)
    if ident == 'ak47':
        cam.data.type = 'PERSP'; cam.data.lens = 35; cam.location = (0,0,0); point(cam, (0,-1,0))
        scene.render.filepath = str(ROOT/'research/native-view.png'); bpy.ops.render.render(write_still=True)
        print('VIEW BOUNDS', [list(v) for v in bounds(hands+posed)])
    hide(hands+posed)

# Keep the original authored world rifle pose and strafe cycles, including fingers.
target, target_actions = import_glb('target-native')
world_action = choose_pose(target, target_actions, 'idle_rifle', 'world')
rig = next(o for o in target if o.type == 'ARMATURE' and 'ctm_sas' in o.name)
meshes = [o for o in target if o.type == 'MESH' and 'thirdperson_' in o.name]
for o in target:
    if o not in meshes and o != rig: o.hide_render = True
held, _ = import_glb('m4a1s')
gun = [o for o in held if o.type == 'MESH' and 'legacy' not in o.name.lower()]
bone = rig.pose.bones['wpn']
secondary = next(o for o in target if o.type == 'ARMATURE' and 'm4a1_silencer' in o.name)
weapon_basis = secondary.matrix_world @ secondary.pose.bones['weapon'].bone.matrix_local
for o in gun:
    o.name = 'held_weapon_target'
    transform = rig.matrix_world @ bone.matrix @ weapon_basis.inverted() @ o.matrix_world
    o.parent = rig; o.parent_type = 'BONE'; o.parent_bone = 'wpn'
    bpy.context.view_layer.update()
    o.matrix_world = transform
    bpy.context.view_layer.update()
rig.animation_data.action = None
for track in list(rig.animation_data.nla_tracks): rig.animation_data.nla_tracks.remove(track)
for a in target_actions:
    if '/world/' in a.name:
        track = rig.animation_data.nla_tracks.new(); track.name = a.name
        strip = track.strips.new(a.name, 0, a)
        strip.action_slot = next(s for s in a.slots if s.identifier[2:] == rig.name)
        track.mute = a != world_action
export([rig]+meshes+gun, 'target', True)
for track in rig.animation_data.nla_tracks: track.mute = True
rig.animation_data.action = world_action
rig.animation_data.action_slot = next(s for s in world_action.slots if s.identifier[2:] == rig.name)
for o in [rig]+meshes+gun: o.hide_render = False; o.hide_set(False)
scene.frame_set(0); bpy.context.view_layer.update()
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.8; cam.location = (2,-4,1.7); point(cam, (0,0,1))
scene.render.filepath = str(ROOT/'research/native-target.png'); bpy.ops.render.render(write_still=True)
scene.render.filepath = str(OUT/'target.png'); bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art/spraylab-native-workshop.blend'))
