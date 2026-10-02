"""Bake native-proportion falls with isolated, offline Blender Bullet physics."""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

SPEC = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text())
UNIT = .0254
FPS = SPEC['fps']
LAST = round(SPEC['duration'] * FPS) + 1
BASIS = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
INVERSE_BASIS = BASIS.inverted()
NATIVE_NAMES = {b['name'].lower(): b['name'] for b in SPEC['skeleton']}


def quat(values):
    return Quaternion((values[3], values[0], values[1], values[2])).normalized()


def matrix(position, rotation):
    return Matrix.Translation(Vector(position)) @ rotation.to_matrix().to_4x4()


def pose_worlds(pose):
    result = {}
    for bone in SPEC['skeleton']:
        value = pose[bone['name']]
        local = matrix(value['position'], quat(value['quaternion']))
        result[bone['name']] = result[bone['parent']] @ local if bone['parent'] else local
    return result


def choose(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def capsule_mesh(name, center, radius, length):
    vertices, faces = [], []
    for latitude in range(17):
        angle = math.pi * latitude / 16
        z = math.cos(angle) * radius + (length / 2 if latitude <= 8 else -length / 2)
        ring = math.sin(angle) * radius
        for longitude in range(16):
            a = math.tau * longitude / 16
            vertices.append((ring * math.cos(a), ring * math.sin(a), z))
    for row in range(16):
        for col in range(16):
            a = row * 16 + col
            b = row * 16 + (col + 1) % 16
            faces.append((a, b, b + 16, a + 16))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = center
    return obj


def rigid_body(name, definition, bone_world, index):
    shape = definition['m_rnShape']
    if shape['m_capsules']:
        capsule = shape['m_capsules'][0]['m_Capsule']
        a, b = [Vector(v) * UNIT for v in capsule['m_vCenter']]
        local_center = (a + b) / 2
        radius = capsule['m_flRadius'] * UNIT
        length = (b - a).length
        orientation = Vector((0, 0, 1)).rotation_difference((b - a).normalized())
    else:
        sphere = shape['m_spheres'][0]['m_Sphere']
        local_center = Vector(sphere['m_vCenter']) * UNIT
        radius = sphere['m_flRadius'] * UNIT
        length = 0
        orientation = Quaternion()
    shape_to_bone = matrix(local_center, orientation)
    initial = bone_world @ shape_to_bone
    obj = capsule_mesh(name, initial.translation, radius, length)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = initial.to_quaternion()
    choose(obj)
    bpy.ops.rigidbody.object_add()
    rb = obj.rigid_body
    rb.kinematic = True
    rb.mass = definition['m_flMass']
    rb.collision_shape = 'CONVEX_HULL'
    rb.use_margin = True
    rb.collision_margin = .002
    rb.friction = .65
    rb.restitution = 0
    rb.linear_damping = .2
    rb.angular_damping = .35 if name != 'head_0' else .45
    rb.use_deactivation = False
    # No self collision: native weapon-holding starts overlap hand/torso shapes.
    # The connected, angular-limited bodies still collide with the shared floor.
    rb.collision_collections = tuple(i == index for i in range(20))
    return {'object': obj, 'initial': initial, 'shapeToBone': shape_to_bone,
            'shape': {'radius': radius, 'length': length}, 'boneInitial': bone_world}


def local_frame(values):
    return matrix([v * UNIT for v in values[:3]], quat(values[4:8]))


def add_joint(index, definition, bodies):
    phys = SPEC['physics']
    a = NATIVE_NAMES[phys['m_boneNames'][definition['m_nBody1']]]
    b = NATIVE_NAMES[phys['m_boneNames'][definition['m_nBody2']]]
    fa = bodies[a]['boneInitial'] @ local_frame(definition['m_Frame1'])
    fb = bodies[b]['boneInitial'] @ local_frame(definition['m_Frame2'])
    obj = bpy.data.objects.new(f'joint_{index}_{a}_{b}', None)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = (fa.translation + fb.translation) / 2
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = fa.to_quaternion()
    choose(obj)
    bpy.ops.rigidbody.constraint_add()
    joint = obj.rigid_body_constraint
    joint.type = 'GENERIC'
    joint.object1, joint.object2 = bodies[a]['object'], bodies[b]['object']
    joint.disable_collisions = True
    joint.use_override_solver_iterations = True
    joint.solver_iterations = 180
    for axis in 'xyz':
        setattr(joint, 'use_limit_lin_' + axis, True)
        setattr(joint, 'limit_lin_' + axis + '_lower', 0)
        setattr(joint, 'limit_lin_' + axis + '_upper', 0)
        setattr(joint, 'use_limit_ang_' + axis, True)
    # Blender builds frames at the posed orientation. Recenter native limits
    # around that pose instead of forcing a crouched knee back to bind stance.
    delta = (fa.to_quaternion().inverted() @ fb.to_quaternion()).to_euler('XYZ')
    twist = definition['m_TwistLimit']
    # Native frames put hinge/flexion on Z (crouched knees are 83/95 deg
    # about this axis), not Blender Generic's default X angular axis.
    flex = max(twist['m_flMin'], min(twist['m_flMax'], delta.z))
    joint.limit_ang_z_lower = twist['m_flMin'] - flex
    joint.limit_ang_z_upper = twist['m_flMax'] - flex
    swing = definition['m_SwingLimit']['m_flMax'] if definition['m_bEnableSwingLimit'] else 0
    for axis in 'xy':
        setattr(joint, 'limit_ang_' + axis + '_lower', -swing)
        setattr(joint, 'limit_ang_' + axis + '_upper', swing)
    return {'a': a, 'b': b,
            'object': obj,
            'anchorA': bodies[a]['initial'].inverted() @ obj.location,
            'anchorB': bodies[b]['initial'].inverted() @ obj.location}


def setup(stance, direction):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, LAST
    scene.gravity = (0, 0, -800 * UNIT)
    pose = {b['name']: b for b in SPEC['startPoses'][stance]}
    gltf_worlds = pose_worlds(pose)
    worlds = {name: BASIS @ m for name, m in gltf_worlds.items()}
    bodies = {}
    phys = SPEC['physics']
    for index, definition in enumerate(phys['m_parts']):
        name = NATIVE_NAMES[phys['m_boneNames'][index]]
        bodies[name] = rigid_body(name, definition, worlds[name], index)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -.08))
    floor = bpy.context.object
    floor.name = 'Bullet floor'
    floor.scale = (12, 12, .16)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.rigidbody.object_add()
    floor.rigid_body.type = 'PASSIVE'
    floor.rigid_body.collision_shape = 'BOX'
    floor.rigid_body.friction = .65
    floor.rigid_body.use_margin = True
    floor.rigid_body.collision_margin = .002
    floor.rigid_body.collision_collections = (True,) * 20
    world = scene.rigidbody_world
    world.substeps_per_frame = 30
    world.solver_iterations = 180
    world.point_cache.frame_start, world.point_cache.frame_end = 1, LAST
    drift = {'backward': Vector((.08, 1, 0)), 'side': Vector((1, .18, 0)),
             'forward': Vector((-.06, -1, 0))}[direction].normalized()
    axis = Vector((0, 0, 1)).cross(drift).normalized()
    pivot = worlds['pelvis'].translation.copy()
    pivot.z = .06
    release = 6
    tilt = math.radians(9 if stance == 'standing' else 11)
    transforms = []
    for amount in (0, 1):
        transform = Matrix.Translation(drift * .03 * amount) @ Matrix.Translation(pivot) @ \
            Quaternion(axis, tilt * amount).to_matrix().to_4x4() @ Matrix.Translation(-pivot)
        if amount:
            clearances = []
            for body in bodies.values():
                m = transform @ body['initial']
                shape = body['shape']
                support = abs(m.to_3x3()[2][2]) * shape['length'] / 2 + shape['radius']
                clearances.append(m.translation.z - support)
            transform.translation.z += max(0, -min(clearances) - .012)
        transforms.append(transform)
    for body in bodies.values():
        obj = body['object']
        previous_rotation = None
        for frame, amount in [(1, 0), (release - 1, 1)]:
            obj.matrix_world = transforms[amount] @ body['initial']
            obj.scale = (1, 1, 1)
            if previous_rotation is not None and previous_rotation.dot(obj.rotation_quaternion) < 0:
                obj.rotation_quaternion.negate()
            previous_rotation = obj.rotation_quaternion.copy()
            obj.keyframe_insert(data_path='location', frame=frame)
            obj.keyframe_insert(data_path='rotation_quaternion', frame=frame)
            obj.rigid_body.kinematic = True
            obj.keyframe_insert(data_path='rigid_body.kinematic', frame=frame)
        obj.rigid_body.kinematic = False
        obj.keyframe_insert(data_path='rigid_body.kinematic', frame=release)
        for layer in obj.animation_data.action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = 'CONSTANT' if curve.data_path.endswith('kinematic') else 'LINEAR'
    scene.frame_set(1)
    bpy.context.view_layer.update()
    joints = [add_joint(i, definition, bodies) for i, definition in enumerate(phys['m_joints'])]
    # Bullet rebuilds constraint frames when animated bodies become dynamic.
    # Carry the joint empties with the same launch rig through that handoff.
    for joint in joints:
        obj = joint['object']
        initial = obj.matrix_world.copy()
        for frame, amount in [(1, 0), (release - 1, 1)]:
            obj.matrix_world = transforms[amount] @ initial
            obj.keyframe_insert(data_path='location', frame=frame)
            obj.keyframe_insert(data_path='rotation_quaternion', frame=frame)
    scene.frame_set(1)
    bpy.context.view_layer.update()
    return scene, pose, gltf_worlds, bodies, joints


