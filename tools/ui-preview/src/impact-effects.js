import { Container, Graphics, Sprite } from 'pixi.js';
import 'pixi.js/unsafe-eval';
import { clips } from './frames-data.js';

const frameSize = [400, 448];
const palettes = Object.freeze({
  hit: Object.freeze({ outline: 0x503423, primary: 0xe5a83b, highlight: 0xfff3c4 }),
  guard: Object.freeze({ outline: 0x173b48, primary: 0x57c6ce, highlight: 0xc5ffff }),
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function sampleImpactEffect(action, elapsed = 0, reducedMotion = false) {
  if (action !== 'hit' && action !== 'guard') {
    throw new Error(`Unknown local impact effect: ${action}`);
  }
  const time = Math.max(0, finiteOr(elapsed, 0));
  const duration = clips[action].duration;
  const complete = time >= duration;
  const progress = clamp(time / duration);

  if (reducedMotion) {
    return { action, phase: 'reduced', progress, duration, complete, alpha: 0, flash: 0 };
  }

  if (action === 'hit') {
    const flash = complete ? 0 : 1 - smoothstep(time / 115);
    return {
      action,
      phase: complete ? 'complete' : time < 115 ? 'impact' : 'fade',
      progress,
      duration,
      complete,
      alpha: flash,
      flash,
    };
  }

  const guarding = !complete;
  const fade = time > duration - 70
    ? 1 - smoothstep((time - (duration - 70)) / 70)
    : 1;
  return {
    action,
    phase: complete ? 'complete' : 'guard',
    progress,
    duration,
    complete,
    alpha: guarding ? .9 * fade : 0,
    flash: 0,
  };
}

function setAnchor(sprite, character) {
  sprite.anchor.set(
    character.anchor[0] / frameSize[0],
    character.anchor[1] / frameSize[1],
  );
}

function drawLine(graphics, points, colors, unit, alpha) {
  if (alpha <= 0 || points.length < 2) return;
  const flat = points.flatMap(point => [point.x, point.y]);
  graphics.poly(flat, false)
    .stroke({ color: colors.outline, width: 5 * unit, alpha, cap: 'round', join: 'round' });
  graphics.poly(flat, false)
    .stroke({ color: colors.primary, width: 3 * unit, alpha, cap: 'round', join: 'round' });
  graphics.poly(flat, false)
    .stroke({ color: colors.highlight, width: Math.max(1, 1.2 * unit), alpha, cap: 'round', join: 'round' });
}

function drawHit(graphics, center, halfWidth, unit, direction, alpha) {
  const colors = palettes.hit;
  const span = halfWidth * .72;
  const slash = [
    { x: center.x - direction * span, y: center.y + 8 * unit },
    { x: center.x, y: center.y },
    { x: center.x + direction * span, y: center.y - 8 * unit },
  ];
  drawLine(graphics, slash, colors, unit, alpha);

  for (const [index, offset] of [-1, -.35, .4, 1].entries()) {
    const start = { x: center.x + offset * 4 * unit, y: center.y + (index % 2 ? -2 : 2) * unit };
    const end = {
      x: center.x + (offset * 4 + direction * (index % 2 ? 8 : -7)) * unit * alpha,
      y: center.y + (index % 2 ? -1 : 1) * (7 + index % 3 * 2) * unit * alpha,
    };
    drawLine(graphics, [start, end], colors, unit * .58, alpha);
  }
}

function drawGuard(graphics, center, size, direction, unit, alpha) {
  if (alpha <= 0) return;
  const colors = palettes.guard;
  const points = [
    { x: center.x - direction * size.width * .7, y: center.y - size.height * .82 },
    { x: center.x + direction * size.width * .2, y: center.y - size.height },
    { x: center.x + direction * size.width * .82, y: center.y - size.height * .52 },
    { x: center.x + direction * size.width, y: center.y },
    { x: center.x + direction * size.width * .82, y: center.y + size.height * .52 },
    { x: center.x + direction * size.width * .2, y: center.y + size.height },
    { x: center.x - direction * size.width * .7, y: center.y + size.height * .82 },
  ];
  const flat = points.flatMap(point => [point.x, point.y]);
  graphics.poly(flat, true).fill({ color: colors.primary, alpha: alpha * .16 });
  graphics.poly(flat, true).stroke({
    color: colors.outline, width: 4 * unit, alpha, cap: 'round', join: 'round',
  });
  graphics.poly(flat, true).stroke({
    color: colors.primary, width: 2 * unit, alpha, cap: 'round', join: 'round',
  });
  const inside = points.slice(1, 6);
  const innerFlat = inside.flatMap(point => [point.x, point.y]);
  graphics.poly(innerFlat, false).stroke({
    color: colors.highlight, width: Math.max(1, 1.2 * unit),
    alpha: alpha * .9, cap: 'round', join: 'round',
  });
}

export class ImpactEffect {
  constructor(character) {
    this.display = new Container();
    this.flashSprite = new Sprite(character.textures[0]);
    this.flashSprite.blendMode = 'add';
    setAnchor(this.flashSprite, character);
    this.graphics = new Graphics();
    this.display.addChild(this.flashSprite, this.graphics);
    this.destroyed = false;
  }

  update({ action, elapsed = 0, character, sprite, bounds, scale = .6,
    direction = 1, reducedMotion = false } = {}) {
    const state = sampleImpactEffect(action, elapsed, reducedMotion);
    if (this.destroyed) return state;

    this.graphics.clear();
    this.flashSprite.texture = sprite.texture;
    setAnchor(this.flashSprite, character);
    this.flashSprite.position.copyFrom(sprite.position);
    this.flashSprite.scale.copyFrom(sprite.scale);
    this.flashSprite.tint = action === 'hit' ? 0xfff1cf : 0xffffff;
    this.flashSprite.alpha = state.flash * .58;
    if (state.phase === 'reduced' || state.complete || !bounds ||
        bounds.width <= 0 || bounds.height <= 0) {
      this.flashSprite.alpha = 0;
      return state;
    }

    const unit = clamp(finiteOr(scale, .6) * 1.6, .65, 1.3);
    const center = {
      x: bounds.x + bounds.width * .5 + direction * bounds.width * .12,
      y: bounds.y + bounds.height * .56,
    };
    if (action === 'hit') {
      drawHit(this.graphics, center, Math.max(15 * unit, bounds.width * .22),
        unit, direction, state.alpha);
    } else if (state.phase === 'guard') {
      drawGuard(this.graphics, center,
        { width: 16 * unit, height: 24 * unit }, direction, unit, state.alpha);
    }
    return state;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.display.destroy({ children: true, texture: false, textureSource: false });
  }
}
