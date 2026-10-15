import {
  Container, Graphics, Rectangle, Sprite, Texture, autoDetectRenderer,
} from 'pixi.js';
// Pixi's no-eval polyfills retain the preview's strict CSP.
import 'pixi.js/unsafe-eval';
import { FrameTimeline, poseNames, sampleFrame } from './frames-data.js';

const frameSize = [400, 448];
const characterIds = ['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05', 'EN-A1-L1'];

async function rendererFor(canvas) {
  return autoDetectRenderer({
    canvas,
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
    resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
    autoDensity: false,
    backgroundAlpha: 0,
    antialias: true,
    preference: 'webgl',
    preserveDrawingBuffer: true,
  });
}

function decodedImage(images, src) {
  const image = images?.get(src);
  const width = image?.naturalWidth;
  const height = image?.naturalHeight;
  if (!image || image.complete === false || !(width > 0) || !(height > 0)) {
    throw new Error(`Frame image is not loaded: ${src}`);
  }
  return { image, width, height };
}

function validateManifest(manifest, images) {
  if (manifest?.schemaVersion !== 1 ||
      !Array.isArray(manifest.frameSize) ||
      manifest.frameSize[0] !== frameSize[0] ||
      manifest.frameSize[1] !== frameSize[1] ||
      !manifest.characters) {
    throw new Error('Invalid drawn-frame manifest');
  }

  const result = new Map();
  for (const id of characterIds) {
    const character = manifest.characters[id];
    if (!character || typeof character.src !== 'string' ||
        !Array.isArray(character.frames) || character.frames.length !== poseNames.length ||
        !Array.isArray(character.anchor) || character.anchor.length !== 2 ||
        !character.anchor.every(Number.isFinite) ||
        character.anchor[0] < 0 || character.anchor[0] > frameSize[0] ||
        character.anchor[1] < 0 || character.anchor[1] > frameSize[1]) {
      throw new Error(`Invalid drawn-frame character: ${id}`);
    }

    const { image, width, height } = decodedImage(images, character.src);
    const frames = character.frames.map((frame, index) => {
      if (!Array.isArray(frame) || frame.length !== 4 ||
          !frame.every(Number.isInteger) ||
          frame[0] < 0 || frame[1] < 0 ||
          frame[2] !== frameSize[0] || frame[3] !== frameSize[1] ||
          frame[0] + frame[2] > width || frame[1] + frame[3] > height) {
        throw new Error(`Invalid ${id} frame rectangle: ${index}`);
      }
      return frame;
    });

    result.set(id, {
      id,
      src: character.src,
      anchor: character.anchor,
      frames,
      image,
    });
  }
  return result;
}

function prepareCharacters(manifest, images) {
  const validated = validateManifest(manifest, images);
  const prepared = new Map();
  let partialTextures = [];
  try {
    for (const [id, character] of validated) {
      const source = Texture.from(character.image).source;
      partialTextures = [];
      for (const [index, [x, y, width, height]] of character.frames.entries()) {
        partialTextures.push(new Texture({
          source,
          frame: new Rectangle(x, y, width, height),
          label: `${id}/${poseNames[index]}`,
        }));
      }
      prepared.set(id, { ...character, textures: partialTextures });
      partialTextures = [];
    }
  } catch (error) {
    for (const texture of partialTextures) texture.destroy(false);
    destroyCharacterTextures(prepared);
    throw error;
  }
  return prepared;
}

function destroyCharacterTextures(characters) {
  for (const character of characters.values()) {
    for (const texture of character.textures || []) texture.destroy(false);
  }
}

function destroyDisplay(display) {
  if (display) display.destroy({ texture: false, textureSource: false });
}

function setAnchor(sprite, character) {
  sprite.anchor.set(
    character.anchor[0] / frameSize[0],
    character.anchor[1] / frameSize[1],
  );
}

function effectDisplay(images, src) {
  if (src) {
    try {
      const { image } = decodedImage(images, src);
      const sprite = new Sprite(Texture.from(image));
      sprite.anchor.set(.5);
      sprite.width = 48;
      sprite.height = 48;
      return sprite;
    } catch {
      // A missing optional item art uses the same visible cue as the older rig.
    }
  }
  return new Graphics().rect(-3, -11, 6, 22).rect(-11, -3, 22, 6).fill(0x38644f);
}

