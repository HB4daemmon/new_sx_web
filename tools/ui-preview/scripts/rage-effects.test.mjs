import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clips } from '../src/frames-data.js';
import { RageEffect, sampleRageEffect } from '../src/rage-effects.js';

function assertInsideCanvas(effect, width, height, scale) {
  const safeEdge = 8 + (5 * scale + 1) / 2 + 1;
  for (const instruction of effect.graphics.context.instructions) {
    const strokeWidth = instruction.data.style.width || 0;
    for (const pathInstruction of instruction.data.path.instructions) {
      if (pathInstruction.action !== 'poly') continue;
      const coordinates = pathInstruction.data[0];
      for (let index = 0; index < coordinates.length; index += 2) {
        const x = coordinates[index];
        const y = coordinates[index + 1];
        assert.ok(x - strokeWidth / 2 >= 8);
        assert.ok(width - x - strokeWidth / 2 >= 8);
        assert.ok(y - strokeWidth / 2 >= 8);
        assert.ok(height - y - strokeWidth / 2 >= 8);
        assert.ok(x >= safeEdge && x <= width - safeEdge);
        assert.ok(y >= safeEdge && y <= height - safeEdge);
      }
    }
  }
}

test('rage effect timing is derived from the authored rage clip', () => {
  assert.equal(clips.rage.duration, 1050);
  assert.equal(clips.rage.impactAt, 433.3333333333333);
  const beforeImpact = sampleRageEffect(clips.rage.impactAt - .01, 'player');
  const atImpact = sampleRageEffect(clips.rage.impactAt, 'player');
  assert.equal(beforeImpact.phase, 'charge');
  assert.equal(beforeImpact.impact, 0);
  assert.equal(atImpact.phase, 'impact');
  assert.equal(atImpact.impact, 1);
  assert.equal(atImpact.impactAt, clips.rage.impactAt);
  assert.equal(atImpact.duration, clips.rage.duration);
});

test('charge, impact and recovery have distinct deterministic snapshots', () => {
  const samples = [
    sampleRageEffect(180, 'player'),
    sampleRageEffect(clips.rage.impactAt, 'player'),
    sampleRageEffect(clips.rage.impactAt + 300, 'player'),
    sampleRageEffect(clips.rage.duration - 1, 'player'),
  ];
  assert.deepEqual(samples.map(sample => sample.phase),
    ['charge', 'impact', 'follow', 'recover']);
  assert.ok(samples[0].charge > samples[0].impact);
  assert.ok(samples[1].impact > samples[2].impact);
  assert.ok(samples[2].trail > samples[3].trail);
  assert.deepEqual(samples, [
    sampleRageEffect(180, 'player'),
    sampleRageEffect(clips.rage.impactAt, 'player'),
    sampleRageEffect(clips.rage.impactAt + 300, 'player'),
    sampleRageEffect(clips.rage.duration - 1, 'player'),
  ]);
});

test('completed and invalid timestamps are bounded and have no active geometry', () => {
  for (const elapsed of [clips.rage.duration, clips.rage.duration + 300]) {
    const sample = sampleRageEffect(elapsed, 'enemy');
    assert.equal(sample.phase, 'complete');
    assert.equal(sample.complete, true);
    assert.equal(sample.charge, 0);
    assert.equal(sample.impact, 0);
    assert.equal(sample.trail, 0);
    assert.equal(sample.progress, 1);
  }

  for (const elapsed of [NaN, Infinity, -Infinity, -10]) {
    const sample = sampleRageEffect(elapsed, 'player');
    assert.equal(sample.phase, 'charge');
    assert.equal(sample.progress, 0);
    assert.ok(Number.isFinite(sample.charge));
    assert.equal(sample.impact, 0);
  }
});

test('player and enemy use mirrored non-color cues as well as distinct palettes', () => {
  const player = sampleRageEffect(clips.rage.impactAt, 'player');
  const enemy = sampleRageEffect(clips.rage.impactAt, 'enemy');
  assert.equal(player.direction, 1);
  assert.equal(enemy.direction, -1);
  assert.equal(player.motif, 'diamond');
  assert.equal(enemy.motif, 'chevron');
  assert.notEqual(player.palette, enemy.palette);
});

test('graphics are created, updated and destroyed without owning a clock', () => {
  const effect = new RageEffect();
  assert.ok(effect.display);
  const state = effect.update({
    side: 'player',
    elapsed: clips.rage.impactAt,
    x: 96,
    y: 475,
    targetX: 304,
    targetY: 475,
    scale: .6,
    width: 400,
    height: 500,
  });
  assert.equal(state.phase, 'impact');
  assert.ok(effect.graphics.context.instructions.length > 0);
  assertInsideCanvas(effect, 400, 500, .6);
  const narrowScale = .55;
  const narrowWidth = 240;
  const narrowHeight = 400;
  const narrow = new RageEffect();
  narrow.update({
    side: 'enemy',
    elapsed: clips.rage.impactAt,
    x: narrowWidth * .76,
    y: narrowHeight - 25,
    targetX: narrowWidth * .24,
    targetY: narrowHeight - 25,
    scale: narrowScale,
    width: narrowWidth,
    height: narrowHeight,
  });
  assert.ok(narrow.graphics.context.instructions.length > 0);
  assertInsideCanvas(narrow, narrowWidth, narrowHeight, narrowScale);
  narrow.destroy();
  effect.update({
    side: 'enemy',
    elapsed: clips.rage.duration,
    x: 304,
    y: 475,
    targetX: 96,
    targetY: 475,
    scale: .6,
    width: 400,
    height: 500,
  });
  assert.equal(effect.graphics.context.instructions.length, 0);
  effect.destroy();
  assert.equal(effect.destroyed, true);
  assert.equal(effect.update({ elapsed: 1 }).phase, 'charge');
});
