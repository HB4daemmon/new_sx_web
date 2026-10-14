import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ObjectDataParser } from 'pixi-dragonbones-runtime';
import { bindings, actionFrames, createSkeletonData, createTextureData } from '../src/rig-data.js';

const library = JSON.parse(await readFile(new URL('../public/assets/library.json', import.meta.url)));
const skeleton = createSkeletonData(library);

test('the real DragonBones parser accepts six character rigs and seven authored clips', () => {
  const data = new ObjectDataParser().parseDragonBonesData(skeleton);
  assert.ok(data, 'uses the dependency parser, not a mock skeleton evaluator');
  assert.equal(data.armatureNames.length, 6);
  for (const id of data.armatureNames) {
    const armature = data.getArmature(id);
    const layered = bindings[id].layered;
    assert.equal(armature.sortedBones.length, layered ? 14 : 13);
    assert.equal(armature.sortedSlots.length, layered ? 12 : 11);
    assert.deepEqual(Object.keys(armature.animations).sort(), Object.keys(actionFrames).sort());
    assert.equal(armature.getBone('grip').parent.name, layered ? 'wrist' : 'frontHand');
    assert.equal(armature.getBone('weapon').parent.name, 'grip');
    assert.ok(armature.actions.some(action => action.name === 'impact'));
  }
  data.returnToPool();
});

test('each atlas has individual anatomical anchors and rigid joint registration', () => {
  assert.equal(new Set(Object.values(bindings).map(bind => JSON.stringify(bind))).size, 6);
  for (const armature of skeleton.armature) {
    const id = armature.name;
    const atlas = createTextureData(id, library.rigs[id]);
    assert.equal(atlas.SubTexture.length, bindings[id].layered ? 12 : 9);
    assert.equal(atlas.width, bindings[id].layered ? 1024 : 768);
    for (const slot of armature.skin[0].slot) {
      const attachment = slot.display[0];
      assert.ok(atlas.SubTexture.some(texture => texture.name === attachment.name));
      assert.ok(attachment.pivot.x >= 0 && attachment.pivot.x <= 1);
      assert.ok(attachment.pivot.y >= 0 && attachment.pivot.y <= 1);
    }
    const bind = bindings[id];
    for (const side of ['front', 'back']) {
      const upper = armature.bone.find(bone => bone.name === `${side}Arm`);
      const hand = armature.bone.find(bone => bone.name === `${side}Hand`);
      assert.equal(upper.length, bind.reach[0]);
      assert.equal(hand.transform.x, upper.length);
      assert.equal(hand.length, bind.reach[1]);
    }
    const weapon = armature.bone.find(bone => bone.name === 'weapon');
    assert.equal(weapon.transform.x, 0);
    assert.equal(weapon.transform.y, 0);
  }
});

test('clips keep feet anchored, return to rest and have exactly one authored impact event', () => {
  for (const armature of skeleton.armature) for (const clip of armature.animation) {
    const duration = actionFrames[clip.name];
    assert.equal(clip.duration, duration);
    for (const timeline of clip.bone) {
      assert.equal(timeline.frame.reduce((sum, frame) => sum + frame.duration, 0), duration);
      assert.deepEqual(timeline.frame.at(-1).transform, { x: 0, y: 0, skX: 0, skY: 0 });
      if (['legL', 'legR', 'grip'].includes(timeline.name)) {
        assert.ok(timeline.frame.every(frame =>
          Object.values(frame.transform).every(value => value === 0)));
      }
    }
    if (clip.name !== 'idle') {
      assert.equal(clip.frame.filter(frame => frame.event === 'impact').length, 1);
      assert.ok(Math.abs(clip.frame[0].duration / duration - .44) < .02);
    }
  }
});

