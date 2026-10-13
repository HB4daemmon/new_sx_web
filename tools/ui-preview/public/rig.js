// Texture parts inherit their parent's transform; hands and weapons follow the elbows.
export const bones = [
  { id: 'root', parent: null, x: 128, y: 352 },
  { id: 'legL', parent: 'root', x: -19, y: -73, sprite: 'legL', w: 39, h: 83, ax: .5, ay: .08 },
  { id: 'legR', parent: 'root', x: 19, y: -73, sprite: 'legR', w: 39, h: 83, ax: .5, ay: .08 },
  { id: 'backArm', parent: 'body', x: -30, y: -48, sprite: 'upper', w: 38, h: 58, ax: .5, ay: .12, angle: .16 },
  { id: 'backHand', parent: 'backArm', x: 0, y: 43, sprite: 'forearm', w: 27, h: 52, ax: .5, ay: .12 },
  { id: 'frontArm', parent: 'body', x: 32, y: -48, sprite: 'upper', w: 38, h: 58, ax: .5, ay: .12, angle: -.24 },
  { id: 'body', parent: 'root', x: 0, y: -122, sprite: 'torso', w: 89, h: 84, ax: .5, ay: .76 },
  { id: 'skirt', parent: 'body', x: 0, y: 0, sprite: 'skirt', w: 98, h: 67, ax: .5, ay: .15 },
  { id: 'head', parent: 'body', x: 0, y: -58, sprite: 'head', w: 100, h: 105, ax: .5, ay: .92 },
  { id: 'weapon', parent: 'frontHand', x: 3, y: 38, sprite: 'weapon', w: 32, h: 109, ax: .5, ay: .9, angle: .85 },
  { id: 'frontHand', parent: 'frontArm', x: 0, y: 43, sprite: 'forearm', w: 27, h: 52, ax: .5, ay: .12, angle: -.22 },
  { id: 'ribbon', parent: 'body', x: -27, y: 5, sprite: 'ribbon', w: 22, h: 34, ax: .2, ay: .1, angle: -.15 },
];

export const durations = { attack: 740, rage: 1050, artifact: 1000, heal: 950, hit: 480, guard: 600 };

export function poseAt(action = 'idle', progress = 0, clock = 0, staticMode = false) {
  const pulse = Math.sin(Math.PI * Math.min(1, progress));
  const pose = {};
  const set = (id, angle = 0, x = 0, y = 0) => { pose[id] = { angle, x, y }; };
  if (staticMode) return pose;
  const breath = Math.sin(clock / 650);
  set('body', .008 * breath, 0, -1.5 * breath);
  set('head', -.012 * breath);
  set('ribbon', .08 * Math.sin(clock / 780));
  if (action === 'attack') {
    set('root', 0, pulse * 18);
    set('body', -.09 * pulse);
    set('frontArm', -1.12 * pulse);
    set('frontHand', -.6 * pulse);
    set('weapon', 2.6 * pulse);
    set('backArm', .3 * pulse);
  } else if (action === 'rage') {
    set('root', 0, pulse * 24, -pulse * 6);
    set('body', -.13 * pulse);
    set('frontArm', -2.05 * pulse);
    set('frontHand', -.25 * pulse);
    set('weapon', 3.4 * pulse);
    set('backArm', .6 * pulse);
    set('head', .08 * pulse);
  } else if (action === 'artifact') {
    set('frontArm', -1.25 * pulse);
    set('frontHand', -.65 * pulse);
    set('backArm', .52 * pulse);
    set('head', -.09 * pulse);
    set('weapon', 4.7 * pulse);
  } else if (action === 'heal') {
    set('frontArm', -.6 * pulse);
    set('frontHand', -1.15 * pulse);
    set('backArm', .6 * pulse);
    set('backHand', 1.15 * pulse);
    set('head', .08 * pulse);
    set('body', 0, 0, -pulse * 3);
    set('weapon', 4.55 * pulse);
  } else if (action === 'hit' || action === 'guard') {
    set('root', 0, -pulse * (action === 'hit' ? 11 : 4));
    set('body', .1 * pulse);
    set('head', -.08 * pulse);
    set('frontArm', -.6 * pulse);
    set('frontHand', -.8 * pulse);
  }
  return pose;
}

export function worldBones(pose = {}) {
  const byId = new Map(bones.map(bone => [bone.id, bone]));
  const resolved = new Map();
  const resolve = id => {
    if (resolved.has(id)) return resolved.get(id);
    const bone = byId.get(id);
    const delta = pose[id] || {};
    const x = bone.x + (delta.x || 0), y = bone.y + (delta.y || 0);
    const angle = (bone.angle || 0) + (delta.angle || 0);
    const parent = bone.parent && resolve(bone.parent);
    const result = parent
      ? { x: parent.x + x * Math.cos(parent.angle) - y * Math.sin(parent.angle),
        y: parent.y + x * Math.sin(parent.angle) + y * Math.cos(parent.angle), angle: parent.angle + angle }
      : { x, y, angle };
    resolved.set(id, result);
    return result;
  };
  bones.forEach(bone => resolve(bone.id));
  return resolved;
}

