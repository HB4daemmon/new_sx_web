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
    assert.equal(armature.sortedBones.length, 13);
    assert.equal(armature.sortedSlots.length, 11);
    assert.deepEqual(Object.keys(armature.animations).sort(), Object.keys(actionFrames).sort());
    assert.equal(armature.getBone('grip').parent.name, 'frontHand');
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
    assert.equal(atlas.SubTexture.length, 9);
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
    RKF05: { palm: [176, 442], grip: [629, 449], shoulder: [563, 45], neck: [132, 224], collar: [378, 34] },
    'EN-A1-L1': { palm: [114, 456], grip: [637, 451], shoulder: [615, 65], neck: [156, 224], collar: [384, 59] },
  };
  for (const [id, reference] of Object.entries(references)) {
    const bind = bindings[id], parts = library.rigs[id].parts;
    for (const [name, part, anchor] of [
      ['palm', 'forearm', bind.forearm[1]], ['grip', 'weapon', bind.weapon],
      ['shoulder', 'upper', bind.upper[0]], ['neck', 'head', bind.head], ['collar', 'torso', bind.neck],
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
      assert.ok(order.indexOf(`${side}Arm`) > order.indexOf('body'), 'sleeve covers its torso port');
      const transform = armature.skin[0].slot.find(slot => slot.name === `${side}Arm`).display[0].transform;
      const bind = bindings[armature.name], rect = library.rigs[armature.name].parts.upper;
      const dx = (bind.upper[1][0] - bind.upper[0][0]) * rect[2];
      const dy = (bind.upper[1][1] - bind.upper[0][1]) * rect[3];
      const nativeLength = Math.hypot(dx, dy), radians = Math.PI / 180;
      const a = transform.scX * Math.cos(transform.skY * radians);
      const b = transform.scX * Math.sin(transform.skY * radians);
      const c = -transform.scY * Math.sin(transform.skX * radians);
      const d = transform.scY * Math.cos(transform.skX * radians);
      assert.equal(Math.sign(a * d - b * c), side === 'back' ? -1 : 1, 'only the rear sleeve is mirrored');
      assert.ok(Math.hypot(a * dx + c * dy - bind.reach[0], b * dx + d * dy) < .000001);
      const socketScale = Math.abs(a * d - b * c) / (bind.reach[0] / nativeLength);
      assert.ok(socketScale >= .38, `${armature.name} sleeve became too thin for its socket`);
    }
  }
});

test('actions have eased windup, a decisive stroke and delayed secondary recovery', () => {
  for (const armature of skeleton.armature) {
    const attack = armature.animation.find(clip => clip.name === 'attack');
    const frames = name => attack.bone.find(timeline => timeline.name === name).frame;
    assert.equal(frames('frontArm').length, 8);
    assert.ok(frames('frontArm').every(frame => frame.tweenEasing !== 0));
    const upper = frames('frontArm'), wrist = frames('frontHand'), ribbon = frames('ribbon');
    assert.ok(Math.abs(upper[3].transform.skX - upper[2].transform.skX) >= 20, 'stroke differs from windup');
    assert.notEqual(wrist[3].transform.skX, wrist[4].transform.skX, 'wrist follows through after contact');
    assert.ok(Math.abs(ribbon[4].transform.skX) > Math.abs(ribbon[3].transform.skX), 'cloth lags the stroke');
    assert.notEqual(upper[6].transform.skX, 0, 'recovery settles before rest');
    const guard = armature.animation.find(clip => clip.name === 'guard');
    const hit = armature.animation.find(clip => clip.name === 'hit');
    assert.notDeepEqual(guard.bone, hit.bone, 'block and recoil are distinct poses');
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
