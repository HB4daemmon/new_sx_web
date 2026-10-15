import { Container, Graphics } from 'pixi.js';
// Keep Pixi's generated internals compatible with the preview's strict CSP.
import 'pixi.js/unsafe-eval';
import { clips } from './frames-data.js';

const rageClip = clips.rage;
const impactAt = rageClip.impactAt;
const duration = rageClip.duration;
const impactWindow = 150;
const recoveryWindow = duration - impactAt;
const darkOutline = 0x17251f;
const palettes = Object.freeze({
  player: Object.freeze({ primary: 0x39e5d0, secondary: 0x52a98c, highlight: 0xc9fff0 }),
  enemy: Object.freeze({ primary: 0xef5949, secondary: 0xe9b34b, highlight: 0xffe7a0 }),
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

export function sampleRageEffect(elapsed, side) {
  const time = Math.max(0, finiteOr(elapsed, 0));
  const isEnemy = side === 'enemy';
  const progress = clamp(time / duration);
  const complete = time >= duration;
  const afterImpact = Math.max(0, time - impactAt);
  const charge = complete ? 0 : time < impactAt
    ? .2 + .8 * smoothstep(time / impactAt)
    : .8 * (1 - smoothstep(afterImpact / (impactWindow * 1.8)));
  const impact = complete || time < impactAt
    ? 0
    : 1 - smoothstep(afterImpact / impactWindow);
  const trail = complete ? 0 : time < impactAt
    ? 0
    : 1 - smoothstep(afterImpact / recoveryWindow);
  let phase = 'charge';
  if (complete) phase = 'complete';
  else if (time >= impactAt + impactWindow) {
    phase = time < impactAt + recoveryWindow * .56 ? 'follow' : 'recover';
  } else if (time >= impactAt) phase = 'impact';

  return {
    action: 'rage',
    side: isEnemy ? 'enemy' : 'player',
    phase,
    progress,
    duration,
    impactAt,
    complete,
    direction: isEnemy ? -1 : 1,
    motif: isEnemy ? 'chevron' : 'diamond',
    palette: isEnemy ? 'vermilion-gold' : 'jade-cyan',
    charge,
    impact,
    trail,
  };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function multiply(point, scalar) {
  return { x: point.x * scalar, y: point.y * scalar };
}

function interpolate(a, b, t) {
  return add(a, multiply(subtract(b, a), t));
}

function normalized(vector, fallback) {
  const length = Math.hypot(vector.x, vector.y);
  return length > .001
    ? { x: vector.x / length, y: vector.y / length }
    : fallback;
}

function toFlatPoints(points) {
  return points.flatMap(point => [point.x, point.y]);
}

function makePainter(graphics, width, height, unit) {
  const maxStroke = 18 * unit;
  const margin = 8 + maxStroke / 2 + 1;
  const safePoint = point => ({
    x: clamp(point.x, margin, width - margin),
    y: clamp(point.y, margin, height - margin),
  });

  return {
    line(points, color, lineWidth, alpha = 1) {
      if (alpha <= 0 || points.length < 2) return;
      const safePoints = toFlatPoints(points.map(safePoint));
      graphics.poly(safePoints, false)
        .stroke({ color: darkOutline, width: lineWidth + 2 * unit, alpha,
          cap: 'round', join: 'round' });
      graphics.poly(safePoints, false)
        .stroke({ color, width: lineWidth, alpha, cap: 'round', join: 'round' });
    },
    polygon(points, color, lineWidth, alpha = 1) {
      if (alpha <= 0 || points.length < 3) return;
      graphics.poly(toFlatPoints(points.map(safePoint)), true)
        .fill({ color, alpha })
        .stroke({ color: darkOutline, width: lineWidth, alpha, cap: 'round', join: 'round' });
    },
    glow(points, color, lineWidth, alpha) {
      if (alpha <= 0) return;
      graphics.poly(toFlatPoints(points.map(safePoint)), false)
        .stroke({ color, width: lineWidth, alpha, cap: 'round', join: 'round' });
    },
    safePoint,
  };
}

function arcPoints(center, along, across, radius, start, end, segments, safePoint) {
  const points = [];
  for (let index = 0; index <= segments; index++) {
    const angle = start + (end - start) * index / segments;
    const point = add(center, add(
      multiply(along, Math.cos(angle) * radius),
      multiply(across, Math.sin(angle) * radius),
    ));
    points.push(safePoint(point));
  }
  return points;
}

function drawCharge(painter, state, actor, along, across, unit, elapsed, colors) {
  if (state.charge <= 0) return;
  const { line, polygon, safePoint } = painter;
  const center = safePoint(add(actor, {
    x: along.x * 20 * unit,
    y: -28 * unit + along.y * 20 * unit,
  }));
  const phase = elapsed / duration;
  const pulse = .94 + .06 * Math.sin(phase * Math.PI * 6);
  const radius = 23 * unit * pulse;
  const alpha = .95 * state.charge;
  for (const [scale, offset, color, strength] of [
    [1, 0, colors.secondary, .58],
    [.68, .22, colors.primary, .82],
  ]) {
    const arcCenter = safePoint(add(center, multiply(across, offset * unit)));
    line(arcPoints(arcCenter, along, across, radius * scale,
      .58, Math.PI * 2 - .58, 18, safePoint),
    color, Math.max(.85, 2.2 * unit), alpha * strength);
  }

  const glyphCenter = safePoint(add(center, multiply(along, radius * .64)));
  if (state.motif === 'diamond') {
    const glyphSize = 4.6 * unit;
    for (const offset of [-.62, 0, .62]) {
      const point = safePoint(add(glyphCenter, multiply(across, offset * radius)));
      const diamond = [
        add(point, multiply(along, glyphSize)),
        add(point, multiply(across, glyphSize * .72)),
        add(point, multiply(along, -glyphSize)),
        add(point, multiply(across, -glyphSize * .72)),
      ];
      polygon(diamond, colors.highlight, Math.max(.8, 1.4 * unit), alpha * .9);
    }
  } else {
    const size = 5.2 * unit;
    for (const offset of [-.58, 0, .58]) {
      const point = safePoint(add(glyphCenter, multiply(across, offset * radius)));
      line([
        add(point, add(multiply(along, -size), multiply(across, -size * .72))),
        add(point, multiply(along, size)),
        add(point, add(multiply(along, -size), multiply(across, size * .72))),
      ], colors.highlight, Math.max(1, 2 * unit), alpha);
    }
  }
}

function drawSlash(painter, state, start, end, along, across, unit, colors) {
  if (state.trail <= 0) return;
  const { polygon, glow } = painter;
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (span < 5 * unit) return;

  const bend = Math.min(30 * unit, span * .18);
  const centerline = [];
  const upper = [];
  const lower = [];
  const steps = 12;
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    const base = interpolate(start, end, t);
    const curve = Math.sin(t * Math.PI) * bend;
    const point = add(base, multiply(across, curve));
    centerline.push(point);
    const halfWidth = (2.4 + 6 * Math.sin(t * Math.PI)) * unit;
    upper.push(add(point, multiply(across, halfWidth)));
    lower.push(add(point, multiply(across, -halfWidth)));
  }

  const alpha = .9 * state.trail;
  glow(centerline, colors.primary, 18 * unit, .12 * state.trail);
  glow(centerline, colors.primary, 10 * unit, .24 * state.trail);
  polygon([...upper, ...lower.reverse()], colors.primary, .8 * unit, alpha);
  glow(centerline, colors.highlight, 3.2 * unit,
    alpha * (.72 + .28 * state.impact));

  if (state.impact > 0) {
    const burstCenter = interpolate(start, end, .72);
    const sparkAngles = [-1.2, -.65, -.12, .42, .95, 1.43];
    for (let index = 0; index < sparkAngles.length; index++) {
      const angle = sparkAngles[index];
      const radial = add(multiply(along, Math.cos(angle)),
        multiply(across, Math.sin(angle)));
      const inner = add(burstCenter, multiply(radial, (5 + index % 2 * 2) * unit));
      const outer = add(burstCenter, multiply(radial, (12 + index % 3 * 3) * unit * state.impact));
      glow([inner, outer], colors.primary, 5 * unit, state.impact * .3);
      glow([inner, outer], index % 2 ? colors.highlight : colors.secondary,
        Math.max(1, 2.1 * unit), state.impact * .98);
    }
  }
}

export class RageEffect {
  constructor() {
    this.display = new Container();
    this.graphics = new Graphics();
    this.display.addChild(this.graphics);
    this.destroyed = false;
  }

  update({ side = 'player', elapsed = 0, x = 0, y = 0, targetX = x,
    targetY = y, scale = .6, width = 0, height = 0 } = {}) {
    const state = sampleRageEffect(elapsed, side);
    if (this.destroyed) return state;
    this.graphics.clear();
    if (state.complete ||
        !Number.isFinite(width) || !Number.isFinite(height) ||
        width <= 32 || height <= 32) return state;

    const safeX = finiteOr(x, width * .24);
    const safeY = finiteOr(y, height - 25);
    const safeTargetX = finiteOr(targetX, width * .76);
    const safeTargetY = finiteOr(targetY, height - 25);
    const unit = clamp(finiteOr(scale, .6), .3, 1.1);
    const actor = { x: safeX, y: safeY };
    const target = { x: safeTargetX, y: safeTargetY };
    const colors = palettes[state.side];
    const fallback = { x: state.direction, y: 0 };
    const along = normalized(subtract(target, actor), fallback);
    const across = { x: -along.y, y: along.x };
    const painter = makePainter(this.graphics, width, height, unit);

    drawCharge(painter, state, actor, along, across, unit,
      Math.max(0, finiteOr(elapsed, 0)), colors);

    if (state.trail > 0) {
      const centerY = -170 * unit;
      const from = add(actor, { x: along.x * 20 * unit, y: centerY + along.y * 20 * unit });
      const to = add(target, { x: -along.x * 27 * unit, y: centerY - along.y * 27 * unit });
      const gap = Math.hypot(to.x - from.x, to.y - from.y);
      const minSpan = 7 * unit;
      if (gap >= minSpan) {
        const inset = Math.max(0, (gap - Math.min(gap, 180 * unit)) / 2);
        const start = add(from, multiply(normalized(subtract(to, from), along), inset));
        const end = add(to, multiply(normalized(subtract(to, from), along), -inset));
        drawSlash(painter, state, start, end, along, across, unit, colors);
      }
    }

    return state;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.display.destroy({ children: true });
  }
}
