import { METHOD, METHODS, MOD_NAME, REALMS, RELIC, TALENT, VOW } from '../core/content.js';
import { EL_NAME } from '../core/elements.js';
import { ACTS, ENEMY } from '../core/enemies.js';
import { EVENT } from '../core/events.js';
import { PATTERNS } from '../core/patterns.js';
import * as R from '../core/run.js';
import type { MapNode, RewardOption, RunState, Screen } from '../core/types.js';
import { ACT_STORY, BOND, BONDS, ENDING, ENDINGS, LORE } from '../core/story.js';
import { burst, EL_COLOR, ring, shake, flash } from './fx.js';
import { fmt, h } from './h.js';
import { app, act, closeOverlays, go, portrait, render, save, showOverlay, stageSize, toast } from './main.js';
import { recordRunEnd } from './meta.js';
import { playSfx, setSfxEnabled } from './sfx.js';
import { setSpeed } from './fx.js';
import { bar, elLabel, optionCard, patternTable, relicView, tileView, wuxingWheel, GEN_TEXT } from './widgets.js';

export const art = (id: string) => `./assets/v3/${id}.webp`;

export function renderScreen(): HTMLElement {
  if (app.view === 'title' || (app.view === 'run' && !app.run)) return titleScreen();
  if (app.view === 'select') return selectScreen();
  const run = app.run!;
  const s = run.screen;
  switch (s.name) {
    case 'map': return withHud(run, mapScreen(run));
    case 'reward': return withHud(run, rewardScreen(run, s));
    case 'breakthrough': return breakthroughScreen(run, s);
    case 'shop': return withHud(run, shopScreen(run, s));
    case 'event': return withHud(run, eventScreen(run, s));
    case 'rest': return withHud(run, restScreen(run, s));
    case 'pick-tile': return withHud(run, pickTileScreen(run, s));
    case 'won': case 'lost': return endScreen(run);
    case 'story': return storyScreen(run, s.act);
    case 'ending': return endingChoiceScreen(run);
    default: return h('div');
  }
}

// —— Title ——
function titleScreen() {
  const saved = app.run && !['won', 'lost'].includes(app.run.screen.name) ? app.run : null;
  return h('div.scr.title-scr', null,
    h('img.bg', { src: art('bg-title'), alt: '' }),
    h('div.title-vignette'),
    h('div.title-logo', null, h('div.logo-main', null, '山海劫'), h('div.logo-sub', null, '五 行 剑 诀')),
    h('div.title-menu', null,
      saved ? h('button.btn.seal.big', { type: 'button', onclick: () => { app.view = 'run'; playSfx('click'); render(); } },
        '续 行', h('small', null, `${METHOD[saved.method].name} · ${ACTS[saved.act - 1].name}`)) : null,
      h('button.btn.seal.big' + (saved ? '.ghost' : ''), { type: 'button', 'data-action': 'new-run', onclick: () => { playSfx('click'); go('select'); } }, saved ? '另起一局' : '入 山 海'),
      h('button.btn.ink', { type: 'button', onclick: () => showHelp() }, '诀谱 · 怎么玩'),
      h('button.btn.ink', { type: 'button', 'data-action': 'codex', onclick: () => showCodex() }, '山海图鉴 · 结局'),
      app.meta.runs ? h('div.title-records', null,
        `已入山海 ${app.meta.runs} 次 · 渡劫 ${app.meta.wins} 次`, h('br'),
        app.meta.bestHit ? `最强一招 ${fmt(app.meta.bestHit)}（${METHOD[app.meta.bestHitMethod ?? '']?.name ?? ''}）` : '') : null),
    settingsButton());
}