export class FrameStart {
  static async create(canvas, manifest, images) {
    const characters = prepareCharacters(manifest, images);
    let renderer;
    try {
      renderer = await rendererFor(canvas);
      return new FrameStart(canvas, characters, renderer);
    } catch (error) {
      renderer?.destroy();
      destroyCharacterTextures(characters);
      throw error;
    }
  }

  constructor(canvas, characters, renderer) {
    Object.assign(this, { canvas, characters, renderer });
    this.stage = new Container();
    this.method = null;
    this.disposed = false;
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
    canvas.dataset.engine = 'drawn-frames';
    this.configure('RKF01');
  }

  configure(method) {
    if (this.disposed) return;
    const character = this.characters.get(method);
    if (!character) throw new Error(`Unknown frame character: ${method}`);
    if (method !== this.method) {
      if (this.sprite) {
        this.stage.removeChild(this.sprite);
        destroyDisplay(this.sprite);
      }
      this.sprite = new Sprite(character.textures[0]);
      setAnchor(this.sprite, character);
      this.stage.addChild(this.sprite);
      this.method = method;
      this.canvas.dataset.skin = method;
      this.canvas.dataset.playerSkin = method;
    }
    this.draw();
  }

  draw() {
    if (this.disposed || !this.sprite) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(width / frameSize[0], height / frameSize[1], 1);
    this.renderer.resize(width, height);
    this.sprite.texture = this.characters.get(this.method).textures[0];
    this.sprite.scale.set(scale);
    this.sprite.position.set(width / 2, height - 6);
    this.renderer.render(this.stage);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.stage.destroy({ children: true });
    destroyCharacterTextures(this.characters);
    this.renderer.destroy();
  }
}

export class FrameBattle {
  static async create(canvas, manifest, images, onFailure) {
    const characters = prepareCharacters(manifest, images);
    let renderer;
    try {
      renderer = await rendererFor(canvas);
      return new FrameBattle(canvas, characters, renderer, images, onFailure);
    } catch (error) {
      renderer?.destroy();
      destroyCharacterTextures(characters);
      throw error;
    }
  }

  constructor(canvas, characters, renderer, images, onFailure) {
    Object.assign(this, { canvas, characters, renderer, images, onFailure });
    this.context = renderer;
    this.stage = new Container();
    this.actors = new Map();
    this.effects = new Map();
    this.method = 'RKF01';
    this.lastTimestamp = null;
    this.frameId = null;
    this.disposed = false;
    this.timeline = new FrameTimeline({
      onAction: (side, action) => {
        this.canvas.dataset[`${side}Action`] = action;
      },
    });
    this.actions = this.timeline.actions;
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
    canvas.dataset.engine = 'drawn-frames';
    canvas.getFrameSnapshot = () => this.snapshot();
    this.draw();
  }

  setCharacter(side, id) {
    const character = this.characters.get(id);
    if (!character) throw new Error(`Unknown frame character: ${id}`);
    const previous = this.actors.get(side);
    if (previous?.character.id === id) return;
    if (previous) {
      this.stage.removeChild(previous.sprite);
      destroyDisplay(previous.sprite);
    }

    this.timeline.actions.delete(side);
    this.canvas.dataset[`${side}Action`] = 'idle';
    const sprite = new Sprite(character.textures[0]);
    setAnchor(sprite, character);
    this.stage.addChild(sprite);
    this.actors.set(side, { character, sprite });
    this.canvas.dataset[`${side}Skin`] = id;
  }

  configure({ active = this.timeline.active, paused = this.timeline.paused,
    reduced = this.timeline.reduced, speed = this.timeline.speed,
    method = this.method } = {}) {
    if (this.disposed) return;
    const methodChanged = method !== this.method;
    this.timeline.configure({ active, paused, reduced, speed });
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.lastTimestamp = null;

    if (active && paused) {
      if (methodChanged) this.pendingMethod = method;
      return;
    }

    const nextMethod = this.pendingMethod || method;
    this.pendingMethod = null;
    if (nextMethod !== this.method) {
      this.method = nextMethod;
      this.setCharacter('player', nextMethod);
    }

    if (!active) {
      for (const side of this.actors.keys()) this.canvas.dataset[`${side}Action`] = 'idle';
      this.draw();
      return;
    }

    if (reduced) {
      for (const side of this.actors.keys()) {
        if (!this.timeline.actions.has(side)) this.canvas.dataset[`${side}Action`] = 'idle';
      }
      this.draw();
      return;
    }

    this.draw();
    this.frameId = requestAnimationFrame(this.tick);
  }

