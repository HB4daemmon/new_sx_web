import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { FrameBattle } from '../src/frames.js';
import { clips, FrameTimeline } from '../src/frames-data.js';
import { ImpactEffect, sampleImpactEffect } from '../src/impact-effects.js';

function makeCharacter(id) {
  const textures = Array.from({ length: 12 }, () => new Texture({
    source: Texture.WHITE.source,
    frame: new Rectangle(0, 0, 16, 16),
  }));
  return {
    id,
    anchor: [160, 420],
    textures,
    displayScale: 1,
    rearExtent: 120,
    rise: 322,
    celBounds: Array.from({ length: 12 }, (_, index) =>
      index === 9 ? [40, 98, 340, 422] : [50, 110, 280, 420]),
  };
}

function makeBattle() {
  class FakeCanvas extends EventTarget {
    clientWidth = 480;
    clientHeight = 520;
    dataset = {};
  }

  const canvas = new FakeCanvas();
  const rendered = { count: 0 };
  const renderer = {
    resize() {},
    render() { rendered.count++; },
    destroy() {},
  };
  const characters = new Map([
    ['RKF01', makeCharacter('RKF01')],
    ['EN-A1-L1', makeCharacter('EN-A1-L1')],
  ]);
  const stage = new Container();
  const actorLayer = new Container();
  const effectLayer = new Container();
  stage.addChild(actorLayer, effectLayer);
  const actors = new Map();
  for (const [side, id] of [['player', 'RKF01'], ['enemy', 'EN-A1-L1']]) {
    const character = characters.get(id);
    const sprite = new Sprite(character.textures[0]);
    sprite.anchor.set(character.anchor[0] / 400, character.anchor[1] / 448);
    actorLayer.addChild(sprite);
    actors.set(side, { character, sprite });
  }

  const battle = Object.create(FrameBattle.prototype);
  Object.assign(battle, {
    canvas,
    renderer,
    characters,
    stage,
    actorLayer,
    effectLayer,
    actors,
    effects: new Map(),
    images: new Map(),
    timeline: new FrameTimeline(),
    disposed: false,
    frameId: null,
    resizeObserver: { disconnect() {} },
    onContextLost() {},
  });
  canvas.addEventListener('webglcontextlost', battle.onContextLost);
  return { battle, canvas, rendered };
}

function disposeBattle(battle) {
  const previousCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  try {
    battle.dispose();
  } finally {
    if (previousCancel) globalThis.cancelAnimationFrame = previousCancel;
    else delete globalThis.cancelAnimationFrame;
  }
}

test('battle snapshots project cel alpha bounds and the ready head edge in CSS coordinates', () => {
  const { battle, canvas, rendered } = makeBattle();
  const events = [];
  canvas.addEventListener('battle-art-draw', event => {
    events.push({ detail: event.detail, renderCount: rendered.count });
  });

  battle.draw();
  const snapshot = battle.snapshot();
  assert.deepEqual(Object.keys(snapshot.player).sort(), [
    'action', 'bounds', 'effect', 'elapsed', 'frame', 'head', 'id', 'pose', 'scale', 'x', 'y',
  ]);
  assert.ok(Math.abs(snapshot.player.head.x -
    (snapshot.player.x + 5 * snapshot.player.scale)) < 1e-9);
  assert.ok(Math.abs(snapshot.player.head.y -
    (snapshot.player.y - 310 * snapshot.player.scale)) < 1e-9);
  assert.ok(Math.abs(snapshot.player.bounds.x -
    (snapshot.player.x - 110 * snapshot.player.scale)) < 1e-9);
  assert.ok(Math.abs(snapshot.player.bounds.width - 230 * snapshot.player.scale) < 1e-9);
  assert.ok(Math.abs(snapshot.player.bounds.height - 310 * snapshot.player.scale) < 1e-9);
  assert.ok(snapshot.enemy.bounds.x < snapshot.enemy.x);
  assert.ok(snapshot.enemy.bounds.x + snapshot.enemy.bounds.width > snapshot.enemy.x,
    'mirrored enemy alpha bounds straddle its foot anchor');
  assert.equal(events.length, 1);
  assert.equal(events[0].renderCount, 1, 'the event fires after the canvas render');
  assert.deepEqual(events[0].detail, snapshot);

  battle.draw();
  assert.equal(events.length, 2, 'each subsequent draw emits one event');
  assert.equal(events[1].renderCount, 2);
  disposeBattle(battle);
});

