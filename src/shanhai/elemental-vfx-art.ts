export type ElementalFxKind =
  | 'blade'
  | 'volley'
  | 'fire'
  | 'poison'
  | 'poison_fire'
  | 'thunder'
  | 'guard'
  | 'healing'
  | 'energy'
  | 'moon'
  | 'sun'
  | 'dragon'
  | 'fortune'
  | 'wheel';

export interface ElementalFxCue {
  kind: ElementalFxKind;
  owner: 'player' | 'enemy';
  target: 'player' | 'enemy';
  phase: 'cast' | 'travel' | 'impact';
  count?: number;
  intensity?: 'basic' | 'rage' | 'reaction';
}

const FX_KINDS: readonly ElementalFxKind[] = [
  'blade', 'volley', 'fire', 'poison', 'poison_fire', 'thunder',
  'guard', 'healing', 'energy', 'moon', 'sun', 'dragon',
  'fortune', 'wheel',
];
const SIDES = ['player', 'enemy'] as const;
const PHASES = ['cast', 'travel', 'impact'] as const;
const INTENSITIES = ['basic', 'rage', 'reaction'] as const;
const MAX_CUES = 3;
const MAX_VOLLEY_SWORDS = 5;
const MIN_DURATION_MS = 90;
const MAX_DURATION_MS = 480;

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function isCue(value: unknown): value is ElementalFxCue {
  if (typeof value !== 'object' || value === null) return false;
  const cue = value as Record<string, unknown>;
  return isOneOf(FX_KINDS, cue.kind)
    && isOneOf(SIDES, cue.owner)
    && isOneOf(SIDES, cue.target)
    && isOneOf(PHASES, cue.phase)
    && (cue.intensity === undefined || isOneOf(INTENSITIES, cue.intensity))
    && (cue.count === undefined || (typeof cue.count === 'number' && Number.isFinite(cue.count)));
}

export function elementalFxDuration(durationMs: number): number {
  const candidate = Number.isFinite(durationMs) ? durationMs : 260;
  return Math.round(Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, candidate)));
}

function projectileCount(cue: ElementalFxCue): number {
  const candidate = cue.count === undefined ? 1 : Math.trunc(cue.count);
  return Math.min(MAX_VOLLEY_SWORDS, Math.max(1, candidate));
}

function shotMarkup(index: number, count: number, kind: ElementalFxKind): string {
  // Separate sword paths enough to remain legible beside a simultaneous
  // elemental attack, while keeping larger volleys within the stage.
  const sword = kind === 'blade' || kind === 'volley';
  const spacing = sword ? (count === 2 ? 60 : count === 3 ? 40 : 30) : 28;
  const spread = Math.round((index - (count - 1) / 2) * spacing);
  const landingSpread = Math.round(spread * 0.75);
  return `<i class="elemental-fx__projectile" data-shot-index="${index + 1}" style="--shot-start-offset:${spread}px;--shot-end-offset:${landingSpread}px"><i class="elemental-fx__glyph"></i></i>`;
}

function phaseMarkup(cue: ElementalFxCue, count: number): string {
  if (cue.phase === 'cast') {
    return '<span class="elemental-fx__charge"><i class="elemental-fx__charge-ring"></i><i class="elemental-fx__glyph"></i></span>';
  }

  if (cue.phase === 'travel') {
    const projectiles = Array.from({ length: count }, (_, index) => shotMarkup(index, count, cue.kind)).join('');
    return `<span class="elemental-fx__flight"><i class="elemental-fx__wake"></i>${projectiles}</span><span class="elemental-fx__impact"><i class="elemental-fx__impact-ring"></i><i class="elemental-fx__impact-mark"><i class="elemental-fx__glyph"></i></i></span>`;
  }

  return '<span class="elemental-fx__impact"><i class="elemental-fx__impact-ring"></i><i class="elemental-fx__impact-mark"><i class="elemental-fx__glyph"></i></i></span>';
}

function cueMarkup(cue: ElementalFxCue, durationMs: number): string {
  const count = cue.phase === 'travel' ? projectileCount(cue) : 1;
  const intensity = cue.intensity ?? 'basic';
  const sourceX = cue.owner === 'player' ? '25%' : '75%';
  const targetX = cue.target === 'player' ? '25%' : '75%';
  const countAttribute = cue.phase === 'travel' ? ` data-count="${count}"` : '';
  const style = [
    `--fx-duration:${durationMs}ms`,
    `--fx-start-x:var(--${cue.owner}-head-x,${sourceX})`,
    `--fx-start-y:calc(var(--${cue.owner}-head-y,50%) + 24px)`,
    `--fx-end-x:var(--${cue.target}-head-x,${targetX})`,
    `--fx-end-y:calc(var(--${cue.target}-head-y,50%) + 28px)`,
    '--fx-delta-x:calc(var(--fx-end-x) - var(--fx-start-x))',
    '--fx-delta-y:calc(var(--fx-end-y) - var(--fx-start-y))',
  ].join(';');

  return `<div class="elemental-fx" data-fx-kind="${cue.kind}" data-owner="${cue.owner}" data-target="${cue.target}" data-phase="${cue.phase}" data-intensity="${intensity}"${countAttribute} style="${style}" aria-hidden="true">${phaseMarkup(cue, count)}</div>`;
}

/**
 * Builds short-lived, decorative combat marks from validated playback cues.
 * The returned markup never contains damage values or changes combat state.
 */
export function elementalFxMarkup(cues: readonly ElementalFxCue[], durationMs: number): string {
  if (!Array.isArray(cues)) return '';
  const duration = elementalFxDuration(durationMs);
  const safeCues: ElementalFxCue[] = [];
  for (const cue of cues as readonly unknown[]) {
    if (!isCue(cue)) continue;
    safeCues.push(cue);
    if (safeCues.length >= MAX_CUES) break;
  }
  return safeCues.map((cue) => cueMarkup(cue, duration)).join('');
}
