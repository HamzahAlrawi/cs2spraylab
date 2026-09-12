import bpy, os
from pathlib import Path
from mathutils import Vector
root = Path(globals().get('SPRAYLAB_ROOT',os.getcwd()))
scene = bpy.data.scenes.new('SprayLab Target Preview'); bpy.context.window.scene = scene
before = set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=str(root/'research/blender-exports/target.glb'))
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
action = next(a for a in set(bpy.data.actions)-before if '/world/' in a.name and '/idle_rifle' in a.name)
for track in rig.animation_data.nla_tracks: track.mute = True
rig.animation_data.action = action; rig.animation_data.action_slot = next(s for s in action.slots if s.identifier[2:] == rig.name)
scene.frame_set(0); bpy.context.view_layer.update()
scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.render.resolution_x=512; scene.render.resolution_y=512; scene.render.resolution_percentage=100; scene.render.film_transparent=True
scene.world=bpy.data.worlds.new('Target studio'); scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.6,.65,.7,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
cam=bpy.data.objects.new('Target portrait',bpy.data.cameras.new('Target portrait')); scene.collection.objects.link(cam); scene.camera=cam
cam.data.type='ORTHO';cam.data.ortho_scale=2.1;cam.location=(0,-4,1.4)
cam.rotation_euler=(Vector((0,0,.93))-cam.location).to_track_quat('-Z','Y').to_euler()
for pos in [(2,-3,4),(-2,-2,2)]:
    o=bpy.data.objects.new('Portrait softbox',bpy.data.lights.new('Portrait softbox','AREA'));scene.collection.objects.link(o)
    o.location=pos;o.data.energy=160;o.data.size=3;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(root/'public/revamp/models/target.png');bpy.ops.render.render(write_still=True)
print('EXPORTED target thumbnail')
