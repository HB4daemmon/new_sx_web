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