test('visually reviewed palm, socket and neck landmarks stay registered to the raster art', () => {
  const references = {
    RKF01: { palm: [145, 456], grip: [636, 438], shoulder: [614, 36], neck: [130, 232], collar: [374, 38] },
    RKF02: { palm: [123, 458], grip: [644, 415], shoulder: [600, 56], neck: [146, 225], collar: [370, 48] },
    RKF03: { palm: [148, 460], grip: [638, 453], shoulder: [605, 36], neck: [149, 220], collar: [375, 34] },
    RKF04: { palm: [174, 449], grip: [608, 436], shoulder: [590, 36], neck: [159, 217], collar: [378, 39] },
    RKF05: { palm: [671, 385], grip: [640, 725], shoulder: [171, 301], neck: [144, 217], collar: [388, 33] },
    'EN-A1-L1': { palm: [671, 386], grip: [640, 725], shoulder: [134, 303], neck: [139, 227], collar: [393, 62] },
  };
  for (const [id, reference] of Object.entries(references)) {
    const bind = bindings[id], parts = library.rigs[id].parts;
    for (const [name, part, anchor] of [
      ['palm', bind.layered ? 'handGrip' : 'forearm', bind.layered ? bind.hand[1] : bind.forearm[1]],
      ['grip', 'weapon', bind.weapon],
      ['shoulder', bind.layered ? 'frontUpper' : 'upper', bind.layered ? bind.upper.front[0] : bind.upper[0]],
      ['neck', 'head', bind.head], ['collar', 'torso', bind.neck],
    ]) {
      const [x, y, width, height] = parts[part];
      assert.ok(Math.hypot(x + width * anchor[0] - reference[name][0],
        y + height * anchor[1] - reference[name][1]) < 3, `${id} ${name} left the reviewed ink landmark`);
    }
  }
});

test('short sleeves retain socket width and cover the torso ports without hiding the belt', () => {
  for (const armature of skeleton.armature) {
    const order = armature.skin[0].slot.map(slot => slot.name);
    assert.ok(order.indexOf('skirt') < order.indexOf('body'), 'torso belt covers the skirt seam');
    for (const side of ['front', 'back']) {
      const bind = bindings[armature.name];
      assert.equal(order.indexOf(`${side}Arm`) > order.indexOf('body'),
        !(bind.layered && side === 'back'), 'rear layered arm stays behind the torso');
      const transform = armature.skin[0].slot.find(slot => slot.name === `${side}Arm`).display[0].transform;
      const rect = library.rigs[armature.name].parts[bind.layered ? `${side}Upper` : 'upper'];
      const points = bind.layered ? bind.upper[side] : bind.upper;
      const dx = (points[1][0] - points[0][0]) * rect[2];
      const dy = (points[1][1] - points[0][1]) * rect[3];
      const nativeLength = Math.hypot(dx, dy), radians = Math.PI / 180;
      const a = transform.scX * Math.cos(transform.skY * radians);
      const b = transform.scX * Math.sin(transform.skY * radians);
      const c = -transform.scY * Math.sin(transform.skX * radians);
      const d = transform.scY * Math.cos(transform.skX * radians);
      assert.equal(Math.sign(a * d - b * c), !bind.layered && side === 'back' ? -1 : 1,
        'independently drawn arms are not mirrored');
      assert.ok(Math.hypot(a * dx + c * dy - bind.reach[0], b * dx + d * dy) < .000001);
      const socketScale = Math.abs(a * d - b * c) / (bind.reach[0] / nativeLength);
      assert.ok(socketScale >= (bind.layered ? .25 : .38),
        `${armature.name} sleeve became too thin for its shoulder`);
    }
  }
});

test('rebuilt hands and weapons share a wrist and retain finger-over-handle draw order', () => {
  for (const id of ['RKF05', 'EN-A1-L1']) {
    const armature = skeleton.armature.find(item => item.name === id);
    const slots = armature.skin[0].slot;
    assert.equal(armature.bone.find(item => item.name === 'wrist').parent, 'frontHand');
    assert.equal(slots.find(item => item.name === 'palm').display[0].name, `${id}/handGrip`);
    assert.equal(armature.slot.find(item => item.name === 'palm').parent, 'wrist');
    assert.ok(slots.findIndex(item => item.name === 'palm') >
      slots.findIndex(item => item.name === 'weapon'));
    for (const clip of armature.animation) {
      const weapon = clip.bone.find(item => item.name === 'weapon');
      assert.ok(weapon.frame.every(frame => Object.values(frame.transform).every(value => value === 0)));
    }
    const attack = armature.animation.find(item => item.name === 'attack');
    assert.ok(attack.bone.find(item => item.name === 'wrist').frame.some(frame => frame.transform.skX !== 0));
  }
});

