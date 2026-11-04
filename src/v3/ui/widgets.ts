import { MOD_DESC, MOD_NAME, RELIC, TALENT, type RelicDef } from '../core/content.js';
import { counterOf, EL_EFFECT, EL_NAME, GEN, KE, type El } from '../core/elements.js';
import { PATTERNS, PATTERN_ORDER, patternValue } from '../core/patterns.js';
import type { PatternId, RewardOption, RunState, Tile } from '../core/types.js';
import { fmt, h } from './h.js';

export const elLabel = (el: El | 'zhuo') => (el === 'zhuo' ? '浊' : EL_NAME[el]);

export function tileView(tile: Omit<Tile, 'uid'> & { uid?: number }, opts: { small?: boolean; onclick?: (e: Event) => void; order?: number; title?: string } = {}) {
  const tip = tile.el === 'zhuo' ? '浊符：没有元素，0 点，会打断相生链' : `${EL_NAME[tile.el]}${tile.v}　${EL_EFFECT[tile.el]}${tile.mod ? `\n${MOD_DESC[tile.mod]}` : ''}`;
  return h(`button.tile.el-${tile.el}${tile.mod ? `.mod-${tile.mod}` : ''}${opts.small ? '.small' : ''}`, {
    type: 'button', 'data-uid': tile.uid, title: opts.title ?? tip, onclick: opts.onclick, 'aria-label': tip,
  },
  h('span.tile-band'),
  h('span.tile-glyph', null, elLabel(tile.el)),
  h('span.tile-v', null, String(tile.v)),
  tile.mod ? h('span.tile-mod', null, MOD_NAME[tile.mod]) : null,
  opts.order ? h('span.tile-order', null, String(opts.order)) : null);
}

export function relicView(id: string, opts: { slot?: number; onclick?: (e: Event) => void; draggable?: boolean; small?: boolean } = {}) {
  const def = RELIC[id];
  if (!def) return h('div.relic.empty');
  return h(`div.relic.r-${def.rarity}${opts.small ? '.small' : ''}`, {
    'data-relic': id, 'data-slot': opts.slot, tabindex: 0, title: `${def.name}：${def.desc}`, onclick: opts.onclick,
  }, h('span.relic-glyph', null, def.glyph), h('span.relic-name', null, def.name));
}

export function relicCard(def: RelicDef) {
  return h(`div.card-relic.r-${def.rarity}`, null,
    h('div.relic.big', null, h('span.relic-glyph', null, def.glyph)),
    h('div.card-title', null, def.name),
    h('div.card-rarity', null, { common: '凡品', rare: '灵品', legend: '仙品' }[def.rarity]),
    h('div.card-desc', null, def.desc));
}

export function optionCard(run: RunState, option: RewardOption) {
  switch (option.type) {
    case 'relic': return relicCard(RELIC[option.relic]);
    case 'tile': return h('div.card-tile', null, tileView(option.tile), h('div.card-title', null, `新符 · ${option.tile.mod ? MOD_NAME[option.tile.mod] : ''}${elLabel(option.tile.el)}${option.tile.v}`),
      h('div.card-desc', null, option.tile.el === 'zhuo' ? '' : EL_EFFECT[option.tile.el]), option.tile.mod ? h('div.card-desc.dim', null, MOD_DESC[option.tile.mod]) : null);
    case 'pattern': {
      const lv = run.patternLv[option.pattern];
      const now = patternValue(option.pattern, lv);
      const next = patternValue(option.pattern, lv + 1);
      return h('div.card-pattern', null, h('div.pattern-seal', null, PATTERNS[option.pattern].name),
        h('div.card-title', null, `心法 · ${PATTERNS[option.pattern].name} ${lv + 1}重`),
        h('div.card-desc', null, PATTERNS[option.pattern].hint),
        h('div.card-desc.num', null, `${now.qi} 气 × ${now.mult} 倍 → `, h('b', null, `${next.qi} × ${next.mult}`)));
    }
    case 'talent': {
      const def = TALENT[option.talent];
      return h('div.card-talent', null, h('div.talent-glyph', null, def.name.slice(0, 1)), h('div.card-title', null, def.name), h('div.card-desc', null, def.desc));
    }
    case 'heal': return h('div.card-heal', null, h('div.talent-glyph', null, '丹'), h('div.card-title', null, '回春丹'), h('div.card-desc', null, `回复 ${option.amount} 气血`));
    case 'gold': return h('div.card-heal', null, h('div.card-title', null, `${option.amount} 灵石`));
  }
}