def sample_pose(pose, initial_worlds, body_worlds, bodies, frame):
    desired = {name: INVERSE_BASIS @ m @ bodies[name]['shapeToBone'].inverted()
               for name, m in body_worlds.items()}
    pelvis_rotation = desired['pelvis'].to_quaternion()
    initial_pelvis = initial_worlds['pelvis'].to_quaternion()
    chest_delta = pelvis_rotation.inverted() @ desired['spine_2'].to_quaternion() @ \
        (initial_pelvis.inverted() @ initial_worlds['spine_2'].to_quaternion()).inverted()
    current, result = {}, {}
    for bone in SPEC['skeleton']:
        name, parent = bone['name'], bone['parent']
        start = pose[name]
        parent_world = current[parent] if parent else Matrix.Identity(4)
        local_position = Vector(start['position'])
        rotation = quat(start['quaternion'])
        if frame > 1:
            if name == 'pelvis':
                local_position = parent_world.inverted() @ desired[name].translation
            if name in desired:
                rotation = parent_world.to_quaternion().inverted() @ desired[name].to_quaternion()
            elif name in ('spine_0', 'spine_1'):
                fraction = .30 if name == 'spine_0' else .65
                target = pelvis_rotation @ Quaternion().slerp(chest_delta, fraction) @ \
                    initial_pelvis.inverted() @ initial_worlds[name].to_quaternion()
                rotation = parent_world.to_quaternion().inverted() @ target
        rotation.normalize()
        local = matrix(local_position, rotation)
        current[name] = parent_world @ local
        result[name] = {'position': list(local_position),
                        'quaternion': [rotation.x, rotation.y, rotation.z, rotation.w]}
    return result, current