// —— Method select ——
let pickedMethod = 'yangjian';
let pickedHeat = 0;
function selectScreen() {
  const meta = app.meta;
  const locked = (id: string) => !!METHOD[id].locked && !meta.unlocked.includes(id);
  if (locked(pickedMethod)) pickedMethod = 'yangjian';
  pickedHeat = Math.min(pickedHeat, meta.maxHeat);
  const m = METHOD[pickedMethod];
  const cards = METHODS.map(def => h(`button.method-card.el-${def.el}${def.id === pickedMethod ? '.on' : ''}${locked(def.id) ? '.locked' : ''}`, {
    type: 'button', 'data-method': def.id, disabled: locked(def.id) || undefined,
    onclick: () => { pickedMethod = def.id; playSfx('select'); render(); },
  }, h('img', { src: art(`hero-${def.id}`), alt: '' }), h('span.mc-name', null, def.name), h('span.mc-title', null, locked(def.id) ? '未解锁' : def.title)));
  return h('div.scr.select-scr', null,
    h('img.bg.dim', { src: art('bg-act1'), alt: '' }),
    h('div.select-head', null, h('button.btn.ink.small', { type: 'button', onclick: () => go('title') }, '← 返回'), h('h1.brush', null, '择 功 法')),
    h('div.method-grid', null, ...cards),
    h('div.method-detail', null,
      h('img.md-art', { src: art(`hero-${m.id}`), alt: m.name }),
      h('div.md-body', null,
        h('div.md-name', null, m.name, h('span', null, ` · ${m.title}`)),
        h('div.md-blurb', null, m.blurb),
        h('ul.md-passive', null, ...m.passive.map(p => h('li', null, p))),
        h('div.md-stats', null, `气血 ${m.hp} · 起手多带 `, ...m.extra.map(t => h('span.mini-tile', { class: `el-${t.el}` }, `${t.mod ? MOD_NAME[t.mod] : ''}${elLabel(t.el)}${t.v}`))),
        meta.maxHeat > 0 ? h('div.heat-row', null, h('span', null, '劫数'),
          ...Array.from({ length: meta.maxHeat + 1 }, (_, i) => h(`button.heat-pip${i === pickedHeat ? '.on' : ''}`, { type: 'button', title: i ? `劫数 ${i}：敌方气血 +${i * 15}%、伤害 +${i * 8}%` : '无劫', onclick: () => { pickedHeat = i; render(); } }, String(i)))) : null,
        h('button.btn.seal.big.go', { type: 'button', 'data-action': 'start', onclick: () => startRun() }, '起 程'))));
}

function startRun() {
  app.run = R.createRun({ method: pickedMethod, heat: pickedHeat });
  app.view = 'run';
  playSfx('breakthrough');
  save();
  render();
  if (!app.meta.tutorialDone) setTimeout(() => showHelp(true), 300);
}

// —— HUD ——
function withHud(run: RunState, body: HTMLElement) {
  return h('div.scr.run-scr', null,
    h('img.bg.dim', { src: art(ACTS[run.act - 1].bg), alt: '' }),
    body,
    hud(run));
}

export function hud(run: RunState, opts: { battle?: boolean } = {}) {
  const hp = opts.battle && run.battle ? run.battle.player.hp : run.hp;
  return h('div.hud', null,
    h('div.hud-who', null,
      h('img.hud-face', { src: art(`hero-${run.method}`), alt: '' }),
      h('div.hud-id', null, h('b', null, METHOD[run.method].name), h('span.realm', null, REALMS[run.realm])),
      opts.battle ? null : bar('hp', hp, run.maxHp)),
    h('div.hud-mid', null, relicRow(run)),
    h('div.hud-right', null,
      bondChips(run),
      h('span.gold', { title: '灵石' }, h('i', null, '◆'), fmt(run.gold)),
      h('span.act-tag', null, `${ACTS[run.act - 1].name}`),
      h('button.icon-btn', { type: 'button', title: '符袋', 'data-action': 'bag', onclick: () => showBag(run) }, '袋', h('small', null, String(run.bag.length))),
      h('button.icon-btn', { type: 'button', title: '诀谱', onclick: () => showHelp() }, '谱'),
      settingsButton()));
}

/** Relic row; drag (mouse or touch) to reorder — relics fire left to right. */
export function relicRow(run: RunState) {
  const row = h('div.relic-row', { 'data-slots': run.relicSlots });
  for (let i = 0; i < run.relicSlots; i += 1) {
    const id = run.relics[i];
    const el = id ? relicView(id, { slot: i }) : h('div.relic.empty', { 'data-slot': i, title: '空法宝位' });
    if (id) attachDrag(run, row, el, i);
    row.appendChild(el);
  }
  row.appendChild(h('span.relic-hint', null, '法宝自左向右触发 · 可拖动'));
  return row;
}

