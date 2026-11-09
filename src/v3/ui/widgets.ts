import { MOD_DESC, MOD_NAME, MOD_SHORT, RELIC, SPECIALS, TALENT, TIER_NAME, type RelicDef } from '../core/content.js';
import { counterOf, EL_EFFECT, EL_NAME, GEN, KE, type El } from '../core/elements.js';
import { PATTERNS, PATTERN_ORDER, QI_PER_FAN, YAKU, YAKU_ORDER } from '../core/patterns.js';
import type { PatternId, RewardOption, RunState, Tile } from '../core/types.js';
import { fmt, h } from './h.js';

export const elLabel = (el: El | 'zhuo') => (el === 'zhuo' ? '浊' : EL_NAME[el]);

export function tileView(tile: Omit<Tile, 'uid'> & { uid?: number }, opts: { small?: boolean; onclick?: (e: Event) => void; order?: number; title?: string } = {}) {
  const sp = tile.sp ? SPECIALS[tile.sp] : null;
  const tip = tile.el === 'zhuo' ? '浊符：没有元素，0 点，凑不成任何役' : `${sp ? `本门符「${sp.name}」：${sp.desc}\n` : ''}${EL_NAME[tile.el]}${tile.v}　${EL_EFFECT[tile.el]}${tile.mod ? `\n${MOD_DESC[tile.mod]}` : ''}`;
  return h(`button.tile.el-${tile.el}${tile.mod ? `.mod-${tile.mod}` : ''}${sp ? `.sp.sp-${sp.id}` : ''}${opts.small ? '.small' : ''}`, {
    type: 'button', 'data-uid': tile.uid, title: opts.title ?? tip, onclick: opts.onclick, 'aria-label': tip,
  },
  h('span.tile-band'),
  h('span.tile-glyph', null, elLabel(tile.el)),
  h('span.tile-v', null, String(tile.v)),
  tile.mod ? h('span.tile-mod', null, MOD_NAME[tile.mod]) : null,
  sp ? h('span.tile-sp', null, sp.glyph) : null,
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
    case 'tile': return h('div.card-tile', null, tileView(option.tile), h('div.card-title', null, option.tile.sp ? `本门符 · ${SPECIALS[option.tile.sp].name}${option.tile.v}` : `新符 · ${option.tile.mod ? MOD_NAME[option.tile.mod] : ''}${elLabel(option.tile.el)}${option.tile.v}`),
      option.tile.sp ? h('div.card-desc', null, SPECIALS[option.tile.sp].desc) : null,
      h('div.card-desc', null, option.tile.el === 'zhuo' ? '' : EL_EFFECT[option.tile.el]), option.tile.mod ? h('div.card-desc.dim', null, MOD_SHORT[option.tile.mod]) : null);
    case 'pattern': {
      const lv = run.patternLv[option.pattern];
      return h('div.card-pattern', null, h('div.pattern-seal', null, PATTERNS[option.pattern].name),
        h('div.card-title', null, `心法 · ${PATTERNS[option.pattern].name}（${PATTERNS[option.pattern].alias}）${lv + 1}重`),
        h('div.card-desc', null, PATTERNS[option.pattern].short),
        h('div.card-desc.num', null, patternText(option.pattern, lv), ' → ', h('b', null, patternText(option.pattern, lv + 1))));
    }
    case 'talent': {
      const def = TALENT[option.talent];
      return h(`div.card-talent.t-${def.tier}`, null, h('div.talent-glyph', null, def.name.slice(0, 1)), h('div.card-title', null, def.name), h('div.card-rarity', null, `${TIER_NAME[def.tier]}品 · ${def.cat}`), h('div.card-desc', null, def.desc));
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
  const wrap = h('div.wheel', { html: svg, title: '五行相克：克制敌人元素的符点数 ×2，三张以上成「破阵」。' });
  order.forEach((el, i) => {
    wrap.appendChild(h(`span.wheel-node.el-${el}${el === counter ? '.counter' : ''}${el === weak ? '.weak' : ''}`, { style: { left: `${pos[i].x}%`, top: `${pos[i].y}%` } }, EL_NAME[el]));
  });
  if (enemyEl) wrap.appendChild(h('div.wheel-hint', null, h('b', { class: `el-text-${counter}` }, `${EL_NAME[counter!]}克${EL_NAME[enemyEl]}`), ' 气×2'));
  return wrap;
}

/** 役表（诀谱）：按路分组，每路只算最高的一个役；心法每重 +1 番。 */
export function patternTable(run: RunState | null, highlight?: PatternId) {
  const rows = PATTERN_ORDER.map(id => {
    const lv = run?.patternLv[id] ?? 1;
    const list = YAKU_ORDER.filter(y => YAKU[y].path === id);
    return h(`div.pattern-row${id === highlight ? '.hl' : ''}`, null,
      h('span.pr-name', null, PATTERNS[id].name, h('small', null, `（${PATTERNS[id].alias}）`), lv > 1 ? h('small.pr-lv', null, ` ${lv}重 +${lv - 1}番`) : null),
      h('span.pr-yaku', null, ...list.map(y => h('span.yk', { title: YAKU[y].desc }, h('b', null, YAKU[y].name), h('small', null, `${YAKU[y].alias} `), h('i', null, `${YAKU[y].fan}番`)))));
  });
  const tian = YAKU_ORDER.filter(y => YAKU[y].path === 'tian');
  // 本门役: only the current method's when in a run; every method's otherwise.
  const ben = YAKU_ORDER.filter(y => YAKU[y].path === 'ben' && (!run || YAKU[y].method === run.method));
  return h('div.pattern-table', null,
    h('p.pt-rule', null, `每一路只算最高的一个役，不同路的番相加，番数就是倍率。每番另带 ${QI_PER_FAN} 气。`),
    ...rows,
    h('div.pattern-row', null, h('span.pr-name', null, '得位', h('small', null, '（宝牌）')),
      h('span.pr-yaku', null, h('span.yk', null, '点数合河图数，每张 +1 番：', h('b', null, '水1/6 火2/7 木3/8 金4/9 土5/10')))),
    h('div.pattern-row.ben', null, h('span.pr-name', null, '本门', h('small', null, '（功法专属）')),
      h('span.pr-yaku', null, ...ben.map(y => h('span.yk', { title: YAKU[y].desc }, h('b', null, YAKU[y].name), h('small', null, `${YAKU[y].desc} `), h('i', null, `${YAKU[y].fan}番`))))),
    h('div.pattern-row.tian', null, h('span.pr-name', null, '天成', h('small', null, '（役满）')),
      h('span.pr-yaku', null, ...tian.map(y => h('span.yk', { title: YAKU[y].desc }, h('b', null, YAKU[y].name), h('small', null, `${YAKU[y].alias} `), h('i', null, `${YAKU[y].fan}番`))))));
}

/** What a 心法 level gives, in words. */
export function patternText(_id: PatternId, level: number): string {
  return level > 1 ? `成役时 +${level - 1} 番` : '未升重';
}

export const GEN_TEXT = `相生：${(['mu', 'huo', 'tu', 'jin', 'shui'] as El[]).map(e => EL_NAME[e]).join('→')}→${EL_NAME[GEN.shui]}`;