export function drawRig(context, rig, image, { x, y, scale, facing = 1, action = 'idle',
  progress = 0, clock = 0, staticMode = false, artifactImage = null } = {}) {
  const transforms = worldBones(poseAt(action, progress, clock, staticMode));
  context.save();
  context.translate(x, y);
  context.scale(scale * facing, scale);
  context.translate(-128, -352);
  for (const bone of bones) {
    if (!bone.sprite || !rig.parts[bone.sprite]) continue;
    const world = transforms.get(bone.id);
    context.save();
    context.translate(world.x, world.y);
    context.rotate(world.angle);
    const anchorY = bone.sprite === 'weapon' ? rig.weaponGrip ?? bone.ay : bone.ay;
    context.drawImage(image, ...rig.parts[bone.sprite],
      -bone.w * bone.ax, -bone.h * anchorY, bone.w, bone.h);
    context.restore();
  }
  if (!staticMode && progress > 0 && progress < 1) {
    const fade = Math.sin(Math.PI * progress);
    if (action === 'artifact' && artifactImage) {
      context.save();
      context.globalAlpha = fade;
      context.translate(186, 188 - fade * 18);
      context.rotate(Math.sin(progress * Math.PI * 2) * .1);
      context.drawImage(artifactImage, -26, -26, 52, 52);
      context.restore();
    } else if (action === 'heal') {
      context.save();
      context.globalAlpha = fade;
      context.fillStyle = '#38644f';
      // A compact healing mark; no full-screen flash or moving damage stream.
      context.fillRect(180, 196 - progress * 24, 6, 22);
      context.fillRect(172, 204 - progress * 24, 22, 6);
      context.restore();
    }
  }
  context.restore();
  return transforms;
}

export class BattleRig {
  constructor(canvas, library, images) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.library = library;
    this.images = images;
    this.method = 'RKF01';
    this.clock = 0;
    this.time = 0;
    this.active = false;
    this.paused = false;
    this.reduced = false;
    this.speed = 1;
    this.actions = new Map();
    this.frame = null;
    this.tick = this.tick.bind(this);
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
    this.draw();
  }
  configure({ active = this.active, paused = this.paused, reduced = this.reduced,
    speed = this.speed, method = this.method } = {}) {
    this.active = active;
    this.paused = paused;
    this.reduced = reduced;
    this.speed = speed;
    this.method = method;
    if (reduced && active && !paused) {
      for (const beat of [...this.actions.values()]) {
        if (!beat.impacted) { beat.impacted = true; beat.onImpact?.(); }
      }
    }
    if (!active || (reduced && !paused)) this.reset();
    if (reduced) {
      this.canvas.dataset.playerAction = 'idle';
      this.canvas.dataset.enemyAction = 'idle';
    }
    cancelAnimationFrame(this.frame);
    this.frame = null;
    this.time = 0;
    this.draw();
    if (active && !paused && !reduced) this.frame = requestAnimationFrame(this.tick);
  }
  play(side, action, onImpact = null, artifactSrc = null) {
    if (this.reduced) { onImpact?.(); return; }
    this.actions.set(side, { action, started: this.clock, onImpact, impacted: false, artifactSrc });
    this.canvas.dataset[`${side}Action`] = action;
    this.draw();
  }
  reset() {
    this.actions.clear();
    this.canvas.dataset.playerAction = 'idle';
    this.canvas.dataset.enemyAction = 'idle';
    this.draw();
  }
  tick(time) {
    const delta = this.time ? Math.min(time - this.time, 80) : 0;
    this.time = time;
    this.clock += delta * this.speed;
    for (const [side, beat] of this.actions) {
      const elapsed = this.clock - beat.started;
      if (!beat.impacted && elapsed >= durations[beat.action] * .44) {
        beat.impacted = true;
        beat.onImpact?.();
      }
      if (elapsed >= durations[beat.action]) {
        this.actions.delete(side);
        this.canvas.dataset[`${side}Action`] = 'idle';
      }
    }
    this.draw();
    if (this.active && !this.paused && !this.reduced) this.frame = requestAnimationFrame(this.tick);
  }
  draw() {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height || !this.context) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    const ctx = this.context;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(width / 410, height / 300, 1.02);
    for (const [side, id] of [['player', this.method], ['enemy', 'EN-A1-L1']]) {
      const rig = this.library.rigs[id];
      const beat = this.actions.get(side);
      const action = beat?.action || 'idle';
      const progress = beat ? Math.min(1, (this.clock - beat.started) / durations[action]) : 0;
      drawRig(ctx, rig, this.images.get(rig.src), {
        x: width * (side === 'player' ? .25 : .75), y: height - 12,
        scale, facing: side === 'player' ? 1 : -1, action, progress,
        clock: this.clock + (side === 'player' ? 0 : 1400), staticMode: this.reduced,
        artifactImage: beat?.artifactSrc && this.images.get(beat.artifactSrc),
      });
    }
    this.canvas.dataset.clock = String(Math.round(this.clock));
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.actions.clear();
  }
}