function attachDrag(run: RunState, row: HTMLElement, el: HTMLElement, index: number) {
  el.addEventListener('pointerdown', (down: PointerEvent) => {
    if (down.button !== 0) return;
    const startX = down.clientX;
    const startY = down.clientY;
    let dragging = false;
    const slots = () => [...row.querySelectorAll<HTMLElement>('.relic')].slice(0, run.relics.length);
    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < 8) return;
      dragging = true;
      el.classList.add('dragging');
      const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--stage-scale')) || 1;
      el.style.transform = `translate(${dx / scale}px, ${dy / scale}px) scale(1.12)`;
      slots().forEach(s => s.classList.toggle('drop-target', s !== el && hitX(s, e.clientX)));
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!dragging) { showRelicTip(run.relics[index]); return; }
      const target = slots().findIndex(s => s !== el && hitX(s, e.clientX));
      el.classList.remove('dragging');
      el.style.transform = '';
      if (target >= 0) { R.moveRelic(run, index, target); playSfx('select'); save(); refreshRelicRows(run); }
      else slots().forEach(s => s.classList.remove('drop-target'));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
const hitX = (el: HTMLElement, x: number) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right; };

export function refreshRelicRows(run: RunState) {
  for (const row of document.querySelectorAll('.relic-row')) row.replaceWith(relicRow(run));
}

function showRelicTip(id: string | undefined) {
  if (!id) return;
  const def = RELIC[id];
  showOverlay(h('div.tip-card', null, relicView(id), h('h3', null, def.name), h('p', null, def.desc), h('p.dim', null, '法宝按从左到右的顺序触发：先加倍率、再乘倍率，收益最大。')));
}

function settingsButton() {
  return h('button.icon-btn.settings', { type: 'button', title: '设置', 'aria-label': '设置', onclick: () => showSettings() }, '⚙');
}

function showSettings() {
  const meta = app.meta;
  const close = showOverlay(h('div.settings-panel', null, h('h2.brush', null, '设 置'),
    h('label.set-row', null, h('span', null, '音效'), h('button.toggle' + (meta.sound ? '.on' : ''), { type: 'button', 'data-action': 'toggle-sound', onclick: () => { meta.sound = !meta.sound; setSfxEnabled(meta.sound); save(); close(); showSettings(); } }, meta.sound ? '开' : '关')),
    h('label.set-row', null, h('span', null, '演出速度'), h('button.toggle.on', { type: 'button', onclick: () => { meta.speed = meta.speed === 1 ? 2 : 1; setSpeed(meta.speed); save(); close(); showSettings(); } }, `${meta.speed}×`)),
    h('p.dim', null, '战斗演出中点击任意处可快进。系统开启“减少动态效果”时自动关闭震屏与闪光。'),
    app.run && app.view === 'run' ? h('button.btn.ink', { type: 'button', onclick: () => { closeOverlays(); go('title'); } }, '回到标题（进度已自动保存）') : null,
    app.run && app.view === 'run' ? h('button.btn.ink.danger', { type: 'button', onclick: () => { if (confirm('放弃本局？此局进度将清除。')) { abandon(); closeOverlays(); } } }, '放弃本局') : null));
}

function abandon() {
  const run = app.run!;
  run.screen = { name: 'lost' };
  finishRun(run);
  render();
}

export function showBag(run: RunState) {
  const groups = (['jin', 'mu', 'shui', 'huo', 'tu', 'zhuo'] as const).map(el => {
    const tiles = run.bag.filter(t => t.el === el).sort((a, b) => a.v - b.v);
    return tiles.length ? h('div.bag-group', null, h('span.bag-el', { class: `el-text-${el}` }, `${elLabel(el)} ${tiles.length}`), h('div.bag-tiles', null, ...tiles.map(t => tileView(t, { small: true })))) : null;
  });
  showOverlay(h('div.bag', null, h('h2.brush', null, `符 袋 · ${run.bag.length}`), ...groups));
}

export function showHelp(first = false) {
  const close = showOverlay(h('div.help', null,
    h('h2.brush', null, '诀 谱'),
    h('div.help-cols', null,
      h('div.help-col', null,
        h('ol.help-steps', null,
          h('li', null, h('b', null, '选符：'), '从手中点选 1–5 枚符，', h('em', null, '点选的顺序就是出招顺序'), '。'),
          h('li', null, h('b', null, '成诀：'), '同元素凑成双元、三才、四象……；按 ', h('em', null, '木→火→土→金→水'), ' 的相生顺序连出则成「三生」「四生」，五枚一周即「五行轮转」。'),
          h('li', null, h('b', null, '伤害 = 气 × 倍'), '：诀式给基础气与倍率，每枚符加上它的点数，法宝自左向右再加、再乘。'),
          h('li', null, h('b', null, '克制：'), '用克制敌人元素的符，点数翻倍；被敌人克制的符减半。'),
          h('li', null, h('b', null, '剑意：'), '出招积攒剑意，满了可开「怒技」，本招 ×3。'),
          h('li', null, h('b', null, '天劫：'), '战斗拖到第 8 回合，天雷会劈向双方，越劈越狠。'),
        ),
        h('div.help-els', null, ...(['jin', 'mu', 'shui', 'huo', 'tu'] as const).map(el => h('div.help-el', null, tileView({ el, v: 5 }, { small: true }), h('span', null, { jin: '锐：暴击率 +12%', mu: '生：回复气血', shui: '护：获得护盾', huo: '焚：施加灼烧', tu: '镇：倍率 +0.5' }[el]))))),
      h('div.help-col', null, wuxingWheel(), patternTable(app.run))),
    first ? h('button.btn.seal', { type: 'button', onclick: () => { app.meta.tutorialDone = true; save(); close(); } }, '明白了，出发') : null), { onClose: () => { app.meta.tutorialDone = true; save(); } });
}