test('hit and guard effects expose deterministic timeline phases and reduced-motion state', () => {
  assert.equal(sampleImpactEffect('hit', 0).phase, 'impact');
  assert.equal(sampleImpactEffect('hit', 150).phase, 'fade');
  assert.equal(sampleImpactEffect('hit', clips.hit.duration).phase, 'complete');
  assert.equal(sampleImpactEffect('guard', 0).phase, 'guard');
  assert.equal(sampleImpactEffect('guard', 50).phase, 'guard');
  assert.equal(sampleImpactEffect('guard', clips.guard.duration).phase, 'complete');
  assert.deepEqual(
    sampleImpactEffect('hit', 0, true),
    {
      action: 'hit', phase: 'reduced', progress: 0, duration: clips.hit.duration,
      complete: false, alpha: 0, flash: 0,
    },
  );

  const character = makeCharacter('RKF01');
  const sprite = new Sprite(character.textures[0]);
  sprite.anchor.set(.4, 420 / 448);
  sprite.position.set(120, 380);
  sprite.scale.set(.6);
  const bounds = { x: 70, y: 180, width: 100, height: 200 };
  const effect = new ImpactEffect(character);
  const hit = effect.update({
    action: 'hit', elapsed: 0, character, sprite, bounds, scale: .6, direction: 1,
  });
  assert.equal(hit.phase, 'impact');
  assert.ok(effect.flashSprite.alpha > 0);
  assert.ok(effect.graphics.context.instructions.length > 0);

  const guard = effect.update({
    action: 'guard', elapsed: 50, character, sprite, bounds, scale: .6, direction: -1,
  });
  assert.equal(guard.phase, 'guard');
  assert.equal(effect.flashSprite.alpha, 0);
  assert.ok(effect.graphics.context.instructions.length > 0);
  const reduced = effect.update({
    action: 'hit', elapsed: 0, character, sprite, bounds, scale: .6, direction: 1,
    reducedMotion: true,
  });
  assert.equal(reduced.phase, 'reduced');
  assert.equal(effect.flashSprite.alpha, 0);
  assert.equal(effect.graphics.context.instructions.length, 0);
  effect.destroy();
  assert.equal(effect.destroyed, true);
});

test('FrameBattle snapshots hit and guard effect states from the shared timeline', () => {
  const { battle } = makeBattle();
  battle.timeline.configure({ active: true });
  battle.timeline.play('enemy', 'hit');
  battle.draw();
  assert.deepEqual(battle.snapshot().enemy.effect, {
    action: 'hit', phase: 'impact', palette: 'warm-gold',
  });
  assert.ok(battle.effects.get('enemy').impact.graphics.context.instructions.length > 0);

  battle.reset();
  battle.timeline.clock = 0;
  battle.timeline.play('player', 'guard');
  battle.timeline.advance(50);
  battle.draw();
  assert.deepEqual(battle.snapshot().player.effect, {
    action: 'guard', phase: 'guard', palette: 'cool-cyan',
  });
  assert.ok(battle.effects.get('player').impact.graphics.context.instructions.length > 0);

  battle.timeline.configure({ paused: true, reduced: true });
  battle.draw();
  assert.deepEqual(battle.snapshot().player.effect, { action: 'guard', phase: 'reduced' });
  assert.equal(battle.effects.size, 0);
  disposeBattle(battle);
});