def preview(scene, bodies, name, frame):
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 640, 480
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new('Preview world')
    scene.world.color = (.2, .2, .2)
    camera = bpy.data.objects.new('Preview camera', bpy.data.cameras.new('Preview camera'))
    scene.collection.objects.link(camera)
    camera.location = (3.4, -4.2, 2.7)
    camera.rotation_euler = (Vector((0, 0, .65)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type, camera.data.ortho_scale = 'ORTHO', 3.3
    scene.camera = camera
    light = bpy.data.objects.new('Preview light', bpy.data.lights.new('Preview light', 'AREA'))
    scene.collection.objects.link(light)
    light.location = (1, -2, 4)
    light.data.energy, light.data.shape, light.data.size = 600, 'DISK', 4
    scene.render.filepath = str(Path(SPEC['work']) / f'{name}-{frame:02d}.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.objects.remove(light, do_unlink=True)


def bake(stance, direction, name):
    scene, start, initial_worlds, bodies, joints = setup(stance, direction)
    times = [i / FPS for i in range(LAST)]
    channels = []
    channel_map = {}
    for bone in SPEC['skeleton']:
        for path in ('translation', 'rotation'):
            channel = {'bone': bone['name'], 'path': path, 'times': times, 'values': []}
            channels.append(channel)
            channel_map[(bone['name'], path)] = channel
    max_separation, minimum_clearance, low_since = 0, float('inf'), None
    worst_anchor = None
    anchor_history = []
    last_worlds = None
    for frame in range(1, LAST + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        matrices = {name: body['object'].evaluated_get(deps).matrix_world.copy()
                    for name, body in bodies.items()}
        frame_separation = 0
        for joint in joints:
            separation = ((matrices[joint['a']] @ joint['anchorA']) -
                          (matrices[joint['b']] @ joint['anchorB'])).length
            if separation > max_separation:
                max_separation = separation
                worst_anchor = {'bones': [joint['a'], joint['b']], 'time': (frame - 1) / FPS}
            frame_separation = max(frame_separation, separation)
        anchor_history.append(frame_separation)
        for bone, body in bodies.items():
            m = matrices[bone]
            shape = body['shape']
            support = abs(m.to_3x3()[2][2]) * shape['length'] / 2 + shape['radius']
            minimum_clearance = min(minimum_clearance, m.translation.z - support)
        if matrices['head_0'].translation.z < .48 and matrices['pelvis'].translation.z < .42:
            low_since = (frame - 1) / FPS if low_since is None else low_since
        else:
            low_since = None
        pose, last_worlds = sample_pose(start, initial_worlds, matrices, bodies, frame)
        for bone, values in pose.items():
            channel_map[(bone, 'translation')]['values'].append(values['position'])
            q = values['quaternion']
            previous = channel_map[(bone, 'rotation')]['values']
            if previous and sum(a * b for a, b in zip(previous[-1], q)) < 0:
                q = [-v for v in q]
            previous.append(q)
        if SPEC['preview'] and frame in (1, 16, 31, LAST):
            preview(scene, bodies, name, frame)
    physics = {'engine': 'Blender Bullet', 'bodies': 15, 'joints': 14,
               'substepsPerFrame': scene.rigidbody_world.substeps_per_frame,
               'solverIterations': scene.rigidbody_world.solver_iterations,
               'gravity': list(scene.gravity), 'releaseTime': 5 / FPS,
               'groundedAt': low_since, 'maxAnchorSeparation': max_separation,
               'worstAnchor': worst_anchor,
               'anchorHistory': anchor_history,
               'endBodyHeights': {key: matrices[key].translation.z for key in ('head_0', 'pelvis', 'spine_2')},
               'minFloorClearance': minimum_clearance, 'selfCollision': False}
    print(f'BAKED {name}: ground={low_since}, anchor error={max_separation:.5f} m, floor={minimum_clearance:.5f} m', flush=True)
    return {'name': 'animation/anims/world/shared/' + name, 'stance': stance,
            'direction': direction, 'duration': SPEC['duration'], 'channels': channels,
            'physics': physics}


def render_skinned_previews():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SPEC['previewAsset'])
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = 720, 540
    scene.render.resolution_percentage = 100
    shading = scene.display.shading
    shading.light, shading.color_type = 'STUDIO', 'MATERIAL'
    shading.show_shadows, shading.show_cavity = True, True
    shading.cavity_type = 'BOTH'
    shading.background_type, shading.background_color = 'WORLD', (.16, .19, .21)
    scene.world = bpy.data.worlds.new('Preview world')
    scene.world.color = (.16, .19, .21)
    bpy.ops.mesh.primitive_plane_add(size=12)
    bpy.context.object.name = 'Preview floor'
    camera = bpy.data.objects.new('Preview camera', bpy.data.cameras.new('Preview camera'))
    scene.collection.objects.link(camera)
    camera.location = (3.4, -4.2, 2.7)
    camera.rotation_euler = (Vector((0, 0, .65)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type, camera.data.ortho_scale = 'ORTHO', 3.4
    scene.camera = camera
    animated = [obj for obj in scene.objects if obj.animation_data]
    for stance, prefix in [('standing', 'death_fall_'), ('crouching', 'death_crouch_fall_')]:
        for suffix in 'abc':
            name = prefix + suffix
            for obj in animated:
                obj.animation_data.action = None
                for track in obj.animation_data.nla_tracks:
                    track.mute = name not in track.name
            for frame in (1, 10, 20, 31, LAST):
                scene.frame_set(frame)
                scene.render.filepath = str(Path(SPEC['work']) / f'skinned-{name}-{frame:02d}.png')
                bpy.ops.render.render(write_still=True)
            print(f'PREVIEW {name}', flush=True)


if SPEC.get('previewOnly'):
    render_skinned_previews()
else:
    clips = []
    for stance, prefix in [('standing', 'death_fall_'), ('crouching', 'death_crouch_fall_')]:
        for direction, suffix in [('backward', 'a'), ('side', 'b'), ('forward', 'c')]:
            clips.append(bake(stance, direction, prefix + suffix))
    output = {'schema': 1, 'fps': FPS, 'duration': SPEC['duration'], 'coordinateSpace': 'glTF parent-local, meters, quaternion xyzw',
              'skeleton': SPEC['skeleton'], 'startPoses': SPEC['startPoses'], 'clips': clips,
              'provenance': SPEC['provenance'], 'blenderVersion': bpy.app.version_string}
    Path(SPEC['output']).write_text(json.dumps(output, separators=(',', ':')) + '\n')
