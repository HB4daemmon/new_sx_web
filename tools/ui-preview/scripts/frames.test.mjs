import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  battleLayout, clipFor, clips, FrameTimeline, isFrameCharacterId, poseIndex, poseNames,
  sampleFrame,
} from '../src/frames-data.js';

const sequence = action => clipFor(action).frames.map(step => step.frame);

test('battle spacing separates both sides while reserving rearward and foot room', () => {
  for (const [width, height] of [[360, 235], [390, 260], [520, 448], [960, 320]]) {
    const { scale, baseline, stance } = battleLayout(width, height);
    const oldWidth = width - 24;
    const oldScale = Math.min(oldWidth / 520, height / 448, 1);
    const oldStance = Math.min(oldWidth * .2, 126 * oldScale);
    assert.ok(stance * 2 >= oldStance * 2 * 1.25, 'at least 25% wider boot spacing');
    assert.ok(width / 2 - stance - 162 * scale > 3, 'calibrated rearward poses and recoil fit');
    assert.ok(baseline + 28 * scale <= height - 6 * scale, 'lowered weapon tips fit');
    assert.equal(stance, width / 4, 'actors remain aligned with their HUD columns');
  }
});

test('wide enemy motion envelopes retain outer padding and headroom at every pose', () => {
  for (const width of [344, 366, 896, 944]) {
    const { scale, baseline, stance } = battleLayout(width, 260, 34, 190, 365);
    assert.ok(width / 2 - stance - (190 + 6) * scale >= 4);
    assert.ok(baseline - 365 * scale >= 6);
    assert.ok(baseline + 34 * scale <= 254);
  }
});

test('expanded battlefields reserve a full float lane above all motion poses', () => {
  for (const [width, height] of [[336, 325], [366, 389], [896, 445], [944, 530]]) {
    const { scale, baseline } = battleLayout(width, height, 34, 190, 420);
    assert.ok(baseline - 420 * scale >= 112, 'head floats cannot enter the HUD');
    assert.ok(baseline + 34 * scale < height - 5, 'actor feet remain inside the field');
  }
});

test('frame character keys cover the five player skins and all content enemy ids', () => {
  const enemies = [];
  for (let act = 1; act <= 4; act++) {
    for (let index = 1; index <= 4; index++) enemies.push(`EN-A${act}-C${index}`);
    for (let index = 1; index <= 2; index++) {
      enemies.push(`EN-A${act}-L${index}`, `EN-A${act}-B${index}`);
    }
  }
  enemies.push('EN-F1', 'EN-F2');
  assert.equal(enemies.length, 34);
  assert.ok([...['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05'], ...enemies]
    .every(isFrameCharacterId));
  assert.equal(isFrameCharacterId('RKF06'), false);
  assert.equal(isFrameCharacterId('EN-A1-X1'), false);
  assert.equal(isFrameCharacterId('EN-A5-C1'), false);
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
