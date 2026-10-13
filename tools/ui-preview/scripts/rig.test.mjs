import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bones, durations, poseAt, worldBones, BattleRig } from '../public/rig.js';

test('limbs and weapon inherit the animated shoulder and elbow', () => {
  const idle = worldBones(poseAt('idle', 0, 0));
  const strike = worldBones(poseAt('attack', .5, 0));
  assert.notDeepEqual(strike.get('frontArm'), idle.get('frontArm'));
  assert.notDeepEqual(strike.get('frontHand'), idle.get('frontHand'));
  assert.notDeepEqual(strike.get('weapon'), idle.get('weapon'));
  for (const bone of bones.filter(bone => bone.parent)) {
    const parent = strike.get(bone.parent), child = strike.get(bone.id);
    assert.ok(Number.isFinite(child.x + child.y + child.angle));
    if (bone.id === 'weapon') {
      assert.ok(Math.abs(Math.hypot(child.x - parent.x, child.y - parent.y) -
        Math.hypot(bone.x, bone.y)) < .00001, 'weapon remains attached to the hand');
    }
  }
});

test('basic, rage, artifact, heal and hit have distinct multi-bone poses', () => {
  const poses = ['attack', 'rage', 'artifact', 'heal', 'hit']
    .map(action => JSON.stringify(poseAt(action, .5, 0)));
  assert.equal(new Set(poses).size, 5);
  for (const action of Object.keys(durations)) {
    assert.deepEqual(poseAt(action, .5, 100, true), {});
    assert.ok(durations[action] > 0);
  }
});

test('impact fires once and reduced motion commits pending feedback once', () => {
  // Use the real action clock without a DOM or renderer.
  const rig = Object.create(BattleRig.prototype);
  Object.assign(rig, {
    actions: new Map(), canvas: { dataset: {} }, clock: 0, time: 0, active: false,
    paused: false, reduced: false, speed: 1, draw() {}, frame: null,
  });
  const oldRaf = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    let impacts = 0;
    rig.play('player', 'attack', () => impacts++);
    for (let time = 100; time <= 1000; time += 80) rig.tick(time);
    assert.equal(impacts, 1);
    rig.play('enemy', 'rage', () => impacts++);
    rig.configure({ active: true, reduced: true });
    assert.equal(impacts, 2);
    rig.configure({ active: true, reduced: true });
    assert.equal(impacts, 2);
    assert.equal(rig.actions.size, 0);
    rig.play('player', 'heal', () => impacts++);
    assert.equal(impacts, 3);
    rig.configure({ active: true, reduced: false });
    rig.play('enemy', 'attack', () => impacts++);
    rig.configure({ active: true, paused: true, reduced: true });
    assert.equal(impacts, 3, 'reducing motion while paused must not advance a pending impact');
    rig.configure({ active: true, paused: false, reduced: true });
    assert.equal(impacts, 4, 'resume commits the pending static impact once');
    rig.configure({ active: false });
    assert.equal(rig.frame, null);
  } finally {
    globalThis.requestAnimationFrame = oldRaf;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});
