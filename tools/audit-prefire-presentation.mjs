import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createServer} from 'vite';
import {AnimationMixer, Group, Matrix4, Quaternion, Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';

// Offline native asset sampling only: no browser, game process, controller or shot changes.
globalThis.ProgressEvent ??= class {constructor(type, init) {Object.assign(this, init);}};
async function load(name) {
  const bytes = fs.readFileSync(`public/revamp/models/${name}.glb`), length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString('base64')}`;
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) delete primitive.material;
  delete json.materials; delete json.textures; delete json.images;
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}
const mounts = JSON.parse(fs.readFileSync('src/range/weapon-mounts.json', 'utf8'));
const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {DuelAnimator, nativeGestureClips, locomotionWeights} = await vite.ssrLoadModule('/src/range/duel/animation.ts');
  const target = await load('target'), motion = await load('duel-motion');
  if (process.argv.includes('--plant-probe')) {
    const probes = [];
    for (const clip of motion.animations.filter(clip => /\/(?:planted_[ew]2[ew]|run_[ew])_rifle$/.test(clip.name))) {
      const model = clone(target.scene), mixer = new AnimationMixer(model), action = mixer.clipAction(clip);
      action.play(); action.paused = true;
      const frames = [];
      for (let frame = 0; frame <= 32; frame++) {
        action.time = clip.duration * frame / 32; mixer.update(0); model.updateMatrixWorld(true);
        frames.push({time: action.time, bones: Object.fromEntries(['pelvis', 'head_0', 'leg_upper_L', 'leg_lower_L', 'ankle_L', 'ball_L',
          'leg_upper_R', 'leg_lower_R', 'ankle_R', 'ball_R', 'wpn']
          .map(name => [name, model.getObjectByName(name).getWorldPosition(new Vector3()).toArray()]))});
      }
      probes.push({clip: clip.name, duration: clip.duration, frames,
        footRanges: ['ankle_L', 'ankle_R', 'ball_L', 'ball_R'].map(name => ({name,
          ranges: [0, 1, 2].map(axis => Math.max(...frames.map(frame => frame.bones[name][axis])) - Math.min(...frames.map(frame => frame.bones[name][axis])))}))});
      mixer.stopAllAction(); mixer.uncacheRoot(model);
    }
    if (process.env.PREFIRE_PRESENTATION_REPORT) fs.writeFileSync(process.env.PREFIRE_PRESENTATION_REPORT, JSON.stringify({probes}, null, 2));
    console.log(JSON.stringify(probes.map(({clip, duration, footRanges}) => ({clip, duration, footRanges})), null, 2));
  } else if (process.argv.includes('--plant-recovery') || process.argv.includes('--plant-disabled')) {
    const disabledPlant = process.argv.includes('--plant-disabled');
    const {advanceActor, idleInput, STEP, UNIT} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
    const records = [], cases = [], construction = [], baselineConstruction = [], activeCosts = [], idleCosts = [], baselineCosts = [], captureCosts = [];
    const worldGun = (await load('ak47')).scene, gestures = nativeGestureClips(await load('duel-gestures/ak47'));
    const baselineClips = motion.animations.filter(clip => !/\/planted_[ew]2[ew]_rifle$/.test(clip.name));
    const boneNames = ['pelvis', 'spine_0', 'spine_2', 'neck_0', 'head_0', 'wpn',
      ...['L', 'R'].flatMap(side => ['clavicle', 'arm_upper', 'arm_lower', 'hand', 'leg_upper', 'leg_lower', 'ankle', 'ball'].map(name => `${name}_${side}`))];
    for (const sign of [-1, 1]) for (const phase of [.1, .35, .6, .85]) for (const profile of ['release', 'counterstop', 'reverse']) {
      if (process.env.PREFIRE_PLANT_CASE && process.env.PREFIRE_PLANT_CASE !== `${sign}/${phase}/${profile}`) continue;
      const root = new Group(), model = clone(target.scene), baselineRoot = new Group(), baselineModel = clone(target.scene);
      root.add(model); baselineRoot.add(baselineModel);
      const guns = [model, baselineModel].map(model => {
        (model.getObjectByName('held_weapon_target001') ?? model.getObjectByName('held_weapon_target.001')).visible = false;
        const gun = worldGun.clone(true);
        new Matrix4().fromArray(mounts.mounts.ak47.inverseBind).decompose(gun.position, gun.quaternion, gun.scale);
        model.getObjectByName('wpn').add(gun); return gun;
      });
      let began = performance.now(); const animator = new DuelAnimator(model, motion.animations, phase, 'ak47'); construction.push(performance.now() - began);
      began = performance.now(); const baseline = new DuelAnimator(baselineModel, baselineClips, phase, 'ak47'); baselineConstruction.push(performance.now() - began);
      animator.addGestureClips(gestures); baseline.addGestureClips(gestures);
      const rejectedContacts = [];
      if (process.env.PREFIRE_PLANT_DEBUG) for (const foot of animator.plantFeet) {
        const solve = foot.solve.bind(foot);
        foot.solve = weight => {
          const valid = solve(weight);
          if (!valid) rejectedContacts.push({toe: foot.toe.name, weight, floor: foot.floor,
            soleHeight: foot.soleHeight(), target: foot.target.toArray(), point: foot.toe.getWorldPosition(new Vector3()).toArray()});
          return valid;
        };
      }
      const soleVertices = [];
      model.traverse(mesh => {
        if (!mesh.isSkinnedMesh) return;
        const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight'), selected = [];
        if (!indices || !weights) return;
        for (let vertex = 0; vertex < indices.count; vertex++) {
          let influence = 0;
          for (let part = 0; part < 4; part++) if (/^(ankle|ball)_[LR]$/.test(mesh.skeleton.bones[indices.getComponent(vertex, part)]?.name ?? '')) influence += weights.getComponent(vertex, part);
          if (influence >= .75) selected.push(vertex);
        }
        if (selected.length) soleVertices.push({mesh, selected, baselineMesh: baselineModel.getObjectByName(mesh.name)});
      });
      let kinematics = {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: .8, feet: 0,
        verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true};
      let brakeDone = false, maxWeight = 0, maxDrift = 0, maxHeadYawChange = 0, maxGunYawChange = 0, maxCompression = 0, maxBoneDelta = 0;
      let minToe = Infinity, minSole = Infinity, baselineMinSole = Infinity, soleWitness, maxHandGripChange = 0, activeFrames = 0, steadyFrames = 0, lastPlant = false;
      for (let frame = 0; frame < 180; frame++) {
        const time = frame * STEP, input = idleInput();
        const lateral = kinematics.velocity.x * Math.cos(kinematics.yaw) - kinematics.velocity.z * Math.sin(kinematics.yaw);
        if (time < .4) input.side = sign;
        else if (profile === 'reverse') input.side = -sign;
        else if (profile === 'counterstop' && !brakeDone) {
          if (Math.abs(lateral) < 16 * UNIT) brakeDone = true; else input.side = -sign;
        }
        kinematics = advanceActor(kinematics, input, 215 * UNIT, STEP);
        const actor = {...kinematics, id: 1, generation: 1, side: 'enemy', pitch: .5, duckAmount: 0, crouched: false,
          health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false};
        for (const holder of [root, baselineRoot]) {holder.position.set(actor.position.x, actor.feet, actor.position.z); holder.rotation.y = actor.yaw - Math.PI;}
        began = performance.now(); animator.update(actor, STEP); const cost = performance.now() - began;
        began = performance.now(); baseline.update(actor, STEP); const baselineCost = performance.now() - began;
        root.updateMatrixWorld(true); baselineRoot.updateMatrixWorld(true);
        const plant = animator.plant, weight = plant?.weight ?? 0;
        if (frame > 15) {(weight > 0 ? activeCosts : idleCosts).push(cost); baselineCosts.push(baselineCost);}
        if (plant && !lastPlant) captureCosts.push(cost); lastPlant = !!plant;
        maxWeight = Math.max(maxWeight, weight); if (weight > 0) activeFrames++; if (weight > .999) steadyFrames++;
        const gaps = ['head_0', 'wpn'].map(name => model.getObjectByName(name).getWorldQuaternion(new Quaternion()).normalize()
          .angleTo(baselineModel.getObjectByName(name).getWorldQuaternion(new Quaternion()).normalize()) * 180 / Math.PI);
        maxHeadYawChange = Math.max(maxHeadYawChange, gaps[0]); maxGunYawChange = Math.max(maxGunYawChange, gaps[1]);
        const compression = baselineModel.getObjectByName('pelvis').getWorldPosition(new Vector3()).y - model.getObjectByName('pelvis').getWorldPosition(new Vector3()).y;
        maxCompression = Math.max(maxCompression, compression);
        if (disabledPlant) for (const name of boneNames) maxBoneDelta = Math.max(maxBoneDelta,
          model.getObjectByName(name).getWorldPosition(new Vector3()).distanceTo(baselineModel.getObjectByName(name).getWorldPosition(new Vector3())));
        for (const name of ['hand_L', 'hand_R']) {
          const actual = guns[0].worldToLocal(model.getObjectByName(name).getWorldPosition(new Vector3()));
          const reference = guns[1].worldToLocal(baselineModel.getObjectByName(name).getWorldPosition(new Vector3()));
          maxHandGripChange = Math.max(maxHandGripChange, actual.distanceTo(reference));
        }
        const toes = ['L', 'R'].map(side => model.getObjectByName(`ball_${side}`).getWorldPosition(new Vector3()));
        if (weight > .999) for (let i = 0; i < toes.length; i++) {
          maxDrift = Math.max(maxDrift, toes[i].distanceTo(animator.plantFeet[i].target)); minToe = Math.min(minToe, toes[i].y - actor.feet);
        }
        if ((weight > 0 || disabledPlant && time > .4 && Math.hypot(actor.velocity.x, actor.velocity.z) < .1 * UNIT) && frame % 4 === 0)
          for (const {mesh, selected, baselineMesh} of soleVertices) {
          mesh.skeleton.update();
          baselineMesh.skeleton.update();
          for (const vertex of selected) {
            const point = mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld);
            const reference = baselineMesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(baselineMesh.matrixWorld);
            baselineMinSole = Math.min(baselineMinSole, reference.y - actor.feet);
            if (point.y - actor.feet < minSole) {
              minSole = point.y - actor.feet;
              const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
              soleWitness = {frame, time, weight, mesh: mesh.name, vertex, point: point.toArray(), baselinePoint: reference.toArray(),
                influences: [0, 1, 2, 3].map(part => ({bone: mesh.skeleton.bones[indices.getComponent(vertex, part)]?.name, weight: weights.getComponent(vertex, part)})),
                cachedProbe: animator.plantFeet.some(foot => foot.sole.some(probe => probe.mesh === mesh && probe.index === vertex))};
            }
          }
        }
        if (frame % 4 === 0) records.push({sign, phase, profile, frame, time, weight, compression, speed: Math.hypot(actor.velocity.x, actor.velocity.z) / UNIT,
          plant: plant?.name, bones: Object.fromEntries(boneNames.map(name => [name, model.getObjectByName(name).getWorldPosition(new Vector3()).toArray()])),
          baselineBones: Object.fromEntries(boneNames.map(name => [name, baselineModel.getObjectByName(name).getWorldPosition(new Vector3()).toArray()]))});
      }
      cases.push({sign, phase, profile, maxWeight, activeFrames, steadyFrames, maxDrift, minToe: Number.isFinite(minToe) ? minToe : null,
        maxHeadYawChange, maxGunYawChange, maxHandGripChange, minSole: Number.isFinite(minSole) ? minSole : null,
        baselineMinSole: Number.isFinite(baselineMinSole) ? baselineMinSole : null, soleWitness,
        cachedBootVertices: animator.plantFeet.reduce((count, foot) => count + foot.sole.length, 0), rejectedContacts, maxBoneDelta, maxCompression});
      animator.dispose(); baseline.dispose();
    }
    const distribution = values => {
      const sorted = values.toSorted((a, b) => a - b), percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      return {samples: values.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sorted.at(-1)};
    };
    const costs = {construction: distribution(construction), baselineConstruction: distribution(baselineConstruction),
      activeFrame: distribution(activeCosts), inactiveFrame: distribution(idleCosts), baselineFrame: distribution(baselineCosts), capture: distribution(captureCosts),
      limitations: 'Node headless timing on the current host, concurrent work may affect tails. Mesh clone, asset reads, audit FK/vertices and renderer are excluded. Not a browser/GPU/old-CPU performance guarantee.'};
    const report = {schema: 1, disabledPlant, cases, records, costs,
      sourceSha256: crypto.createHash('sha256').update(fs.readFileSync('src/range/duel/animation.ts')).digest('hex'),
      limitations: 'Offline shared-motor trace and native FK. The masked additive recovery/foot IK is not full Source 2 graph evaluation.'};
    if (process.env.PREFIRE_PRESENTATION_REPORT) fs.writeFileSync(process.env.PREFIRE_PRESENTATION_REPORT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({cases: cases.length, frames: cases.length * 180, costs,
      maxPlantDrift: Math.max(...cases.map(row => row.maxDrift)), minSole: Math.min(...cases.filter(row => row.minSole !== null).map(row => row.minSole)),
      maxBoneDelta: Math.max(...cases.map(row => row.maxBoneDelta)),
      maxHeadRotationChange: Math.max(...cases.map(row => row.maxHeadYawChange)), maxGunRotationChange: Math.max(...cases.map(row => row.maxGunYawChange)),
      maxHandGripChange: Math.max(...cases.map(row => row.maxHandGripChange)), minActiveFrames: Math.min(...cases.map(row => row.activeFrames))}, null, 2));
    if (process.env.PREFIRE_PRESENTATION_FRAMES) {
      const {default: sharp} = await import('sharp');
      const chosen = [-1, 1].flatMap(sign => {
        const group = records.filter(row => row.profile === 'counterstop' && row.phase === .6 && row.sign === sign);
        const peak = disabledPlant ? group.find(row => row.frame === 100) : group.toSorted((a, b) => b.compression - a.compression)[0];
        return [group.find(row => row.frame === 48), peak];
      });
      const chains = [['pelvis', 'spine_0', 'spine_2', 'neck_0', 'head_0'],
        ...['L', 'R'].flatMap(side => [['spine_2', `clavicle_${side}`, `arm_upper_${side}`, `arm_lower_${side}`, `hand_${side}`],
          ['pelvis', `leg_upper_${side}`, `leg_lower_${side}`, `ankle_${side}`, `ball_${side}`]])];
      const panels = chosen.map((sample, column) => {
        const center = sample.bones.pelvis;
        const project = (point, row) => [column * 320 + 158 + ((point[0] - center[0]) * (row === 0 ? Math.cos(.8) : Math.sin(.8)) +
          (point[2] - center[2]) * (row === 0 ? -Math.sin(.8) : Math.cos(.8))) * 150, 345 + row * 340 - point[1] * 150];
        const lines = [0, 1].map(row => {
          const line = (a, b, color, width = 2) => `<path d="M ${project(a, row).join(' ')} L ${project(b, row).join(' ')}" stroke="${color}" stroke-width="${width}"/>`;
          return `<g><path d="M ${column * 320 + 10} ${345 + row * 340} H ${column * 320 + 310}" stroke="#536073"/>` +
            [['baselineBones', '#6480a4'], ['bones', '#e7eef9']].flatMap(([key, color]) => chains.flatMap(chain => chain.slice(1).map((name, i) => line(sample[key][chain[i]], sample[key][name], color)))).join('') + '</g>';
        }).join('');
        return `<g><text x="${column * 320 + 14}" y="30" fill="white" font-size="16">${sample.sign < 0 ? 'W2E' : 'E2W'} frame ${sample.frame}</text>
          <text x="${column * 320 + 14}" y="54" fill="#a4b2c6" font-size="13">${(sample.time * 1000).toFixed(0)} ms, recovery ${(sample.compression * 1000).toFixed(1)} mm</text>${lines}</g>`;
      }).join('');
      await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="750"><rect width="1280" height="750" fill="#15191f"/>${panels}
        <text x="16" y="723" fill="#c9d2df" font-size="14">Native FK: front above, side below. Blue: baseline. White: ${disabledPlant ? 'unverified plant disabled (coincident)' : 'recovery plus contact IK'}. Not gameplay footage.</text></svg>`)).png().toFile(process.env.PREFIRE_PRESENTATION_FRAMES);
    }
    if (process.argv.includes('--assert')) {
      if (disabledPlant) {
        assert.ok(cases.every(row => row.activeFrames === 0 && row.cachedBootVertices === 0), 'Unverified recovery must not activate or scan feet at runtime');
        assert.ok(cases.every(row => row.maxBoneDelta < .000001), 'Disabling recovery must preserve the complete baseline pose');
      } else {
        assert.ok(cases.every(row => row.activeFrames > 0), 'Every eligible standing rifle brake must evaluate its native recovery');
        assert.ok(cases.every(row => row.profile === 'reverse' ? row.activeFrames >= 10 : row.activeFrames >= 60),
          'The floor guard must not hide a broken recovery by cancelling its eligible native episode early');
      }
      assert.ok(cases.every(row => row.maxDrift < .002), 'Planted contacts must not slide');
      assert.ok(cases.every(row => row.maxHeadYawChange < .001 && row.maxGunYawChange < .001), 'Recovery must not disturb physical head/gun orientation');
      assert.ok(cases.every(row => row.maxHandGripChange < .00001), 'Recovery must carry the gun with both hands');
      assert.ok(cases.every(row => row.minSole === null || row.minSole > -.005), 'Actual shoe vertices must stay above the 5 mm floor-penetration limit during the tested contacts');
    }
  } else {
  const directions = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const samples = [], summaries = [];
  for (const equipment of ['ak47', 'm4a1s', 'usp']) {
    const root = new Group(), model = clone(target.scene); root.add(model);
    const original = model.getObjectByName('held_weapon_target001') ?? model.getObjectByName('held_weapon_target.001');
    let held = original;
    if (equipment !== 'm4a1s') {
      original.visible = false; held = (await load(equipment)).scene;
      new Matrix4().fromArray(mounts.mounts[equipment].inverseBind).decompose(held.position, held.quaternion, held.scale);
      model.getObjectByName('wpn').add(held);
    }
    const gestures = await load(`duel-gestures/${equipment}`);
    const animator = new DuelAnimator(model, motion.animations, 0, equipment);
    animator.addGestureClips(nativeGestureClips(gestures));
    const head = model.getObjectByName('head_0'), hand = model.getObjectByName('hand_R');
    const actor = {id: 1, generation: 1, side: 'enemy', position: {x: 0, y: 1.6256, z: 0}, feet: 0,
      velocity: {x: 0, z: 0}, yaw: 0, pitch: 0, crouched: false, duckAmount: 0, grounded: true,
      health: 100, armor: 100, helmet: true, alive: true, equipment, ammo: 30, reloading: false};
    root.rotation.y = -Math.PI; animator.update(actor, 0); root.updateMatrixWorld(true);
    // The head bone's +Z is not the anatomical face axis; calibrate once at native idle.
    const faceAxis = new Vector3(0, 0, -1).applyQuaternion(head.getWorldQuaternion(new Quaternion()).invert());
    const beforeHand = new Matrix4().copy(hand.matrixWorld).invert().multiply(held.matrixWorld);
    const collect = (profile, frame) => {
      root.rotation.y = actor.yaw - Math.PI; animator.update(actor, 1 / 60); root.updateMatrixWorld(true);
      const expected = new Vector3(-Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch),
        -Math.cos(actor.yaw) * Math.cos(actor.pitch));
      const barrel = new Vector3(0, 0, 1).applyQuaternion(held.getWorldQuaternion(new Quaternion()));
      const face = faceAxis.clone().applyQuaternion(head.getWorldQuaternion(new Quaternion()));
      const relative = new Matrix4().copy(hand.matrixWorld).invert().multiply(held.matrixWorld);
      const record = {equipment, profile, frame, yaw: actor.yaw, pitch: actor.pitch, duck: actor.duckAmount,
        speed: Math.hypot(actor.velocity.x, actor.velocity.z) / .0254,
        barrelError: expected.angleTo(barrel) * 180 / Math.PI, headError: expected.angleTo(face) * 180 / Math.PI,
        barrelYaw: Math.atan2(-barrel.x, -barrel.z), expected: expected.toArray(), barrel: barrel.toArray(), face: face.toArray(),
        gripChange: Math.max(...beforeHand.elements.map((value, i) => Math.abs(value - relative.elements[i])))};
      if (frame % 12 === 0) {
        animator.update({...actor, pitch: 0}, 0); root.updateMatrixWorld(true);
        const baseline = new Vector3(0, 0, 1).applyQuaternion(held.getWorldQuaternion(new Quaternion()));
        const axis = new Vector3(1, 0, 0).applyQuaternion(model.getWorldQuaternion(new Quaternion()));
        const expectedPitch = baseline.applyAxisAngle(axis, -actor.pitch);
        const grips = ['hand_L', 'hand_R'].map(name => held.worldToLocal(model.getObjectByName(name).getWorldPosition(new Vector3())));
        animator.update(actor, 0); root.updateMatrixWorld(true);
        const aimed = new Vector3(0, 0, 1).applyQuaternion(held.getWorldQuaternion(new Quaternion()));
        record.pitchContributionError = expectedPitch.angleTo(aimed) * 180 / Math.PI;
        record.aimGripShift = ['hand_L', 'hand_R'].map((name, index) => held.worldToLocal(model.getObjectByName(name).getWorldPosition(new Vector3())).distanceTo(grips[index]));
        record.bones = Object.fromEntries(['pelvis', 'spine_0', 'spine_2', 'neck_0', 'head_0', 'wpn',
          ...['L', 'R'].flatMap(side => ['clavicle', 'arm_upper', 'arm_lower', 'hand', 'leg_upper', 'leg_lower', 'ankle'].map(name => `${name}_${side}`))]
          .map(name => [name, model.getObjectByName(name).getWorldPosition(new Vector3()).toArray()]));
      }
      assert.ok([...record.barrel, ...record.face].every(Number.isFinite), `${equipment}/${profile}/${frame}: nonfinite pose`);
      samples.push(record);
    };
    for (const [gait, speed, duck] of [['walk', 110, 0], ['run', 215, 0], ['crouch', 73, 1]]) {
      actor.duckAmount = duck; actor.crouched = duck > .5;
      for (let direction = 0; direction < directions.length; direction++) for (const pitch of [-.5, 0, .5]) {
        actor.pitch = pitch; actor.yaw = .8;
        const angle = direction * Math.PI / 4;
        const right = Math.sin(angle) * speed * .0254, forward = Math.cos(angle) * speed * .0254;
        actor.velocity = {x: right * Math.cos(actor.yaw) - forward * Math.sin(actor.yaw),
          z: -right * Math.sin(actor.yaw) - forward * Math.cos(actor.yaw)};
        const family = equipment === 'usp' ? 'pistol' : 'rifle';
        const {weights, authoredSpeed} = locomotionWeights(actor, family);
        let weightedDuration = 0, total = 0;
        for (const [name, weight] of weights) if (!name.startsWith('idle') && weight > .001) {
          const clip = motion.animations.find(clip => clip.name.endsWith(`/${name}`));
          assert.ok(clip, `${equipment}: missing native ${name}`);
          weightedDuration += clip.duration * weight; total += weight;
        }
        // Cover at least a complete evaluated gait cycle, including slowed walks.
        const frames = Math.max(48, Math.ceil(weightedDuration / total * authoredSpeed / (speed * .0254) * 60) + 2);
        for (let frame = 0; frame < frames; frame++) collect(`${gait}_${directions[direction]}/pitch=${pitch}`, frame);
      }
    }
    for (let frame = 0; frame < 120; frame++) {
      actor.yaw = .8 + Math.sin(frame / 30) * 1.2; actor.pitch = Math.sin(frame / 20) * .4;
      actor.duckAmount = Math.max(0, Math.min(1, (frame - 20) / 24)); actor.crouched = actor.duckAmount > .5;
      const speed = frame < 60 ? 215 : Math.max(0, 215 - (frame - 60) * 24);
      actor.velocity = {x: Math.cos(actor.yaw) * speed * .0254, z: -Math.sin(actor.yaw) * speed * .0254};
      collect('turn-crouch-stop', frame);
    }
    for (const profile of new Set(samples.filter(sample => sample.equipment === equipment).map(sample => sample.profile))) {
      const group = samples.filter(sample => sample.equipment === equipment && sample.profile === profile);
      summaries.push({equipment, profile, frames: group.length,
        maxBarrelError: Math.max(...group.map(sample => sample.barrelError)),
        maxHeadError: Math.max(...group.map(sample => sample.headError)),
        maxGripChange: Math.max(...group.map(sample => sample.gripChange))});
    }
    animator.dispose();
  }
  const hashes = Object.fromEntries(['target', 'duel-motion', 'ak47', 'usp', 'duel-gestures/ak47', 'duel-gestures/m4a1s', 'duel-gestures/usp']
    .map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(`public/revamp/models/${name}.glb`)).digest('hex')]));
  const sourceHashes = Object.fromEntries(['src/range/duel/animation.ts', 'src/range/weapon-mounts.json', 'src/range/duel/DuelEngine.ts']
    .map(path => [path, crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')]));
  const report = {schema: 1, hashes, sourceHashes, frames: samples.length, summaries,
    worst: samples.toSorted((a, b) => b.barrelError - a.barrelError).slice(0, 12), samples,
    limitations: 'No browser, source-engine pose evaluation or video parity. Production root/mount transforms are reproduced, not DuelEngine itself. Head axis calibrated at idle; barrel uses actual mounted weapon +Z. Default SAS rig only. No firing/reload kick in these measurements. Grip delta is diagnostic, not an anatomical contact test.'};
  if (process.env.PREFIRE_PRESENTATION_REPORT) fs.writeFileSync(process.env.PREFIRE_PRESENTATION_REPORT, JSON.stringify(report, null, 2));
  const pitchSamples = samples.filter(sample => sample.pitchContributionError !== undefined);
  if (process.argv.includes('--assert')) {
    assert.ok(pitchSamples.every(sample => sample.pitchContributionError < .001),
      'Both arms must receive the complete physical pitch, not only the spine contribution');
    assert.ok(pitchSamples.every(sample => sample.aimGripShift[1] < .00001 && sample.aimGripShift[0] < .005),
      'Pitch correction must preserve the right grip and keep native support-hand drift below 5 mm');
    assert.ok(samples.every(sample => Math.abs(Math.atan2(Math.sin(sample.barrelYaw - sample.yaw), Math.cos(sample.barrelYaw - sample.yaw))) < 10 * Math.PI / 180),
      'Locomotion must not rotate the mounted gun away from physical yaw');
  }
  if (process.env.PREFIRE_PRESENTATION_FRAMES) {
    const {default: sharp} = await import('sharp');
    const chosen = ['run_e/pitch=0', 'crouch_w/pitch=0.5', 'walk_ne/pitch=-0.5', 'turn-crouch-stop']
      .map(profile => samples.find(sample => sample.equipment === 'ak47' && sample.profile === profile && sample.frame === 24));
    const chains = [['pelvis', 'spine_0', 'spine_2', 'neck_0', 'head_0'],
      ...['L', 'R'].flatMap(side => [['spine_2', `clavicle_${side}`, `arm_upper_${side}`, `arm_lower_${side}`, `hand_${side}`],
        ['pelvis', `leg_upper_${side}`, `leg_lower_${side}`, `ankle_${side}`]])];
    const panels = chosen.map((sample, column) => {
      const heading = [Math.sin(sample.yaw), 0, Math.cos(sample.yaw)];
      const project = point => [column * 320 + 158 + (point[0] * heading[0] + point[2] * heading[2]) * 150, 345 - point[1] * 150];
      const line = (a, b, color, width = 3) => {
        const p = project(a), q = project(b); return `<path d="M ${p.join(' ')} L ${q.join(' ')}" stroke="${color}" stroke-width="${width}"/>`;
      };
      const boneLines = chains.flatMap(chain => chain.slice(1).map((name, i) => line(sample.bones[chain[i]], sample.bones[name], '#a4b2c6'))).join('');
      const weapon = sample.bones.wpn;
      const arrows = [[sample.expected, '#60e59c'], [sample.barrel, '#ef73d5']]
        .map(([direction, color]) => line(weapon, weapon.map((value, i) => value + direction[i] * .65), color, 2)).join('');
      return `<g><text x="${column * 320 + 14}" y="38" fill="white" font-size="16">${sample.profile}</text>
        <text x="${column * 320 + 14}" y="63" fill="#a4b2c6" font-size="13">Frame ${sample.frame}, barrel error ${sample.barrelError.toFixed(2)} deg</text>
        ${line([-heading[0], 0, -heading[2]], heading, '#526072', 1)}${boneLines}${arrows}</g>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="410"><rect width="1280" height="410" fill="#15191f"/>
      ${panels}<text x="16" y="387" font-size="14" fill="#c9d2df">Native FK frame evidence, not a gameplay screenshot. Green: physical aim. Pink: actual mounted barrel. Side projection.</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(process.env.PREFIRE_PRESENTATION_FRAMES);
  }
  console.log(JSON.stringify({frames: report.frames, pitchSamples: pitchSamples.length,
    maxPitchContributionError: Math.max(...pitchSamples.map(sample => sample.pitchContributionError)),
    maxRightGripAimShift: Math.max(...pitchSamples.map(sample => sample.aimGripShift[1])),
    maxLeftGripAimShift: Math.max(...pitchSamples.map(sample => sample.aimGripShift[0])),
    weapons: ['ak47', 'm4a1s', 'usp'].map(equipment => {
      const group = samples.filter(sample => sample.equipment === equipment);
      return {equipment, frames: group.length, maxBarrelError: Math.max(...group.map(sample => sample.barrelError)),
        maxHeadError: Math.max(...group.map(sample => sample.headError)),
        maxBarrelYawError: Math.max(...group.map(sample => Math.abs(Math.atan2(Math.sin(sample.barrelYaw - sample.yaw), Math.cos(sample.barrelYaw - sample.yaw))) * 180 / Math.PI))};
    })}, null, 2));
  }
} finally {await vite.close();}