// —— Map ——
const NODE_GLYPH: Record<string, string> = { fight: '斗', elite: '煞', event: '奇', shop: '市', rest: '憩', boss: '首' };
const NODE_NAME: Record<string, string> = { fight: '斗法', elite: '精英', event: '奇遇', shop: '坊市', rest: '洞府', boss: '首领' };

function nodePos(node: MapNode, run: RunState) {
  const rows = run.act === 5 ? 2 : 6;
  const { w, h: H } = stageSize;
  if (portrait) {
    const top = 440, bottom = H - 120;
    const step = (bottom - top) / (rows - 1);
    return { x: 140 + node.col * 220, y: bottom - node.row * step };
  }
  const left = 150, right = w - 170;
  const step = (right - left) / (rows - 1);
  return { x: left + node.row * step, y: 230 + node.col * 170 };
}

function mapScreen(run: RunState) {
  const reach = new Set(R.reachable(run).map(n => n.id));
  const visited = new Set(run.visited);
  const size = { ...stageSize };
  const lines = run.map.flatMap(node => node.next.map(id => {
    const a = nodePos(node, run), b = nodePos(R.nodeById(run, id)!, run);
    const walked = visited.has(node.id) && visited.has(id);
    const live = node.id === run.at && reach.has(id);
    return `<path d="M${a.x} ${a.y} Q ${(a.x + b.x) / 2 + (a.y - b.y) * 0.08} ${(a.y + b.y) / 2} ${b.x} ${b.y}" class="map-line${walked ? ' walked' : ''}${live ? ' live' : ''}"/>`;
  })).join('');
  const nodes = run.map.map(node => {
    const p = nodePos(node, run);
    const enemy = node.enemy ? ENEMY[node.enemy] : null;
    const isReach = reach.has(node.id);
    const bondEvent = node.event?.startsWith('bond-') ? EVENT[node.event] : null;
    const btn = h(`button.map-node.k-${node.kind}${bondEvent ? '.k-bond' : ''}${isReach ? '.reach' : ''}${visited.has(node.id) ? '.done' : ''}${node.id === run.at ? '.here' : ''}`, {
      type: 'button', 'data-node': node.id, 'data-kind': node.kind, disabled: !isReach || undefined,
      style: { left: `${p.x}px`, top: `${p.y}px` },
      title: bondEvent ? `因缘 · ${BOND[bondEvent.bond!].name}` : `${NODE_NAME[node.kind]}${enemy ? ` · ${enemy.name}（${EL_NAME[enemy.el]}）` : ''}`,
      onclick: () => act(r => R.enterNode(r, node.id), node.kind === 'boss' ? 'stamp' : 'click'),
    },
    node.kind === 'boss' && enemy ? h('img.node-art', { src: art(enemy.art), alt: '' }) : null,
    h('span.node-glyph', null, node.event?.startsWith('bond-') ? '缘' : NODE_GLYPH[node.kind]),
    enemy && node.kind !== 'boss' ? h('span.node-el', { class: `el-${enemy.el}` }, EL_NAME[enemy.el]) : null,
    node.kind === 'boss' && enemy ? h('span.node-label', null, enemy.name) : null,
    bondEvent ? h('span.node-label.bond-label', null, BOND[bondEvent.bond!].name) : null);
    return btn;
  });
  const a = ACTS[run.act - 1];
  return h('div.map', null,
    h('div.map-title', null, h('span.act-no', null, run.act === 5 ? '终幕' : `第${'一二三四'[run.act - 1]}幕`), h('span.brush', null, a.name), h('small', null, ACT_STORY[run.act]?.goal ?? a.sub)),
    h('div.map-lines', { html: `<svg viewBox="0 0 ${size.w} ${size.h}" width="100%" height="100%">${lines}</svg>` }),
    ...nodes,
    h('div.map-legend', null, ...Object.keys(NODE_GLYPH).map(k => h('span', null, h('i', { class: `k-${k}` }, NODE_GLYPH[k]), NODE_NAME[k])),
      run.relics.length > 1 ? h('span.legend-tip', null, '法宝自左向右触发 · 拖动可换位：先加倍率、再乘倍率') : null));
}

