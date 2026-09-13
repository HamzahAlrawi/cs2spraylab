"""Check the exported target's rifle attachment through all locomotion clips."""
import bpy, json
from pathlib import Path
from mathutils.bvhtree import BVHTree

root = Path(SPRAYLAB_ROOT)
previous_scene = bpy.context.window.scene
scene = bpy.data.scenes.new('SprayLab Grip Verification'); bpy.context.window.scene = scene
before = set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=str(root / 'research/blender-exports/target.glb'))
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
guns = [o for o in scene.objects if o.type == 'MESH' and 'held_weapon_target' in o.name]
assert guns, 'Exported target rifle missing'
for track in rig.animation_data.nla_tracks: track.mute = True
report = []
for action in set(bpy.data.actions) - before:
    if '/world/' not in action.name: continue
    rig.animation_data.action = action
    rig.animation_data.action_slot = next(s for s in action.slots if s.identifier[2:] == rig.name)
    start, end = action.frame_range
    for fraction in [0, .25, .5, .75, 1]:
        frame = start + (end-start) * fraction
        scene.frame_set(int(frame), subframe=frame % 1); bpy.context.view_layer.update()
        vertices, polygons = [], []
        for gun in guns:
            offset = len(vertices)
            vertices.extend(gun.matrix_world @ v.co for v in gun.data.vertices)
            polygons.extend([offset+i for i in p.vertices] for p in gun.data.polygons)
        tree = BVHTree.FromPolygons(vertices, polygons)
        distances = []
        for side in ['L', 'R']:
            probes = [rig.matrix_world @ rig.pose.bones[name+'_'+side].head for name in ['finger_middle_1', 'finger_index_1', 'finger_thumb_2']]
            distances.append(min(tree.find_nearest(p)[3] for p in probes))
        report.append({'clip': action.name, 'fraction': fraction, 'distances': distances})
        assert max(distances) < .045, f'Detached grip: {report[-1]}'
bpy.context.window.scene = previous_scene
(root / 'research/target-grip-verification.json').write_text(json.dumps(report, indent=2))
assert len(report) == 15, 'Expected idle and both strafe clips'
print('GRIP target: 15 animation samples passed; max distance', max(max(r['distances']) for r in report))
