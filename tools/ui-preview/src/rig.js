import { Container, Graphics, Sprite, Texture, autoDetectRenderer } from 'pixi.js';
// Pixi's no-eval polyfills retain the preview's strict CSP.
import 'pixi.js/unsafe-eval';
import { EventObject, PixiFactory } from 'pixi-dragonbones-runtime';
import { bindings, durations, createSkeletonData, createTextureData } from './rig-data.js';

export { durations } from './rig-data.js';

async function rendererFor(canvas) {
  return autoDetectRenderer({
    canvas, width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight),
    resolution: Math.min(globalThis.devicePixelRatio || 1, 2), autoDensity: false,
    backgroundAlpha: 0, antialias: true, preference: 'webgl', preserveDrawingBuffer: true,
  });
}

function factoryFor(library, images) {
  const factory = new PixiFactory(null, false);
  factory.parseDragonBonesData(createSkeletonData(library));
  for (const [id, rig] of Object.entries(library.rigs)) {
    factory.parseTextureAtlasData(createTextureData(id, rig), Texture.from(images.get(rig.src)), id);
  }
  return factory;
}

function armatureFor(factory, id) {
  const armature = factory.buildArmature(id, 'suishi', 'default', id);
  if (!armature) throw new Error(`Unable to build armature: ${id}`);
  armature.animation.gotoAndStopByTime('idle', 0);
  armature.advanceTime(0);
  return armature;
}

export class StartRig {
  static async create(canvas, library, images) {
    const renderer = await rendererFor(canvas);
    try { return new StartRig(canvas, factoryFor(library, images), renderer); }
    catch (error) { renderer.destroy(); throw error; }
  }
  constructor(canvas, factory, renderer) {
    this.canvas = canvas;
    this.factory = factory;
    this.renderer = renderer;
    this.stage = new Container();
    this.armature = null;
    this.method = null;
    this.disposed = false;
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
  }
  configure(method) {
    if (this.disposed) return;
    if (method !== this.method) {
      this.armature?.dispose();
      this.stage.removeChildren();
      this.armature = armatureFor(this.factory, method);
      this.stage.addChild(this.armature.display);
      this.method = method;
      this.canvas.dataset.skin = method;
    }
    this.draw();
  }
  draw() {
    if (this.disposed || !this.armature) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.resize(width, height);
    const display = this.armature.display;
    display.scale.set(Math.min(width / 208, height / 334));
    display.position.set(width / 2, height - 6);
    this.renderer.render(this.stage);
  }
  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.armature?.dispose();
    this.factory.clear();
    this.stage.destroy({ children: true });
    this.renderer.destroy();
  }
}