// —— Reward ——
function rewardScreen(run: RunState, s: Extract<Screen, { name: 'reward' }>) {
  const pickMain = (i: number) => act(r => R.takeReward(r, 'main', i), 'reward');
  const pickRelic = (i: number) => {
    if (run.relics.length >= run.relicSlots) return chooseReplace(run, s.relicOptions[i], slot => act(r => R.takeReward(r, 'relic', i, slot), 'reward'));
    act(r => R.takeReward(r, 'relic', i), 'reward');
  };
  return h('div.panel-scr.reward', null,
    h('h1.brush.big-title', null, '斩 获'),
    s.story ? h('p.story-quote', null, s.story) : null,
    s.gold ? h('div.reward-gold', null, h('i', null, '◆'), ` +${s.gold} 灵石`) : null,
    s.relicOptions.length ? h('div.reward-block', null, h('h3', null, s.relicPicked ? '法宝已取' : '择一件法宝'),
      h('div.cards', null, ...s.relicOptions.map((o, i) => cardButton(run, o, () => pickRelic(i), s.relicPicked)))) : null,
    s.options.length ? h('div.reward-block', null, h('h3', null, s.picked ? '已取' : '择其一'),
      h('div.cards', null, ...s.options.map((o, i) => cardButton(run, o, () => pickMain(i), s.picked)))) : null,
    h('button.btn.seal.continue', { type: 'button', 'data-action': 'continue', onclick: () => act(r => R.leaveReward(r)) }, s.next === 'breakthrough' ? '突 破' : (s.picked && s.relicPicked) || !s.options.length ? '继 续' : '跳 过'));
}

function cardButton(run: RunState, option: RewardOption, onpick: () => void, done: boolean, price?: number, sold?: boolean) {
  const afford = price === undefined || run.gold >= price;
  const btn = h(`button.card${done || sold ? '.done' : ''}${!afford ? '.poor' : ''}`, {
    type: 'button', disabled: done || sold || !afford || undefined, onclick: (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08) translateY(-12px)' }, { transform: 'scale(1)' }], { duration: 260 });
      onpick();
    },
  }, optionCard(run, option), price !== undefined ? h('div.price', null, sold ? '已售' : `◆ ${price}`) : null);
  return btn;
}

function chooseReplace(run: RunState, option: RewardOption, done: (slot: number) => void) {
  const close = showOverlay(h('div.replace', null, h('h3', null, '法宝栏已满 · 选一件替换'),
    h('div.replace-row', null, ...run.relics.map((id, slot) => h('button.replace-btn', { type: 'button', onclick: () => { close(); done(slot); } }, relicView(id), h('small', null, `换掉${RELIC[id].name}`)))),
    option.type === 'relic' ? h('p.dim', null, `新法宝：${RELIC[option.relic].name} — ${RELIC[option.relic].desc}`) : null));
}

// —— Breakthrough ——
function breakthroughScreen(run: RunState, s: Extract<Screen, { name: 'breakthrough' }>) {
  setTimeout(() => { playSfx('breakthrough'); flash('rgba(255,236,190,.6)', 500); shake(3); }, 60);
  return h('div.scr.break-scr', null,
    h('img.bg', { src: art('bg-final'), alt: '' }),
    h('div.break-rays'),
    h('div.break-realm', null, h('small', null, '境界突破'), h('div.brush.realm-big', null, REALMS[run.realm]), h('div.break-sub', null, `气血上限 +25 · 气血全满`)),
    h('div.cards.talents', null, ...s.options.map((o, i) => cardButton(run, o, () => act(r => R.chooseBreakthrough(r, i), 'reward'), false))),
    h('p.break-note', null, '择一道天赋，此生不改。'));
}