  play(side, action, onImpact = null, artifactSrc = null) {
    if (this.disposed) return;
    this.timeline.play(side, action, onImpact, artifactSrc);
    if (!this.timeline.paused) this.draw();
  }

  reset() {
    if (this.disposed) return;
    this.timeline.reset();
    for (const side of this.actors.keys()) this.canvas.dataset[`${side}Action`] = 'idle';
    this.draw();
  }

  tick(timestamp) {
    this.frameId = null;
    if (this.disposed || !this.timeline.active ||
        this.timeline.paused || this.timeline.reduced) return;
    const maxWallStep = this.timeline.speed > 0 ? 80 / this.timeline.speed : 80;
    const delta = this.lastTimestamp === null ? 0 :
      Math.min(Math.max(0, timestamp - this.lastTimestamp), maxWallStep);
    this.lastTimestamp = timestamp;
    this.timeline.advance(delta);
    this.draw();
    if (this.timeline.active && !this.timeline.paused && !this.timeline.reduced) {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  draw() {
    if (this.disposed || (this.timeline.active && this.timeline.paused)) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(width / 520, height / 448, 1);
    // Lowered weapon tips extend below the boot anchor in a few authored cels.
    const footRoom = Math.max(...[...this.characters.values()]
      .map(character => frameSize[1] - character.anchor[1]));
    const baseline = height - Math.max(12, (footRoom + 6) * scale);
    const stance = Math.min(width * .20, 126 * scale);
    this.renderer.resize(width, height);

    const snapshot = { engine: 'drawn-frames', clock: Math.round(this.timeline.clock) };
    for (const [side, actor] of this.actors) {
      const beat = this.timeline.actions.get(side);
      const action = beat?.action || 'idle';
      const elapsed = beat ? this.timeline.clock - beat.started :
        (this.timeline.reduced ? 0 : this.timeline.clock);
      const pose = sampleFrame(action, elapsed);
      const texture = actor.character.textures[pose.index];
      if (actor.sprite.texture !== texture) actor.sprite.texture = texture;
      const direction = side === 'player' ? 1 : -1;
      const outward = side === 'player' ? -1 : 1;
      const x = width / 2 + outward * stance +
        outward * pose.offsetX * scale;
      const y = baseline + pose.offsetY * scale;
      actor.sprite.scale.set(scale * direction * pose.scale, scale * pose.scale);
      actor.sprite.position.set(x, y);
      this.updateEffect(side, beat, pose, scale, width, height);
      this.canvas.dataset[`${side}Skin`] = actor.character.id;
      snapshot[side] = {
        id: actor.character.id,
        action,
        frame: pose.index,
        pose: pose.pose,
        elapsed: Math.max(0, elapsed),
        x,
        y,
      };
    }

    this.renderer.render(this.stage);
    this.canvas.dataset.clock = String(snapshot.clock);
    this.lastSnapshot = snapshot;
  }

  updateEffect(side, beat, pose, scale, width, height) {
    const enabled = beat && ['artifact', 'cast', 'heal'].includes(beat.action);
    let effect = this.effects.get(side);
    if (!enabled) {
      if (effect) {
        this.stage.removeChild(effect.display);
        destroyDisplay(effect.display);
        this.effects.delete(side);
      }
      return;
    }
    if (effect?.beat !== beat) {
      if (effect) {
        this.stage.removeChild(effect.display);
        destroyDisplay(effect.display);
      }
      effect = { beat, display: effectDisplay(this.images, beat.artifactSrc) };
      this.effects.set(side, effect);
      this.stage.addChild(effect.display);
    }
    effect.display.alpha = Math.sin(Math.min(1, pose.progress) * Math.PI);
    effect.display.position.set(
      width * (side === 'player' ? .40 : .60),
      height - 160 * scale - pose.progress * 12,
    );
  }

  snapshot() {
    if (!this.lastSnapshot) return { engine: 'drawn-frames', clock: 0 };
    return Object.fromEntries(Object.entries(this.lastSnapshot).map(([key, value]) => [
      key, value && typeof value === 'object' ? { ...value } : value,
    ]));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    delete this.canvas.getFrameSnapshot;
    this.timeline.reset();
    this.effects.clear();
    this.actors.clear();
    this.stage.destroy({ children: true });
    destroyCharacterTextures(this.characters);
    this.renderer.destroy();
  }
}
