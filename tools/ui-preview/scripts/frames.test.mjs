import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  battleLayout, clipFor, clips, FrameTimeline, poseIndex, poseNames, sampleFrame,
} from '../src/frames-data.js';

const sequence = action => clipFor(action).frames.map(step => step.frame);

test('battle spacing separates both sides while reserving rearward and foot room', () => {
  for (const [width, height] of [[320, 260], [390, 397], [520, 448], [1440, 423]]) {
    const { scale, baseline, stance } = battleLayout(width, height);
    const oldWidth = width - 24;
    const oldScale = Math.min(oldWidth / 520, height / 448, 1);
    const oldStance = Math.min(oldWidth * .2, 126 * oldScale);
    assert.ok(stance * 2 >= oldStance * 2 * 1.25, 'at least 25% wider boot spacing');
    assert.ok(width / 2 - stance - 162 * scale > 3, 'calibrated rearward poses and recoil fit');
    assert.ok(baseline + 28 * scale <= height - 6 * scale, 'lowered weapon tips fit');
    assert.ok(stance <= 185 * scale, 'wide desktop combat remains centered');
  }
});

test('the twelve pose indices and authored action sequences stay aligned', () => {
  assert.equal(poseNames.length, 12);
  assert.deepEqual(poseIndex, {
    ready: 0,
    earlywindup: 1,
    latewindup: 2,
    contact: 3,
    follow: 4,
    recover: 5,
    ragewindup: 6,
    ragecontact: 7,
    ragefollow: 8,
    guard: 9,
    artifact: 10,
    heal: 11,
  });
  assert.deepEqual(sequence('attack'), [0, 1, 2, 3, 4, 5, 0]);
  assert.deepEqual(sequence('rage'), [0, 1, 6, 7, 8, 5, 0]);
  assert.deepEqual(sequence('artifact'), [0, 1, 10, 10, 5, 0]);
  assert.deepEqual(sequence('cast'), sequence('artifact'));
  assert.deepEqual(sequence('heal'), [0, 1, 11, 11, 5, 0]);
  assert.deepEqual(sequence('guard'), [0, 9, 9, 0]);
  assert.deepEqual(sequence('hit'), [0, 9, 9, 5, 0]);
  assert.equal(sampleFrame('attack', clips.attack.duration).index, 0);
  assert.equal(sampleFrame('rage', clips.rage.duration).index, 0);
});

test('attack and rage impacts begin on their exact contact poses', () => {
  for (const action of ['attack', 'rage']) {
    const clip = clips[action];
    const contact = action === 'attack' ? 3 : 7;
    assert.equal(sampleFrame(action, clip.impactAt - 1).index,
      action === 'attack' ? 2 : 6);
    assert.equal(sampleFrame(action, clip.impactAt).index, contact);
    assert.equal(clip.impactAt, clip.impactFrame * 1000 / 60);
  }
});

test('the clock emits one impact at contact and finishes back on ready', () => {
  let impacts = 0;
  const changes = [];
  const clock = new FrameTimeline({
    onAction: (side, action) => changes.push([side, action]),
  });
  clock.configure({ active: true });
  clock.play('player', 'attack', () => impacts++);
  assert.equal(impacts, 0);

  clock.advance(clips.attack.impactAt);
  assert.equal(impacts, 1);
  assert.equal(sampleFrame('attack', clock.clock).index, 3);
  clock.advance(clips.attack.duration - clips.attack.impactAt);
  assert.equal(impacts, 1);
  assert.equal(clock.actions.size, 0);
  assert.deepEqual(changes.at(-1), ['player', 'idle']);
  assert.equal(sampleFrame('idle', clock.clock).index, 0);
});

test('a contact callback can start a target reaction without altering this tick', () => {
  const clock = new FrameTimeline();
  clock.configure({ active: true });
  clock.play('player', 'rage', () => clock.play('enemy', 'hit'));
  clock.advance(clips.rage.impactAt);
  assert.equal(clock.actions.size, 2);
  assert.equal(clock.actions.get('player').action, 'rage');
  assert.equal(clock.actions.get('enemy').action, 'hit');
  assert.equal(sampleFrame('hit', clock.clock - clock.actions.get('enemy').started).index, 0);
  clock.advance(clips.rage.duration - clips.rage.impactAt);
  assert.equal(clock.actions.size, 0);
});

test('paused time and reduced-motion changes stay pending until resume', () => {
  let impacts = 0;
  const clock = new FrameTimeline();
  clock.configure({ active: true });
  clock.play('player', 'attack', () => impacts++);
  clock.advance(100);
  const heldClock = clock.clock;
  const heldFrame = sampleFrame('attack', heldClock).index;

  clock.configure({ paused: true, reduced: true });
  clock.advance(2000);
  clock.play('enemy', 'heal', () => impacts++);
  assert.equal(impacts, 0);
  assert.equal(clock.clock, heldClock);
  assert.equal(sampleFrame('attack', clock.clock - clock.actions.get('player').started).index, heldFrame);
  assert.equal(clock.actions.get('enemy').action, 'heal');

  clock.configure({ paused: false });
  assert.equal(impacts, 2);
  assert.equal(clock.actions.size, 0);
  clock.configure({});
  assert.equal(impacts, 2);
});

test('reduced motion commits active actions once and ignores reentrant actions', () => {
  let impacts = 0;
  const clock = new FrameTimeline();
  clock.configure({ active: true });
  clock.play('player', 'attack', () => {
    impacts++;
    clock.play('enemy', 'hit');
  });
  clock.configure({ reduced: true });
  assert.equal(impacts, 1);
  assert.equal(clock.actions.size, 0);
  assert.equal(clock.play('player', 'heal', () => impacts++).impacted, true);
  assert.equal(impacts, 2);
  clock.advance(1000);
  assert.equal(impacts, 2);
});

test('leaving battle cancels actions without settling them', () => {
  let impacts = 0;
  const clock = new FrameTimeline();
  clock.configure({ active: true });
  clock.play('player', 'attack', () => impacts++);
  clock.configure({ active: false });
  assert.equal(clock.actions.size, 0);
  assert.equal(impacts, 0);
  clock.configure({ active: true, reduced: true });
  assert.equal(impacts, 0);
});

test('idle breath is small and hit adds an independent light displacement', () => {
  const idle = sampleFrame('idle', 750);
  assert.equal(idle.index, 0);
  assert.ok(Math.abs(idle.offsetY) <= 1.2);
  assert.ok(idle.scale > .99 && idle.scale < 1.01);
  assert.ok(sampleFrame('hit', clips.hit.duration / 2).offsetX > 0);
});