// —— Shop ——
function shopScreen(run: RunState, s: Extract<Screen, { name: 'shop' }>) {
  const buy = (i: number) => {
    const item = s.items[i];
    if (item.option.type === 'relic' && run.relics.length >= run.relicSlots) return chooseReplace(run, item.option, slot => act(r => R.buy(r, i, slot), 'reward'));
    act(r => R.buy(r, i), 'reward');
  };
  return h('div.panel-scr.shop', null,
    h('h1.brush.big-title', null, '坊 市'),
    h('div.shop-grid', null, ...s.items.map((item, i) => cardButton(run, item.option, () => buy(i), false, item.price, item.sold))),
    h('div.shop-foot', null,
      h('button.btn.ink', { type: 'button', disabled: s.removed || run.gold < s.removePrice || undefined, onclick: () => act(r => R.startRemove(r)) }, `净符 · 移除一枚符 ◆${s.removePrice}`),
      h('button.btn.seal', { type: 'button', 'data-action': 'leave', onclick: () => act(r => R.leaveShop(r)) }, '离 开')));
}

// —— Event ——
function eventScreen(run: RunState, s: Extract<Screen, { name: 'event' }>) {
  const def = EVENT[s.event];
  return h(`div.panel-scr.event${def.bond ? '.bond-event' : ''}`, null,
    def.bond ? h('div.bond-kicker', null, s.event.endsWith('-2') ? '因缘 · 再遇' : '因缘 · 初遇') : null,
    h('div.event-glyph.brush', null, def.glyph),
    h('h1.brush', null, def.title),
    h('p.event-text', null, def.text),
    s.resolved !== undefined
      ? h('div.event-result', null, h('p', null, s.resolved),
        def.bond && run.bonds[def.bond] === 'kept' ? h('p.bond-note', null, `与${BOND[def.bond].name}有约。后面的路上，还会再见。`) : null,
        def.bond && run.bonds[def.bond] === 'done' ? h('p.bond-note', null, `${BOND[def.bond].name}将在天门相助：${BOND[def.bond].assist}`) : null, h('button.btn.seal', { type: 'button', 'data-action': 'continue', onclick: () => act(r => R.leaveEvent(r)) }, '继 续'))
      : h('div.event-options', null, ...def.options.map((o, i) => {
        const can = !o.can || o.can(run);
        return h('button.event-opt', { type: 'button', disabled: !can || undefined, 'data-option': i, onclick: () => act(r => R.chooseEvent(r, i), 'stamp') }, h('b', null, o.label), h('span', null, o.desc));
      })),
    run.vow ? h('div.vow-tag', null, `誓：${VOW[run.vow].name}`) : null);
}

// —— Rest ——
function restScreen(run: RunState, s: Extract<Screen, { name: 'rest' }>) {
  if (s.done) {
    return h('div.panel-scr.rest', null, h('div.event-glyph.brush', null, '憩'), h('h1.brush', null, '洞 府'), h('p.event-text', null, '调息已毕，可以上路了。'),
      h('button.btn.seal', { type: 'button', 'data-action': 'continue', onclick: () => act(r => R.leaveRest(r)) }, '继 续'));
  }
  const insights = R.insightChoices(run);
  return h('div.panel-scr.rest', null,
    h('div.event-glyph.brush', null, '憩'), h('h1.brush', null, '洞 府'),
    h('p.event-text', null, '石室清冷，可以歇一歇。只能做一件事。'),
    h('div.rest-options', null,
      h('button.event-opt', { type: 'button', 'data-option': 'heal', onclick: () => act(r => R.restChoose(r, 'heal'), 'heal') }, h('b', null, '调息'), h('span', null, `回复 ${Math.round(run.maxHp * 0.4)} 气血（${run.hp}/${run.maxHp}）`)),
      h('button.event-opt', { type: 'button', 'data-option': 'forge', onclick: () => act(r => R.restChoose(r, 'forge')) }, h('b', null, '炼符'), h('span', null, '一枚符点数 +3，并附上一道符纹')),
      h('div.event-opt.insight', null, h('b', null, '参悟'), h('span', null, '选一种诀式 +1 重'),
        h('div.insight-row', null, ...insights.map(id => h('button.chip', { type: 'button', onclick: () => act(r => R.restChoose(r, 'insight', id), 'reward') }, `${PATTERNS[id].name} ${run.patternLv[id] + 1}重`))))));
}