test('actions have eased windup, a decisive stroke and delayed secondary recovery', () => {
  for (const armature of skeleton.armature) {
    const attack = armature.animation.find(clip => clip.name === 'attack');
    const frames = name => attack.bone.find(timeline => timeline.name === name).frame;
    const at = (name, phase) => frames(name)[Math.round(attack.duration * phase)].transform;
    assert.equal(frames('frontArm').length, attack.duration + 1);
    assert.ok(frames('frontArm').every(frame => frame.tweenEasing === 0),
      'smooth authoring curves are sampled, not restarted with easing at each key');
    const upper = frames('frontArm'), wrist = frames('frontHand'), ribbon = frames('ribbon');
    assert.ok(Math.abs(at('frontArm', .42).skX - at('frontArm', .29).skX) >= 20,
      'stroke differs from windup');
    assert.notEqual(at('frontHand', .44).skX, at('frontHand', .57).skX,
      'forearm follows through after contact');
    assert.ok(Math.abs(at('ribbon', .66).skX) > Math.abs(at('ribbon', .44).skX), 'cloth lags the stroke');
    assert.notEqual(at('frontArm', .88).skX, 0, 'recovery settles before rest');
    assert.ok(upper[7].transform.skX !== upper[8].transform.skX, 'windup does not stop at the old 16% key');
    assert.ok(wrist.length === upper.length && ribbon.length === upper.length);
    const guard = armature.animation.find(clip => clip.name === 'guard');
    const hit = armature.animation.find(clip => clip.name === 'hit');
    assert.notDeepEqual(guard.bone, hit.bone, 'block and recoil are distinct poses');
  }
});

test('attacks lean toward the opponent and keep elbows and wrists within anatomical ranges', () => {
  for (const armature of skeleton.armature) {
    const restElbow = armature.bone.find(bone => bone.name === 'frontHand').transform.skX;
    assert.ok(restElbow <= -30 && restElbow >= -90, 'ready stance has a bent, not hyperextended, elbow');
    for (const action of ['attack', 'rage']) {
      const clip = armature.animation.find(clip => clip.name === action);
      const frames = name => clip.bone.find(timeline => timeline.name === name).frame;
      const contact = Math.round(clip.duration * .44);
      assert.ok(frames('body')[contact].transform.skX > 6, 'torso follows the forward stroke');
      assert.ok(frames('body')[Math.round(clip.duration * .24)].transform.skX < -3,
        'windup shifts weight away from the target');
      const wrist = frames(bindings[armature.name].layered ? 'wrist' : 'weapon');
      assert.ok(wrist.every(frame => Math.abs(frame.transform.skX) <= 36),
        `${armature.name} ${action}: weapon motion must not come from twisting the wrist`);
      assert.ok(frames('frontHand').every(frame => {
        const elbow = restElbow + frame.transform.skX;
        return elbow >= -130 && elbow <= -4;
      }), `${armature.name} ${action}: elbow bends in one direction`);
    }
  }
});

test('sampled curves have continuous recovery and genuinely staggered secondary motion', () => {
  for (const armature of skeleton.armature) for (const clip of armature.animation) {
    if (clip.name === 'idle') continue;
    for (const timeline of clip.bone) {
      const values = timeline.frame.map(frame => frame.transform.skX);
      assert.ok(values.every(Number.isFinite));
      assert.ok(Math.abs(values[1] - values[0]) < 4, 'no discontinuity on action start');
      assert.ok(Math.abs(values.at(-1) - values.at(-2)) < 1,
        `${armature.name} ${clip.name} ${timeline.name}: recovery settles before the idle blend`);
      assert.ok(values.slice(1).every((value, index) => Math.abs(value - values[index]) < 20),
        'one frame must not teleport a limb');
    }
    if (!['attack', 'rage'].includes(clip.name)) continue;
    const values = name => clip.bone.find(timeline => timeline.name === name).frame.map(frame => frame.transform.skX);
    const body = values('body'), cloth = values('ribbon');
    assert.ok(cloth.indexOf(Math.min(...cloth)) > body.indexOf(Math.max(...body)),
      'cloth finishes the stroke after the torso, not on the same phase clock');
  }
});

test('sword, staff, fan and vajra have independently authored attack gestures', () => {
  for (const action of ['attack', 'rage']) {
    const gestures = new Map();
    for (const armature of skeleton.armature) {
      const clip = armature.animation.find(clip => clip.name === action);
      const profile = clip.bone.filter(timeline => ['frontArm', 'frontHand', 'weapon'].includes(timeline.name));
      gestures.set(bindings[armature.name].gesture, JSON.stringify(profile));
    }
    assert.equal(new Set(gestures.values()).size, 4);
  }
});
