export const frameRate = 60;

const playerIds = new Set(['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05']);
const enemyIdPattern = /^EN-A[1-4]-(?:C[1-4]|L[12]|B[12])$|^EN-F[12]$/;

export function isFrameCharacterId(id) {
  return playerIds.has(id) || enemyIdPattern.test(id);
}

export const poseNames = Object.freeze([
  'ready',
  'earlywindup',
  'latewindup',
  'contact',
  'follow',
  'recover',
  'ragewindup',
  'ragecontact',
  'ragefollow',
  'guard',
  'artifact',
  'heal',
]);

export const poseIndex = Object.freeze(Object.fromEntries(
  poseNames.map((name, index) => [name, index]),
));

function defineClip(sequence, frameCounts, impactStep = null, extra = {}) {
  const frames = sequence.map((frame, index) => ({
    frame,
    frames: frameCounts[index],
  }));
  const starts = [];
  let totalFrames = 0;
  for (const step of frames) {
    starts.push(totalFrames);
    totalFrames += step.frames;
  }
  const impactFrame = impactStep === null ? null : starts[impactStep];
  return Object.freeze({
    frames: Object.freeze(frames.map(step => Object.freeze(step))),
    starts: Object.freeze(starts),
    totalFrames,
    duration: totalFrames * 1000 / frameRate,
    impactFrame,
    impactAt: impactFrame === null ? null : impactFrame * 1000 / frameRate,
    ...extra,
  });
}

export const clips = Object.freeze({
  idle: defineClip([0], [180], null, { loop: true }),
  attack: defineClip([0, 1, 2, 3, 4, 5, 0], [4, 5, 10, 5, 7, 9, 5], 3),
  rage: defineClip([0, 1, 6, 7, 8, 5, 0], [6, 8, 12, 6, 9, 12, 10], 3),
  artifact: defineClip([0, 1, 10, 10, 5, 0], [5, 7, 12, 10, 12, 14], 2),
  heal: defineClip([0, 1, 11, 11, 5, 0], [5, 7, 12, 10, 10, 14], 2),
  guard: defineClip([0, 9, 9, 0], [3, 8, 8, 5]),
  hit: defineClip([0, 9, 9, 5, 0], [1, 3, 3, 4, 2]),
});

export const durations = Object.freeze(Object.fromEntries(
  Object.entries(clips).filter(([name]) => name !== 'idle')
    .map(([name, clip]) => [name, clip.duration]),
));

export function battleLayout(width, height, footRoom = 28, rearExtent = 162, rise = 420) {
  // Use the whole authored motion envelope, not each pose, to keep scale and feet stable.
  const scale = Math.min((width / 4 - 4) / (rearExtent + 8),
    (height - 12) / (rise + footRoom + 6), 1);
  return {
    scale,
    baseline: height - Math.max(12, footRoom * scale + 6),
    stance: width * .25,
  };
}

const actionAliases = Object.freeze({ cast: 'artifact' });

export function clipFor(action) {
  return clips[actionAliases[action] || action] || null;
}

export function sampleFrame(action, elapsed = 0) {
  const canonicalAction = actionAliases[action] || action;
  const clip = clipFor(canonicalAction);
  if (!clip) throw new Error(`Unknown frame action: ${action}`);

  const time = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  if (canonicalAction === 'idle') {
    const phase = (time % 3000) / 3000 * Math.PI * 2;
    return {
      index: 0,
      pose: poseNames[0],
      progress: 0,
      offsetX: 0,
      offsetY: -Math.sin(phase) * 1.2,
      scale: 1 + Math.sin(phase) * 0.006,
      complete: false,
    };
  }

  if (!clip.loop && time >= clip.duration) {
    return {
      index: 0, pose: poseNames[0], progress: 1,
      offsetX: 0, offsetY: 0, scale: 1, complete: true,
    };
  }

  const localTime = clip.loop ? time % clip.duration : time;
  const framePosition = localTime * frameRate / 1000;
  let stepIndex = clip.frames.length - 1;
  for (let index = 0; index < clip.frames.length; index++) {
    if (framePosition < clip.starts[index] + clip.frames[index].frames) {
      stepIndex = index;
      break;
    }
  }
  const step = clip.frames[stepIndex];
  const stepProgress = Math.min(1, Math.max(0,
    (framePosition - clip.starts[stepIndex]) / step.frames));
  const progress = Math.min(1, localTime / clip.duration);
  const hitPulse = canonicalAction === 'hit' ? Math.sin(progress * Math.PI) : 0;

  return {
    index: step.frame,
    pose: poseNames[step.frame],
    step: stepIndex,
    stepProgress,
    progress,
    offsetX: hitPulse * 5,
    offsetY: 0,
    scale: 1,
    complete: false,
  };
}

export class FrameTimeline {
  constructor({ onAction = null } = {}) {
    this.clock = 0;
    this.active = false;
    this.paused = false;
    this.reduced = false;
    this.speed = 1;
    this.actions = new Map();
    this.onAction = onAction;
  }

  configure({ active = this.active, paused = this.paused, reduced = this.reduced,
    speed = this.speed } = {}) {
    this.active = Boolean(active);
    this.paused = Boolean(paused);
    this.reduced = Boolean(reduced);
    this.speed = Number.isFinite(speed) ? Math.max(0, speed) : 1;

    if (!this.active) {
      this.reset();
      return;
    }
    if (this.reduced && !this.paused) this.settlePending();
  }

  play(side, action, onImpact = null, artifactSrc = null) {
    if (!this.active) return null;
    const clip = clipFor(action);
    if (!clip || action === 'idle') throw new Error(`Unknown frame action: ${action}`);

    const beat = {
      action,
      started: this.clock,
      onImpact,
      impacted: false,
      artifactSrc,
    };

    if (this.reduced && !this.paused) {
      beat.impacted = true;
      this.onAction?.(side, 'idle', beat);
      onImpact?.();
      return beat;
    }

    this.actions.set(side, beat);
    this.onAction?.(side, action, beat);
    return beat;
  }

  advance(delta) {
    if (!this.active || this.paused || this.reduced) return 0;
    const advanceBy = Math.max(0, Number.isFinite(delta) ? delta : 0) * this.speed;
    this.clock += advanceBy;

    const callbacks = [];
    const completed = [];
    for (const [side, beat] of [...this.actions]) {
      if (this.actions.get(side) !== beat) continue;
      const clip = clipFor(beat.action);
      const elapsed = this.clock - beat.started;
      if (!beat.impacted && clip.impactAt !== null && elapsed >= clip.impactAt) {
        beat.impacted = true;
        if (beat.onImpact) callbacks.push(beat.onImpact);
      }
      if (elapsed >= clip.duration && this.actions.get(side) === beat) {
        this.actions.delete(side);
        completed.push([side, beat]);
      }
    }

    for (const [side, beat] of completed) this.onAction?.(side, 'idle', beat);
    for (const callback of callbacks) callback();
    return advanceBy;
  }

  reset() {
    const actions = [...this.actions];
    this.actions.clear();
    for (const [side, beat] of actions) this.onAction?.(side, 'idle', beat);
  }

  settlePending() {
    const pending = [...this.actions];
    this.actions.clear();
    for (const [side, beat] of pending) {
      this.onAction?.(side, 'idle', beat);
      if (beat.impacted) continue;
      beat.impacted = true;
      if (beat.onImpact) beat.onImpact();
    }
  }
}