// —— Pick tiles ——
let picked: number[] = [];
function pickTileScreen(run: RunState, s: Extract<Screen, { name: 'pick-tile' }>) {
  picked = picked.filter(uid => run.bag.some(t => t.uid === uid));
  const tiles = [...run.bag].sort((a, b) => (a.el === b.el ? a.v - b.v : a.el < b.el ? -1 : 1));
  return h('div.panel-scr.pick', null,
    h('h2', null, s.title),
    h('div.pick-grid', null, ...tiles.map(t => {
      const on = picked.includes(t.uid);
      const el = tileView(t, { onclick: () => { picked = on ? picked.filter(x => x !== t.uid) : [...picked, t.uid].slice(-s.count); playSfx('select'); render(); } });
      if (on) el.classList.add('sel');
      return el;
    })),
    h('div.shop-foot', null,
      h('button.btn.ink', { type: 'button', onclick: () => { picked = []; act(r => R.cancelPick(r)); } }, '算 了'),
      h('button.btn.seal', { type: 'button', 'data-action': 'confirm', disabled: !picked.length || undefined, onclick: () => { const p = picked; picked = []; act(r => R.pickTiles(r, p), 'stamp'); } }, `确 定（${picked.length}/${s.count}）`)));
}

// —— End ——
export function finishRun(run: RunState) {
  if (run.log.includes('finished')) return;
  run.log.push('finished');
  app.endReport = recordRunEnd(app.meta, { won: run.screen.name === 'won', method: run.method, heat: run.heat, bestHit: run.stats.bestHit, ending: run.ending });
  save();
}

function endScreen(run: RunState) {
  finishRun(run);
  const won = run.screen.name === 'won';
  const report = app.endReport;
  setTimeout(() => { playSfx(won ? 'victory' : 'defeat'); if (won) { const c = document.querySelector('.end-seal'); if (c) { const r = c.getBoundingClientRect(); void r; } burst(portrait ? 360 : 640, portrait ? 420 : 260, '#f6d36b', 80, 2); ring(portrait ? 360 : 640, portrait ? 420 : 260, '#ffdf8a', 240); } }, 200);
  return h(`div.scr.end-scr${won ? '.won' : '.lost'}`, null,
    h('img.bg.dim', { src: art(won ? 'bg-title' : ACTS[Math.min(4, run.act - 1)].bg), alt: '' }),
    h('div.end-seal.brush', null, won ? (run.ending ? ENDING[run.ending].name : '渡劫') : '道消'),
    h('div.end-sub', null, won ? (report?.newEnding ? `新结局 · ${app.meta.endings.length}/${ENDINGS.length}` : `结局 ${app.meta.endings.length}/${ENDINGS.length}`) : `止步${ACTS[run.act - 1].name}。山海还在，再来。`),
    won && run.ending ? h('div.ending-text.inline', null, ...ENDING[run.ending].text.map((t, i) => h('p', { style: { animationDelay: `${0.6 + i * 0.8}s` } }, t))) : null,
    h('button.btn.ink.small', { type: 'button', 'data-action': 'deeds', onclick: () => showDeeds(run) }, won ? '回看此行' : '此行行迹'),
    h('div.end-stats', null,
      stat('最强一招', fmt(run.stats.bestHit), report?.newBest ? '新纪录' : ''),
      stat('最高诀式', run.stats.biggestPattern ? PATTERNS[run.stats.biggestPattern].name : '—'),
      stat('斩敌', String(run.stats.kills)),
      stat('境界', REALMS[run.realm]),
      stat('劫数', String(run.heat))),
    report?.unlockedMethod ? h('div.unlock', null, `解锁功法：${METHOD[report.unlockedMethod].name}`) : null,
    report?.unlockedHeat ? h('div.unlock', null, `解锁劫数 ${report.unlockedHeat}`) : null,
    h('div.end-build', null, ...run.relics.map(id => relicView(id, { small: true })), ...run.talents.map(id => h('span.chip', null, TALENT[id].name))),
    h('div.end-actions', null,
      h('button.btn.seal.big', { type: 'button', 'data-action': 'again', onclick: () => { app.run = null; save(); go('select'); } }, '再入山海'),
      h('button.btn.ink', { type: 'button', onclick: () => { app.run = null; save(); go('title'); } }, '回到标题')));
}
const stat = (label: string, value: string, badge = '') => h('div.stat', null, h('small', null, label), h('b', null, value), badge ? h('span.badge', null, badge) : null);

// —— Story ——
function bondChips(run: RunState) {
  const live = Object.entries(run.bonds ?? {}).filter(([, st]) => st === 'kept' || st === 'done');
  if (!live.length) return null;
  return h('span.bond-chips', null, ...live.map(([id, st]) => h(`span.bond-chip.${st}`, { title: `${BOND[id].name}：${st === 'done' ? `守约 · 终战相助（${BOND[id].assist}）` : '有约在身，后面还会再见'}` }, BOND[id].glyph)));
}