export class BattleRig {
  static async create(canvas, library, images, onFailure) {
    const renderer = await rendererFor(canvas);
    try { return new BattleRig(canvas, factoryFor(library, images), renderer, images, onFailure); }
    catch (error) { renderer.destroy(); throw error; }
  }
  constructor(canvas, factory, renderer, images, onFailure) {
    Object.assign(this, { canvas, factory, renderer, images, onFailure });
    this.context = renderer;
    this.stage = new Container();
    this.armatures = new Map();
    this.effects = new Map();
    this.method = 'RKF01';
    this.clock = 0;
    this.time = 0;
    this.active = false;
    this.paused = false;
    this.reduced = false;
    this.speed = 1;
    this.actions = new Map();
    this.frame = null;
    this.disposed = false;
    this.tick = this.tick.bind(this);
    this.onContextLost = event => {
      event.preventDefault();
      this.onFailure?.();
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
    this.setCharacter('player', this.method);
    this.setCharacter('enemy', 'EN-A1-L1');
    canvas.dataset.engine = 'dragonbones';
    canvas.getRigSnapshot = () => this.snapshot();
    this.draw();
  }
  setCharacter(side, id) {
    const old = this.armatures.get(side);
    if (old?.armatureData.name === id) return;
    if (old) {
      this.stage.removeChild(old.display);
      old.dispose();
    }
    this.actions.delete(side);
    const armature = armatureFor(this.factory, id);
    armature.display.addDBEventListener(EventObject.FRAME_EVENT, event => {
      const beat = this.actions.get(side);
      if (event.name !== 'impact' || !beat || beat.impacted || event.animationState.name !== beat.action) return;
      beat.impacted = true;
      beat.onImpact?.();
    }, this);
    armature.display.addDBEventListener(EventObject.COMPLETE, event => {
      const beat = this.actions.get(side);
      if (!beat || event.animationState.name !== beat.action) return;
      this.actions.delete(side);
      this.canvas.dataset[`${side}Action`] = 'idle';
      armature.animation.fadeIn('idle', .12, 0);
    }, this);
    this.armatures.set(side, armature);
    this.stage.addChild(armature.display);
    this.canvas.dataset[`${side}Skin`] = id;
  }
  configure({ active = this.active, paused = this.paused, reduced = this.reduced,
    speed = this.speed, method = this.method } = {}) {
    if (this.disposed) return;
    Object.assign(this, { active, paused, reduced, speed, method });
    this.setCharacter('player', method);
    if (reduced && active && !paused) {
      for (const beat of [...this.actions.values()]) {
        if (!beat.impacted) { beat.impacted = true; beat.onImpact?.(); }
      }
    }
    if (!active || (reduced && !paused)) this.reset();
    if (active && !paused && !reduced) {
      for (const [side, armature] of this.armatures) {
        if (!this.actions.has(side) && !armature.animation.isPlaying) armature.animation.play('idle', 0);
      }
    }
    cancelAnimationFrame(this.frame);
    this.frame = null;
    this.time = 0;
    this.draw();
    if (active && !paused && !reduced) this.frame = requestAnimationFrame(this.tick);
  }
  play(side, action, onImpact = null, artifactSrc = null) {
    if (this.disposed) return;
    if (this.reduced) { onImpact?.(); return; }
    this.actions.set(side, { action, started: this.clock, onImpact, impacted: false, artifactSrc });
    this.canvas.dataset[`${side}Action`] = action;
    this.armatures.get(side).animation.fadeIn(action, .06, 1);
    this.draw();
  }
  reset() {
    this.actions.clear();
    for (const [side, armature] of this.armatures) {
      armature.animation.gotoAndStopByTime('idle', 0);
      armature.advanceTime(0);
      if (this.active && !this.reduced) armature.animation.play('idle', 0);
      this.canvas.dataset[`${side}Action`] = 'idle';
    }
    this.draw();
  }
  tick(time) {
    if (this.disposed) return;
    const delta = this.time ? Math.min(time - this.time, 80) * this.speed : 0;
    this.time = time;
    this.clock += delta;
    for (const armature of this.armatures.values()) armature.advanceTime(delta / 1000);
    // DragonBones dispatches queued frame events after updating the armatures.
    this.factory.dragonBones.advanceTime(0);
    this.draw();
    if (this.active && !this.paused && !this.reduced) this.frame = requestAnimationFrame(this.tick);
  }
  draw() {
    if (this.disposed) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.resize(width, height);
    const scale = Math.min(width / 450, height / 346, .98);
    for (const [side, armature] of this.armatures) {
      armature.display.scale.set(scale * (side === 'player' ? 1 : -1), scale);
      armature.display.position.set(width * (side === 'player' ? .25 : .75), height - 12);
      this.drawEffect(side, scale, width, height);
    }
    this.renderer.render(this.stage);
    this.canvas.dataset.clock = String(Math.round(this.clock));
  }
  drawEffect(side, scale, width, height) {
    const beat = this.actions.get(side);
    let effect = this.effects.get(side);
    if (effect && effect.action !== beat?.action) {
      effect.display.destroy();
      this.effects.delete(side);
      effect = null;
    }
    if (!beat || !['artifact', 'heal'].includes(beat.action)) return;
    if (!effect) {
      const image = this.images.get(beat.artifactSrc);
      const display = image ? new Sprite(Texture.from(image)) :
        new Graphics().rect(-3, -11, 6, 22).rect(-11, -3, 22, 6).fill(0x38644f);
      if (image) { display.anchor.set(.5); display.width = 48; display.height = 48; }
      effect = { action: beat.action, display };
      this.effects.set(side, effect);
      this.stage.addChild(display);
    }
    const progress = Math.min(1, (this.clock - beat.started) / durations[beat.action]);
    effect.display.alpha = Math.sin(progress * Math.PI);
    effect.display.position.set(width * (side === 'player' ? .40 : .60), height - 160 * scale - progress * 12);
  }
  snapshot() {
    return Object.fromEntries([...this.armatures].map(([side, armature]) => [
      side, {
        id: armature.armatureData.name,
        bones: Object.fromEntries(armature.getBones().map(item => [item.name, {
          x: item.globalTransformMatrix.tx, y: item.globalTransformMatrix.ty,
          a: item.globalTransformMatrix.a, b: item.globalTransformMatrix.b,
          c: item.globalTransformMatrix.c, d: item.globalTransformMatrix.d,
          length: item.boneData.length,
        }])),
        slots: Object.fromEntries(armature.getSlots().map(slot => {
          const display = slot.display, matrix = display.localTransform;
          return [slot.name, {
            a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, x: matrix.tx, y: matrix.ty,
            width: display.texture.frame.width, height: display.texture.frame.height,
          }];
        })),
        binding: bindings[armature.armatureData.name],
      },
    ]));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    delete this.canvas.getRigSnapshot;
    this.actions.clear();
    for (const armature of this.armatures.values()) armature.dispose();
    this.factory.clear();
    this.stage.destroy({ children: true });
    this.renderer.destroy();
  }
}