export function bar(cls: string, value: number, max: number, label?: string, extra?: HTMLElement | null) {
  const pct = Math.max(0, Math.min(100, (100 * value) / Math.max(1, max)));
  return h(`div.bar.${cls}`, { style: { '--pct': `${pct}%`, '--ghost': `${pct}%` } as never },
    h('div.bar-ghost'), h('div.bar-fill'), h('div.bar-text', null, label ?? `${fmt(Math.max(0, value))} / ${fmt(max)}`), extra ?? null);
}

/** The 五行 wheel: the generating cycle, with the enemy's counter highlighted. */
export function wuxingWheel(enemyEl?: El) {
  const order: El[] = ['mu', 'huo', 'tu', 'jin', 'shui'];
  const pos = order.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return { x: 50 + 36 * Math.cos(a), y: 50 + 36 * Math.sin(a) };
  });
  const counter = enemyEl ? counterOf(enemyEl) : null;
  const weak = enemyEl ? KE[enemyEl] : null;
  const svg = `<svg viewBox="0 0 100 100" class="wheel-svg" aria-hidden="true">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="rgba(240,228,207,.7)"/></marker></defs>
    ${order.map((el, i) => { const a = pos[i], b = pos[(i + 1) % 5]; const mx = a.x + (b.x - a.x) * 0.24, my = a.y + (b.y - a.y) * 0.24, nx = a.x + (b.x - a.x) * 0.76, ny = a.y + (b.y - a.y) * 0.76; void el; return `<line x1="${mx}" y1="${my}" x2="${nx}" y2="${ny}" stroke="rgba(240,228,207,.55)" stroke-width="1.6" marker-end="url(#arr)"/>`; }).join('')}
  </svg>`;
  const wrap = h('div.wheel', { html: svg, title: '五行相生：木→火→土→金→水→木。按此顺序连出即成相生诀。' });
  order.forEach((el, i) => {
    wrap.appendChild(h(`span.wheel-node.el-${el}${el === counter ? '.counter' : ''}${el === weak ? '.weak' : ''}`, { style: { left: `${pos[i].x}%`, top: `${pos[i].y}%` } }, EL_NAME[el]));
  });
  if (enemyEl) wrap.appendChild(h('div.wheel-hint', null, h('b', { class: `el-text-${counter}` }, `${EL_NAME[counter!]}克${EL_NAME[enemyEl]}`), ' 气×2'));
  return wrap;
}

export function patternTable(run: RunState | null, highlight?: PatternId) {
  return h('div.pattern-table', null, ...[...PATTERN_ORDER].reverse().map(id => {
    const lv = run?.patternLv[id] ?? 1;
    const v = patternValue(id, lv);
    return h(`div.pattern-row${id === highlight ? '.hl' : ''}`, null,
      h('span.pr-name', null, PATTERNS[id].name, lv > 1 ? h('small', null, ` ${lv}重`) : null),
      h('span.pr-hint', null, PATTERNS[id].hint),
      h('span.pr-val', null, h('b.qi', null, String(v.qi)), ' × ', h('b.mu', null, String(v.mult))));
  }));
}

export const GEN_TEXT = `相生：${(['mu', 'huo', 'tu', 'jin', 'shui'] as El[]).map(e => EL_NAME[e]).join('→')}→${EL_NAME[GEN.shui]}`;