function storyScreen(run: RunState, actNo: number) {
  const story = ACT_STORY[actNo];
  const lines = story.prelude.map((line, i) => h('p.story-line', { style: { animationDelay: `${0.35 + i * 0.9}s` } }, line));
  const go = h('button.btn.seal.big.story-go', { type: 'button', 'data-action': 'continue', style: { animationDelay: `${0.5 + story.prelude.length * 0.9}s` }, onclick: () => act(r => R.leaveStory(r), 'stamp') }, actNo === 5 ? '入 天 门' : '启 程');
  const scr = h('div.scr.story-scr', { onclick: (e: Event) => { if (e.target !== go) scr.classList.add('instant'); } },
    h('img.bg', { src: art(ACTS[actNo - 1].bg), alt: '' }),
    h('div.story-shade'),
    h('div.story-card', null,
      h('div.story-act', null, story.title.split(' · ')[0]),
      h('h1.brush.story-title', null, story.title.split(' · ')[1] ?? story.title),
      ...lines,
      h('p.story-goal', { style: { animationDelay: `${0.35 + story.prelude.length * 0.9}s` } }, '此行：', story.goal),
      actNo === 1 && run.plan.length ? h('p.story-hint', { style: { animationDelay: `${0.35 + story.prelude.length * 0.9}s` } }, '山海路上会遇见一些人。答应过的事，到最后都会回来找你。') : null,
      go));
  return scr;
}

function endingChoiceScreen(run: RunState) {
  const done = BONDS.filter(b => run.bonds[b.id] === 'done');
  return h('div.scr.ending-scr', null,
    h('img.bg.dim', { src: art('bg-final'), alt: '' }),
    h('div.jie-seed'),
    h('div.ending-head', null, h('h1.brush', null, '劫 种'), h('p', null, '三百年的海与雷，缩成一粒滚烫的种子，在你掌心里跳。'),
      done.length ? h('p.dim', null, `${done.map(b => b.name).join('、')}站在你身后。`) : null),
    h('div.ending-choices', null, ...ENDINGS.map(e => {
      const ok = R.endingAvailable(run, e.id);
      return h(`button.ending-opt${ok ? '' : '.locked'}`, { type: 'button', disabled: !ok || undefined, 'data-ending': e.id, onclick: () => act(r => R.chooseEnding(r, e.id), 'breakthrough') },
        h('b.brush', null, ok ? e.name : '？'), h('span', null, ok ? e.choice : '……'), h('small', null, ok ? e.desc : e.lockedHint ?? ''));
    })));
}

function showDeeds(run: RunState) {
  const ending = run.ending ? ENDING[run.ending] : null;
  showOverlay(h('div.deeds', null,
    ending ? h('h2.brush', null, ending.name) : h('h2.brush', null, '行 迹'),
    ending ? h('div.ending-text', null, ...ending.text.map(t => h('p', null, t))) : null,
    h('h3', null, '此行'),
    run.deeds.length ? h('ol.deed-list', null, ...run.deeds.map(d => h('li', null, d))) : h('p.dim', null, '这一路什么也没有留下。'),
    h('div.deed-bonds', null, ...run.plan.map(id => {
      const st = run.bonds[id];
      return h('span.chip', null, `${BOND[id].name}：${st === 'done' ? '守约' : st === 'kept' ? '有约未践' : st === 'declined' ? '缘尽' : '未曾相遇'}`);
    }))));
}

export function showCodex() {
  const seen = new Set(app.meta.seen);
  const enemies = Object.values(ENEMY);
  showOverlay(h('div.codex', null,
    h('h2.brush', null, '山 海 图 鉴'),
    h('div.codex-endings', null, ...ENDINGS.map(e => h(`div.codex-ending${app.meta.endings.includes(e.id) ? '.got' : ''}`, null, h('b.brush', null, app.meta.endings.includes(e.id) ? e.name : '？'), h('small', null, app.meta.endings.includes(e.id) ? e.choice : '尚未见到的结局')))),
    h('div.codex-grid', null, ...enemies.map(e => {
      const known = seen.has(e.id);
      return h(`div.codex-card${known ? '' : '.unknown'}`, { title: known ? `${e.name}：${LORE[e.id] ?? ''}` : '尚未遇见' },
        h('img', { src: art(e.art), alt: '' }), h('b', null, known ? e.name : '？？'), h('small', null, known ? LORE[e.id] ?? e.title : `${ACTS[e.act - 1].name}`));
    }))));
}

export { toast, EL_COLOR, GEN_TEXT };
