import { canRage, enemyAttack, MAX_CAST, previewCast, swordDamage, tribulationStart, type BEvent, type CastOutcome } from '../core/battle.js';
import { METHOD, RELIC } from '../core/content.js';
import { counterOf, EL_NAME, KE, type El } from '../core/elements.js';
import { ACTS, ENEMY } from '../core/enemies.js';
import { PATTERNS } from '../core/patterns.js';
import * as R from '../core/run.js';
import type { CastResult, Step } from '../core/score.js';
import type { Move, RunState, Tile } from '../core/types.js';
import { anim, burst, centerOf, comet, EL_COLOR, flash, floatText, hitstop, isSkipping, lightning, reducedMotion, ring, setSkipping, shake, wait } from './fx.js';
import { $, $$, fmt, fmt1, h } from './h.js';
import { app, overlayOpen, render, save, toast } from './main.js';
import { art, hud, showBag, showHelp } from './screens.js';
import { playSfx } from './sfx.js';
import { bar, tileView, wuxingWheel } from './widgets.js';

let root: HTMLElement | null = null;
let selected: number[] = [];
let rageOn = false;
let busy = false;
let sortMode: 'el' | 'v' = 'el';
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
/** Values shown on screen; animations move these toward the real state. */
const disp = { ehp: 0, emax: 1, php: 0, pmax: 1, shield: 0, armor: 0, eburn: 0, pburn: 0, qi: 0, el: 'jin' as El };

const run = () => app.run!;
const nn = (...items: (HTMLElement | null)[]) => items.filter(Boolean) as HTMLElement[];
const battle = () => app.run!.battle!;

export function mountBattle(container: HTMLElement) {
  const r = run();
  const b = battle();
  selected = [];
  rageOn = false;
  busy = false;
  syncDisp();
  const enemy = ENEMY[b.enemyId];
  if (!app.meta.seen.includes(enemy.id)) app.meta.seen.push(enemy.id);
  root = h(`div.scr.battle-scr.rank-${enemy.rank}`, null,
    h('img.bg', { src: art(ACTS[r.act - 1].bg), alt: '' }),
    h('div.arena-shade'),
    h('div.hero-wrap', null,
      h('img.hero-art', { src: art(`hero-${r.method}`), alt: METHOD[r.method].name }),
      h('div.hero-shield'),
      h('div.hero-status'),
      h('div.hero-bar')),
    h('div.enemy-wrap', null,
      h('div.enemy-intent'),
      h('img.enemy-art', { src: art(enemy.art), alt: enemy.name }),
      h('div.enemy-status')),
    h('div.enemy-plate', null,
      h('div.enemy-name', null, h('span.e-el'), h('b', null, enemy.name), h('small', null, enemy.title)),
      h('div.enemy-bar'),
      enemy.traitText ? h('div.enemy-trait', null, enemy.traitText) : null),
    h('div.wheel-slot'),
    h('div.turn-tag'),
    h('div.score-panel', null,
      h('div.sp-pattern', null, '　'),
      h('div.sp-row', null, h('div.sp-box.sp-qi', null, h('small', null, '气'), h('b', null, '0')), h('span.sp-x', null, '×'), h('div.sp-box.sp-mult', null, h('small', null, '倍'), h('b', null, '0'))),
      h('div.sp-dmg')),
    h('div.lane'),
    h('div.hand-area', null, h('div.preview-line'), h('div.hand')),
    h('div.controls', null,
      h('button.qi-gauge', { type: 'button', 'data-action': 'rage', title: '剑意满时可开怒技（本招 ×3）· 快捷键 R', onclick: () => toggleRage() }, h('div.qi-fill'), h('span.qi-text')),
      h('button.btn.seal.cast-btn', { type: 'button', 'data-action': 'cast', onclick: () => void doCast() }, h('span.cast-main', null, '出招'), h('small.cast-sub')),
      h('button.btn.ink.discard-btn', { type: 'button', 'data-action': 'discard', onclick: () => void doDiscard() }, '换符', h('small.discard-left'))),
    h('div.pile-dock', null,
        h('button.pile-btn', { type: 'button', onclick: () => showBag(r), title: '查看符袋' }, h('span.pile-draw'), h('small', null, '待抽')),
        h('button.pile-btn.sort', { type: 'button', title: '整理手牌', onclick: () => { sortMode = sortMode === 'el' ? 'v' : 'el'; renderHand(); } }, '理'),
        h('button.pile-btn', { type: 'button', title: '诀谱', onclick: () => showHelp() }, '谱')),
    hud(r, { battle: true }));
  container.appendChild(root);
  root.addEventListener('pointerdown', () => { if (busy) setSkipping(true); });
  keyHandler = onKey;
  window.addEventListener('keydown', keyHandler);
  refreshAll();
  renderHand(true);
  void intro();
}

export function unmountBattle() {
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  root = null;
  setSkipping(false);
}

async function intro() {
  const enemy = ENEMY[battle().enemyId];
  const art = $('.enemy-art', root!);
  void anim(art, [{ transform: 'translateX(120px) scale(.9)', opacity: 0, filter: 'brightness(4)' }, { transform: 'none', opacity: 1, filter: 'none' }], 520);
  if (enemy.rank !== 'fight') {
    playSfx('stamp');
    banner(enemy.rank === 'boss' ? enemy.name : `精英 · ${enemy.name}`, enemy.title, enemy.rank);
  }
}

function syncDisp() {
  const b = battle();
  disp.ehp = b.enemy.hp; disp.emax = b.enemy.maxHp; disp.php = b.player.hp; disp.pmax = b.player.maxHp;
  disp.shield = b.player.shield; disp.armor = b.enemy.armor; disp.eburn = b.enemy.burn; disp.pburn = b.player.burn;
  disp.qi = b.qi; disp.el = b.enemy.el;
}

// —— Static refreshers ——
function refreshAll() {
  if (!root) return;
  refreshBars();
  refreshIntent();
  refreshStatus();
  refreshControls();
  refreshWheel();
  refreshTurn();
}

function setBar(container: HTMLElement | null, cls: string, value: number, max: number, extra?: HTMLElement | null) {
  if (!container) return;
  const existing = container.querySelector<HTMLElement>(`.bar.${cls}`);
  const pct = Math.max(0, Math.min(100, (100 * value) / Math.max(1, max)));
  if (!existing) { container.replaceChildren(bar(cls, value, max, undefined, extra)); return; }
  const prev = existing.style.getPropertyValue('--pct');
  existing.style.setProperty('--pct', `${pct}%`);
  if (parseFloat(prev) > pct) {
    existing.classList.remove('drain');
    void existing.offsetWidth;
    existing.classList.add('drain');
    setTimeout(() => existing.style.setProperty('--ghost', `${pct}%`), 420);
  } else existing.style.setProperty('--ghost', `${pct}%`);
  existing.querySelector('.bar-text')!.textContent = `${fmt(Math.max(0, value))} / ${fmt(max)}`;
}

function refreshBars() {
  setBar($('.enemy-bar', root!), 'ehp', disp.ehp, disp.emax);
  setBar($('.hero-bar', root!), 'hp', disp.php, disp.pmax);
  const shield = $('.hero-shield', root!)!;
  shield.classList.toggle('on', disp.shield > 0);
  shield.textContent = disp.shield > 0 ? `盾 ${fmt(disp.shield)}` : '';
}

function refreshStatus() {
  const es = $('.enemy-status', root!)!;
  es.replaceChildren(...nn(
    disp.armor > 0 ? h('span.st.st-armor', { title: '护甲：先抵挡你下一招的伤害' }, '甲 ', fmt(disp.armor)) : null,
    disp.eburn > 0 ? h('span.st.st-burn', { title: '灼烧：敌方回合开始时受到等量伤害' }, '焰 ', fmt(disp.eburn)) : null,
    battle().enemy.charged ? h('span.st.st-charge', { title: '蓄势：下一次攻击伤害翻倍' }, '蓄势') : null,
    battle().enemy.atkBonus > 0 ? h('span.st.st-buff', { title: '战意：攻击伤害提高' }, '怒 +', String(battle().enemy.atkBonus)) : null));
  const hs = $('.hero-status', root!)!;
  const b = battle();
  hs.replaceChildren(...nn(
    disp.pburn > 0 ? h('span.st.st-burn', null, '焰 ', String(disp.pburn)) : null,
    b.swords > 0 ? h('span.st.st-sword', { title: `飞剑：每次出招后齐射，每柄 ${swordDamage(run())} 伤害` }, '剑 ×', String(b.swords)) : null,
    b.spring > 0 ? h('span.st.st-spring', { title: '春华：下一招计入气' }, '春 ', fmt(b.spring)) : null,
    b.stacks.thunder ? h('span.st.st-thunder', { title: '雷引：本场倍率永久提高' }, '雷 +', String(b.stacks.thunder)) : null));
  const plate = $('.e-el', root!)!;
  plate.className = `e-el el-${disp.el}`;
  plate.textContent = EL_NAME[disp.el];
}

function intentText(move: Move): HTMLElement[] {
  const r = run(), b = battle();
  const parts: HTMLElement[] = [];
  if (move.atk) { const d = enemyAttack(r, b, move); parts.push(h('span.it.it-atk', null, '⚔ ', fmt(d), (move.hits ?? 1) > 1 ? h('small', null, `×${move.hits}`) : null)); }
  if (move.armor) parts.push(h('span.it.it-armor', null, '甲'));
  if (move.burn) parts.push(h('span.it.it-burn', null, '焰'));
  if (move.curse) parts.push(h('span.it.it-curse', null, `浊×${move.curse}`));
  if (move.charge) parts.push(h('span.it.it-charge', null, '蓄'));
  if (move.heal) parts.push(h('span.it.it-heal', null, '愈'));
  if (move.buff) parts.push(h('span.it.it-buff', null, '怒'));
  if (move.drain) parts.push(h('span.it.it-drain', null, '夺意'));
  return parts;
}

function intentTitle(move: Move) {
  const lines = [`下一招：${move.name}`];
  if (move.atk) lines.push(`攻击 ${enemyAttack(run(), battle(), move)}${(move.hits ?? 1) > 1 ? ` × ${move.hits} 段` : ''}`);
  if (move.armor) lines.push('获得护甲，抵挡你下一招');
  if (move.burn) lines.push('使你灼烧');
  if (move.curse) lines.push(`往你的符袋混入 ${move.curse} 枚浊符`);
  if (move.charge) lines.push('蓄势：下一次攻击翻倍');
  if (move.heal) lines.push('回复气血');
  if (move.buff) lines.push('攻击永久提高');
  if (move.drain) lines.push(`夺走 ${move.drain} 点剑意`);
  return lines.join('\n');
}

function refreshIntent() {
  const b = battle();
  const el = $('.enemy-intent', root!)!;
  el.title = intentTitle(b.enemy.intent);
  el.replaceChildren(h('span.it-name', null, b.enemy.intent.name), ...intentText(b.enemy.intent));
  const total = (b.enemy.intent.atk ? enemyAttack(run(), b) * (b.enemy.intent.hits ?? 1) : 0);
  el.classList.toggle('danger', total >= b.player.hp + b.player.shield);
}

function refreshWheel() {
  $('.wheel-slot', root!)!.replaceChildren(wuxingWheel(disp.el));
}

function refreshTurn() {
  const b = battle();
  const start = tribulationStart(run());
  const left = start - b.turn;
  $('.turn-tag', root!)!.replaceChildren(h('b', null, `第 ${b.turn} 回合`),
    left > 0 ? h('small', null, `天劫 ${left} 回合后`) : h('small.tribulation', null, `天劫 · ${b.turn - start + 1} 重`));
}

function refreshControls() {
  const b = battle();
  const r = run();
  const fill = $('.qi-fill', root!)!;
  fill.style.height = `${disp.qi}%`;
  fill.style.setProperty('--w', `${disp.qi}%`);
  const gauge = $('.qi-gauge', root!)!;
  gauge.classList.toggle('full', canRage(b));
  gauge.classList.toggle('on', rageOn && canRage(b));
  $('.qi-text', root!)!.textContent = canRage(b) ? (rageOn ? '怒技·开' : '怒技') : `剑意 ${Math.floor(disp.qi)}`;
  $('.discard-left', root!)!.textContent = r.vow === 'juenian' ? '绝念' : `余 ${b.discardsLeft}`;
  ($('.discard-btn', root!) as HTMLButtonElement).disabled = busy || b.discardsLeft <= 0 || !selected.length;
  ($('.cast-btn', root!) as HTMLButtonElement).disabled = busy || !selected.length;
  $('.pile-draw', root!)!.textContent = String(b.draw.length);
  root!.classList.toggle('busy', busy);
  root!.classList.toggle('rage-armed', rageOn && canRage(b));
}

// —— Hand ——
function sortedHand(): Tile[] {
  const order: Record<string, number> = { mu: 0, huo: 1, tu: 2, jin: 3, shui: 4, zhuo: 5 };
  return [...battle().hand].sort((a, b) => (sortMode === 'el' ? order[a.el] - order[b.el] || a.v - b.v : b.v - a.v || order[a.el] - order[b.el]));
}

function renderHand(dealIn = false, newUids: number[] = []) {
  if (!root) return;
  const hand = $('.hand', root)!;
  const enemyEl = disp.el;
  const counter = counterOf(enemyEl);
  const weak = KE[enemyEl];
  const tiles = sortedHand();
  hand.replaceChildren(...tiles.map((tile, i) => {
    const order = selected.indexOf(tile.uid) + 1;
    const el = tileView(tile, { order: order || undefined, onclick: () => toggleTile(tile.uid) });
    el.dataset.key = String(i + 1);
    if (order) el.classList.add('sel');
    if (tile.el === counter) el.classList.add('counter');
    if (tile.el === weak) el.classList.add('weak');
    if (dealIn && (!newUids.length || newUids.includes(tile.uid))) {
      el.animate([{ transform: 'translate(260px, 120px) rotate(18deg) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 340, delay: i * 45, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'backwards' });
    }
    return el;
  }));
  if (dealIn) for (let i = 0; i < tiles.length; i += 1) setTimeout(() => playSfx('draw'), i * 45);
  refreshPreview();
}

function toggleTile(uid: number) {
  if (busy) return;
  if (selected.includes(uid)) selected = selected.filter(x => x !== uid);
  else if (selected.length < MAX_CAST) selected.push(uid);
  else { toast('一招至多五枚符'); return; }
  playSfx('select');
  renderHand();
}

function toggleRage() {
  if (busy || !canRage(battle())) { if (!canRage(battle())) toast('剑意未满'); return; }
  rageOn = !rageOn;
  playSfx(rageOn ? 'rage' : 'click');
  refreshControls();
  refreshPreview();
}

function refreshPreview() {
  if (!root) return;
  const line = $('.preview-line', root)!;
  const r = run(), b = battle();
  $$('.tile.chain', root).forEach(el => el.classList.remove('chain'));
  if (!selected.length) {
    line.replaceChildren(h('span.dim', null, r.stats.casts < 4 ? '点选符组成诀式 · 点选顺序即出招顺序 · 木→火→土→金→水 连出成相生' : '点选 1–5 枚符'));
    setScore(null);
    refreshControls();
    return;
  }
  const res = previewCast(r, b, selected, rageOn);
  if (!res) return;
  for (const i of res.chain) $(`.hand .tile[data-uid="${selected[i]}"]`, root)?.classList.add('chain');
  const effects: string[] = [];
  if (res.shield) effects.push(`盾+${res.shield}`);
  if (res.heal) effects.push(`血+${res.heal}`);
  if (res.burn) effects.push(`焰+${res.burn}`);
  if (res.critChance > 5) effects.push(`暴击 ${Math.round(res.critChance)}%`);
  const lethal = res.damage >= b.enemy.hp + (b.enemy.armor || 0);
  line.replaceChildren(...nn(
    h('b.pv-pattern', null, PATTERNS[res.pattern].name),
    h('span.pv-calc', null, h('b.qi', null, fmt(res.qi)), ' × ', h('b.mu', null, fmt1(res.mult)), ' = ', h('b.pv-dmg', null, fmt(res.damage))),
    effects.length ? h('span.pv-fx', null, effects.join(' · ')) : null,
    lethal ? h('span.pv-kill', null, '斩！') : null));
  setScore(res);
  refreshControls();
}

function setScore(res: CastResult | null) {
  const panel = $('.score-panel', root!)!;
  panel.classList.toggle('preview', !!res);
  $('.sp-pattern', panel)!.textContent = res ? PATTERNS[res.pattern].name : '　';
  $('.sp-qi b', panel)!.textContent = res ? fmt(res.qi) : '0';
  $('.sp-mult b', panel)!.textContent = res ? fmt1(res.mult) : '0';
  $('.sp-dmg', panel)!.textContent = '';
}

function onKey(e: KeyboardEvent) {
  if (!root || overlayOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (busy) { if (e.key === ' ' || e.key === 'Enter') { setSkipping(true); e.preventDefault(); } return; }
  const tiles = sortedHand();
  if (/^[1-9]$/.test(e.key)) { const t = tiles[Number(e.key) - 1]; if (t) toggleTile(t.uid); e.preventDefault(); }
  else if (e.key === 'Enter' || e.key === ' ') { void doCast(); e.preventDefault(); }
  else if (e.key === 'q' || e.key === 'Q' || e.key === 'd' || e.key === 'D') void doDiscard();
  else if (e.key === 'r' || e.key === 'R') toggleRage();
  else if (e.key === 'Escape') { selected = []; renderHand(); }
}

// —— Discard ——
async function doDiscard() {
  const b = battle();
  if (busy || !selected.length || b.discardsLeft <= 0) return;
  busy = true;
  refreshControls();
  const leaving = selected.map(uid => $(`.hand .tile[data-uid="${uid}"]`, root!));
  await Promise.all(leaving.map((el, i) => anim(el, [{ transform: 'none', opacity: 1 }, { transform: `translate(${200 + i * 10}px, 160px) rotate(${30 + i * 8}deg)`, opacity: 0 }], 260, { fill: 'forwards', delay: i * 30 })));
  const before = new Set(b.hand.map(t => t.uid));
  R.discard(run(), selected);
  selected = [];
  save();
  const fresh = battle().hand.filter(t => !before.has(t.uid)).map(t => t.uid);
  busy = false;
  renderHand(true, fresh);
  refreshControls();
}

// —— Cast ——
async function doCast() {
  if (busy || !selected.length || !root) return;
  const r = run();
  const uids = [...selected];
  const tileEls = uids.map(uid => $(`.hand .tile[data-uid="${uid}"]`, root!)!);
  const fromRects = tileEls.map(el => centerOf(el));
  const handBefore = new Set(battle().hand.map(t => t.uid));
  const out = R.castTiles(r, uids, rageOn);
  if (!out) return;
  busy = true;
  selected = [];
  rageOn = false;
  save();
  refreshControls();
  $('.preview-line', root)!.replaceChildren();
  try {
    await playCast(out, tileEls, fromRects);
    await playEvents(out.events, 'player');
    if (battle()?.outcome === 'fighting' && out.enemyEvents.length) await playEvents(out.enemyEvents, 'enemy');
  } catch (err) {
    console.error(err);
  }
  setSkipping(false);
  if (!root) return;
  const b = run().battle;
  if (!b || b.outcome !== 'fighting') { await endSequence(); return; }
  syncDisp();
  refreshAll();
  $('.lane', root)!.replaceChildren();
  const fresh = b.hand.filter(t => !handBefore.has(t.uid)).map(t => t.uid);
  busy = false;
  renderHand(true, fresh);
  setScore(null);
  refreshControls();
}

function laneSlots(n: number) {
  const lane = $('.lane', root!)!;
  const c = centerOf(lane);
  const gap = 96;
  return Array.from({ length: n }, (_, i) => ({ x: c.x + (i - (n - 1) / 2) * gap, y: c.y }));
}

async function playCast(out: CastOutcome, tileEls: HTMLElement[], from: { x: number; y: number }[]) {
  const res = out.result;
  const lane = $('.lane', root!)!;
  lane.replaceChildren();
  const slots = laneSlots(res.tiles.length);
  const laneOrigin = centerOf(lane);
  // Tiles fly from the hand into the lane, in cast order.
  const clones = res.tiles.map((tile, i) => {
    const el = tileView(tile);
    el.classList.add('lane-tile');
    el.style.left = `${slots[i].x - laneOrigin.x}px`;
    lane.appendChild(el);
    tileEls[i]?.classList.add('gone');
    return el;
  });
  playSfx('slash', 0.6);
  await Promise.all(clones.map((el, i) => anim(el, [
    { transform: `translate(${from[i].x - slots[i].x}px, ${from[i].y - slots[i].y}px) scale(.9)` },
    { transform: 'translate(0,0) scale(1.08)', offset: 0.8 },
    { transform: 'translate(0,0) scale(1)' },
  ], 300, { delay: i * 55 })));
  const panel = $('.score-panel', root!)!;
  panel.classList.remove('preview');
  panel.classList.add('live');
  const qiB = $('.sp-qi b', panel)!, multB = $('.sp-mult b', panel)!;
  let tick = 0;
  for (const step of res.steps) await playStep(step, res, clones, qiB, multB, tick++);
  // Total.
  const dmgEl = $('.sp-dmg', panel)!;
  dmgEl.className = `sp-dmg tier-${dmgTier(res.damage)}`;
  await countUp(dmgEl, res.damage, 360);
  playSfx('stamp');
  anim(dmgEl, [{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], 220);
  await wait(200);
  // Release: tiles converge and fly at the enemy.
  const target = centerOf($('.enemy-art', root!));
  const mid = { x: slots.reduce((s, p) => s + p.x, 0) / slots.length, y: slots[0].y };
  await Promise.all(clones.map((el, i) => anim(el, [{ transform: 'none', opacity: 1 }, { transform: `translate(${mid.x - slots[i].x}px, 0) scale(.3)`, opacity: 0 }], 160, { fill: 'forwards' })));
  const color = EL_COLOR[res.els.find(Boolean) ?? 'jin'];
  playSfx('slash', 1.3);
  await comet(mid, target, color, 200, res.rage ? 64 : 34);
  panel.classList.remove('live');
}

function dmgTier(n: number) { return n >= 100000 ? 4 : n >= 10000 ? 3 : n >= 1000 ? 2 : n >= 100 ? 1 : 0; }

async function countUp(el: HTMLElement, value: number, ms: number) {
  const steps = isSkipping() || reducedMotion() ? 1 : 12;
  for (let i = 1; i <= steps; i += 1) {
    el.textContent = fmt((value * i) / steps);
    await wait(ms / steps);
  }
}

async function playStep(step: Step, res: CastResult, clones: HTMLElement[], qiB: HTMLElement, multB: HTMLElement, index: number) {
  const pop = (el: HTMLElement, big = false) => anim(el.parentElement, [{ transform: `scale(${big ? 1.5 : 1.25})` }, { transform: 'scale(1)' }], big ? 300 : 180);
  const setVals = () => { qiB.textContent = fmt(step.qi); multB.textContent = fmt1(step.mult); };
  switch (step.k) {
    case 'pattern': {
      const p = $('.sp-pattern', root!)!;
      p.textContent = step.label;
      p.className = `sp-pattern tier-${PATTERNS[res.pattern].tier}`;
      setVals();
      playSfx('stamp');
      if (PATTERNS[res.pattern].tier >= 5) { shake(2); flash('rgba(255,220,150,.25)', 220); }
      for (const i of res.chain) clones[i]?.classList.add('chain');
      await anim(p, [{ transform: 'scale(2.4) rotate(-6deg)', opacity: 0 }, { transform: 'scale(.92)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }], 300);
      if (res.chain.length) await chainLinks(clones, res.chain);
      pop(qiB); pop(multB);
      await wait(120);
      return;
    }
    case 'tile': {
      const el = clones[step.index!];
      if (!el) return;
      const c = centerOf(el);
      const tile = res.tiles[step.index!];
      anim(el, [{ transform: 'translateY(0)' }, { transform: 'translateY(-26px) scale(1.12)' }, { transform: 'translateY(0)' }], 200);
      floatText(c.x, c.y - 70, step.label, `ft-tile el-text-${tile.el}`, 40, 700);
      if (step.tag) floatText(c.x + 34, c.y - 40, step.tag, `ft-tag tag-${step.tag}`, 20, 700);
      const fx = step.fx;
      if (fx?.shield) floatText(c.x - 30, c.y + 50, `盾+${fx.shield}`, 'ft-fx el-text-shui', 20, 600);
      if (fx?.heal) floatText(c.x - 30, c.y + 50, `血+${fx.heal}`, 'ft-fx el-text-mu', 20, 600);
      if (fx?.burn) floatText(c.x - 30, c.y + 50, `焰+${fx.burn}`, 'ft-fx el-text-huo', 20, 600);
      if (fx?.crit) floatText(c.x - 30, c.y + 50, `暴+${fx.crit}%`, 'ft-fx el-text-jin', 20, 600);
      if (step.dMult || step.x) floatText(c.x + 30, c.y + 50, step.x ? `×${fmt1(step.x)}` : `+${fmt1(step.dMult!)}倍`, 'ft-fx ft-mult', 20, 600);
      burst(c.x, c.y - 20, EL_COLOR[tile.el], 8, 0.5);
      playSfx('tick', index);
      if (step.x) playSfx('xmult');
      setVals();
      pop(qiB);
      if (step.dMult || step.x) pop(multB, !!step.x);
      await wait(150);
      return;
    }
    case 'relic': case 'bonus': {
      let c = centerOf($('.score-panel', root!));
      if (step.k === 'relic') {
        const el = $(`.hud .relic[data-slot="${step.index}"]`, root!);
        if (el) {
          c = centerOf(el);
          el.classList.add('firing');
          anim(el, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(10px) scale(1.35)' }, { transform: 'translateY(0) scale(1)' }], 300).then(() => el.classList.remove('firing'));
        }
      }
      floatText(c.x, c.y + (step.k === 'relic' ? 70 : -60), step.label, `ft-relic${step.x ? ' ft-x' : ''}`, 30, 900);
      playSfx(step.x ? 'xmult' : 'mult', index);
      setVals();
      if (step.dQi) pop(qiB);
      if (step.dMult || step.x) pop(multB, !!step.x);
      if (step.x && step.x >= 2) shake(1);
      await wait(step.x ? 260 : 200);
      return;
    }
    case 'rage': {
      await rageCutIn();
      setVals();
      pop(multB, true);
      shake(3);
      return;
    }
    case 'crit': {
      const p = $('.score-panel', root!)!;
      const c = centerOf(p);
      const seal = floatText(c.x + 120, c.y - 40, '暴击', 'ft-crit', 10, 1100);
      void seal;
      playSfx('crit');
      flash('rgba(255,60,40,.25)', 200);
      setVals();
      pop(multB, true);
      await wait(260);
      return;
    }
  }
}

async function chainLinks(clones: HTMLElement[], chain: number[]) {
  for (let k = 0; k < chain.length; k += 1) {
    const el = clones[chain[k]];
    if (!el) continue;
    el.classList.add('chain-lit');
    const c = centerOf(el);
    ring(c.x, c.y, '#fff3c4', 50);
    playSfx('tick', 6 + k * 2);
    await wait(70);
  }
}

async function rageCutIn() {
  const r = run();
  const m = METHOD[r.method];
  playSfx('rage');
  const cut = h('div.cutin', null, h('img', { src: art(`hero-${r.method}`), alt: '' }), h('div.cutin-text.brush', null, '怒', h('small', null, `${m.title} · 剑诀`)));
  root!.appendChild(cut);
  flash('rgba(255,255,255,.5)', 180);
  await anim(cut, [{ clipPath: 'inset(45% 0 45% 0)', opacity: 0 }, { clipPath: 'inset(20% 0 20% 0)', opacity: 1, offset: 0.25 }, { clipPath: 'inset(20% 0 20% 0)', opacity: 1, offset: 0.8 }, { clipPath: 'inset(50% 0 50% 0)', opacity: 0 }], 900);
  cut.remove();
}

// —— Battle events ——
async function playEvents(events: BEvent[], side: 'player' | 'enemy') {
  for (const ev of events) {
    if (!root) return;
    await playEvent(ev, side);
  }
}

async function playEvent(ev: BEvent, side: 'player' | 'enemy') {
  const enemyArt = $('.enemy-art', root!)!;
  const heroArt = $('.hero-art', root!)!;
  switch (ev.k) {
    case 'hit': {
      if (ev.to === 'enemy') await hitEnemy(ev.amount, ev.blocked, ev.src, !!ev.crit);
      else await hitPlayer(ev.amount, ev.blocked, ev.src, ev.hitIndex ?? 0);
      return;
    }
    case 'swords': {
      const c = centerOf(heroArt);
      if (ev.forged) floatText(c.x, c.y - 140, `铸剑 +${ev.forged}`, 'ft-fx el-text-jin', 30, 700);
      const t = centerOf(enemyArt);
      const n = Math.min(ev.count, 12);
      playSfx('slash', 0.8);
      await Promise.all(Array.from({ length: n }, (_, i) => wait(i * 35).then(() => comet({ x: c.x + 40, y: c.y - 120 + (i % 4) * 30 }, { x: t.x + (Math.random() * 80 - 40), y: t.y + (Math.random() * 120 - 60) }, '#f6d36b', 220, 18))));
      return;
    }
    case 'heal': {
      const c = centerOf(ev.to === 'player' ? heroArt : enemyArt);
      if (ev.to === 'player') { disp.php += ev.amount; } else { disp.ehp += ev.amount; }
      if (ev.amount > 0) { floatText(c.x, c.y - 40, `+${fmt(ev.amount)}`, 'ft-heal', 60, 900); burst(c.x, c.y, '#4fdc8e', 16, 0.7, 'ember'); playSfx('heal'); }
      if (ev.to === 'player' && ev.overflow) floatText(c.x, c.y + 10, `溢 ${fmt(ev.overflow)}`, 'ft-fx el-text-mu', 30, 700);
      refreshBars();
      await wait(180);
      return;
    }
    case 'shield': {
      disp.shield = Math.min(disp.shield + ev.amount, battle().player.shield);
      const c = centerOf(heroArt);
      ring(c.x, c.y, '#45c9f5', 120);
      floatText(c.x, c.y - 90, `盾 +${fmt(ev.amount)}`, 'ft-shield', 40, 800);
      playSfx('shield');
      refreshBars();
      await wait(150);
      return;
    }
    case 'burn': {
      if (ev.to === 'enemy') disp.eburn += ev.amount; else disp.pburn += ev.amount;
      const c = centerOf(ev.to === 'enemy' ? enemyArt : heroArt);
      burst(c.x, c.y + 40, '#ff5a2c', 20, 0.6, 'ember');
      floatText(c.x + 50, c.y + 20, `焰 +${ev.amount}`, 'ft-fx el-text-huo', 40, 700);
      playSfx('burn');
      refreshStatus();
      await wait(140);
      return;
    }
    case 'thunder': {
      const c = centerOf(heroArt);
      lightning(c.x, c.y - 40);
      floatText(c.x, c.y - 160, `雷引 · 倍率 +${ev.total}`, 'ft-relic', 30, 900);
      playSfx('thunder');
      refreshStatus();
      await wait(240);
      return;
    }
    case 'move': {
      const intent = $('.enemy-intent', root!)!;
      anim(intent, [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], 260);
      const c = centerOf(enemyArt);
      floatText(c.x, c.y - 200, ev.name, 'ft-move', 20, 900);
      playSfx('stamp', 0.6);
      if (ev.move.atk) {
        await anim(enemyArt, [{ transform: 'translateX(0)' }, { transform: 'translateX(40px) scale(.96)', offset: 0.35 }, { transform: 'translateX(-180px) scale(1.06)' }], 260, { fill: 'forwards' });
        await wait(40);
      } else await wait(260);
      return;
    }
    case 'armor': {
      disp.armor = ev.amount;
      const c = centerOf(enemyArt);
      ring(c.x, c.y, '#c9d2dc', 140);
      floatText(c.x, c.y - 60, `护甲 ${fmt(ev.amount)}`, 'ft-armor', 40, 800);
      playSfx('shield');
      refreshStatus();
      await wait(200);
      return;
    }
    case 'curse': {
      const from = centerOf(enemyArt);
      const to = centerOf($('.pile-btn', root!));
      playSfx('curse');
      await Promise.all(Array.from({ length: ev.n }, (_, i) => wait(i * 90).then(() => comet(from, to, '#8a7f95', 380, 30))));
      toast(`${ev.n} 枚浊符混入你的符袋`, 'bad');
      return;
    }
    case 'charge': {
      const c = centerOf(enemyArt);
      burst(c.x, c.y, '#ff3b2f', 30, 0.6, 'ember');
      floatText(c.x, c.y - 120, '蓄 势', 'ft-move danger', 20, 900);
      playSfx('rage');
      refreshStatus();
      await wait(320);
      return;
    }
    case 'buff': {
      const c = centerOf(enemyArt);
      floatText(c.x, c.y - 120, `战意 +${ev.amount}`, 'ft-move danger', 20, 800);
      refreshStatus();
      await wait(240);
      return;
    }
    case 'drain': {
      disp.qi = Math.max(0, disp.qi - ev.amount);
      const c = centerOf($('.qi-gauge', root!));
      floatText(c.x, c.y - 50, `剑意 -${ev.amount}`, 'ft-dmg-player', 40, 800);
      refreshControls();
      await wait(220);
      return;
    }
    case 'phase': {
      shake(4);
      flash('rgba(255,40,30,.45)', 420);
      playSfx('ko');
      banner(ev.name, ev.text, 'boss');
      enemyArt.classList.add('phase2');
      await wait(1100);
      refreshIntent();
      return;
    }
    case 'revive': {
      disp.ehp = ev.hp;
      enemyArt.classList.remove('dying');
      await anim(enemyArt, [{ opacity: 0.2, filter: 'brightness(0)' }, { opacity: 1, filter: 'brightness(3)' }, { opacity: 1, filter: 'none' }], 700);
      refreshBars();
      return;
    }
    case 'tribulation': {
      playSfx('thunder');
      flash('rgba(220,220,255,.6)', 300);
      const e = centerOf(enemyArt), p = centerOf(heroArt);
      lightning(e.x, e.y);
      lightning(p.x, p.y);
      shake(3);
      floatText(640, 120, `天劫 · 第 ${ev.level} 重`, 'ft-move danger', 20, 1000);
      await wait(300);
      return;
    }
    case 'element': {
      disp.el = ev.el;
      const c = centerOf(enemyArt);
      floatText(c.x, c.y - 160, `化${EL_NAME[ev.el]}`, `ft-move el-text-${ev.el}`, 20, 900);
      ring(c.x, c.y, EL_COLOR[ev.el], 160);
      refreshStatus();
      refreshWheel();
      await wait(220);
      return;
    }
    case 'turn': {
      anim(enemyArt, [{ transform: 'translateX(-180px)' }, { transform: 'translateX(0)' }], 260);
      syncDisp();
      refreshAll();
      const t = $('.turn-tag', root!)!;
      anim(t, [{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], 260);
      return;
    }
    case 'draw': return;
    case 'win': case 'lose': return;
  }
}

async function hitEnemy(amount: number, blocked: number, src: string, crit: boolean) {
  const enemyArt = $('.enemy-art', root!)!;
  const c = centerOf(enemyArt);
  const ratio = (amount + blocked) / Math.max(1, disp.emax);
  disp.ehp = Math.max(0, disp.ehp - amount);
  if (blocked) { disp.armor = Math.max(0, disp.armor - blocked); floatText(c.x - 60, c.y - 30, `破甲 ${fmt(blocked)}`, 'ft-armor', 50, 800); burst(c.x, c.y, '#d9e2ea', 14, 0.8); }
  const big = src === 'cast' || src === 'detonate';
  const level = !big ? 1 : ratio >= 0.5 ? 4 : ratio >= 0.25 ? 3 : ratio >= 0.1 ? 2 : 1;
  enemyArt.classList.add('hurt');
  if (big) await hitstop(40 + Math.min(220, ratio * 420));
  shake(level);
  if (level >= 3) flash('rgba(255,255,255,.55)', 140);
  const color = src === 'detonate' || src === 'burn' ? '#ff5a2c' : src === 'tribulation' ? '#d9d2ff' : crit ? '#ff3b2f' : '#fff4d6';
  burst(c.x, c.y, color, big ? 30 + level * 12 : 10, big ? 1 + level * 0.3 : 0.6);
  if (big) burst(c.x, c.y, '#0b0d10', 10 + level * 4, 1, 'ink');
  if (level >= 3) ring(c.x, c.y, color, 160);
  playSfx(level >= 3 ? 'heavy' : 'hit', 0.6 + level * 0.3);
  const label = src === 'sword' ? `剑 ${fmt(amount)}` : src === 'burn' ? `焰 ${fmt(amount)}` : src === 'detonate' ? `焚 ${fmt(amount)}` : fmt(amount);
  const size = big ? `ft-dmg tier-${dmgTier(amount)}${crit ? ' crit' : ''}` : 'ft-dmg-small';
  floatText(c.x + (Math.random() * 60 - 30), c.y - 40 - Math.random() * 30, label, size, 80, big ? 1100 : 700);
  anim(enemyArt, [{ transform: `translateX(${18 + level * 10}px) rotate(${2 + level}deg)`, filter: 'brightness(3) saturate(0)' }, { transform: 'none', filter: 'none' }], 240 + level * 40);
  setTimeout(() => enemyArt.classList.remove('hurt'), 200);
  refreshBars();
  refreshStatus();
  await wait(big ? 240 : 90);
}

async function hitPlayer(amount: number, blocked: number, src: string, hitIndex: number) {
  const heroArt = $('.hero-art', root!)!;
  const c = centerOf(heroArt);
  disp.php = Math.max(0, disp.php - amount);
  if (src !== 'blood') disp.shield = Math.max(0, disp.shield - blocked);
  if (blocked) { floatText(c.x + 40, c.y - 60, `格挡 ${fmt(blocked)}`, 'ft-shield', 40, 700); ring(c.x, c.y, '#45c9f5', 110); playSfx('shield'); }
  if (amount > 0) {
    const ratio = amount / Math.max(1, disp.pmax);
    shake(ratio >= 0.3 ? 3 : ratio >= 0.12 ? 2 : 1);
    if (src === 'enemy') flash('rgba(200,20,20,.28)', 180);
    burst(c.x, c.y, src === 'burn' ? '#ff5a2c' : '#ff3b2f', 18, 0.8);
    floatText(c.x + (hitIndex % 2 ? 30 : -30), c.y - 50 - hitIndex * 16, `-${fmt(amount)}`, 'ft-dmg-player', 60, 900);
    playSfx(src === 'burn' ? 'burn' : 'hit', 1);
    anim(heroArt, [{ transform: 'translateX(-24px)', filter: 'brightness(2) sepia(1) hue-rotate(-50deg) saturate(5)' }, { transform: 'none', filter: 'none' }], 240);
  }
  refreshBars();
  await wait(src === 'enemy' ? 170 : 120);
}

function banner(title: string, sub: string, rank: string) {
  const el = h(`div.banner.rank-${rank}`, null, h('div.banner-title.brush', null, title), h('div.banner-sub', null, sub));
  root!.appendChild(el);
  el.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scaleX(.2)' }, { opacity: 1, transform: 'translate(-50%,-50%) scaleX(1)', offset: 0.15 }, { opacity: 1, transform: 'translate(-50%,-50%) scaleX(1)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%,-50%) scaleX(1.1)' }], { duration: 1800 }).finished.then(() => el.remove(), () => el.remove());
}

async function endSequence() {
  const b = run().battle!;
  const won = b.outcome === 'won';
  const enemyArt = $('.enemy-art', root!)!;
  if (won) {
    await hitstop(260);
    playSfx('ko');
    flash('rgba(255,255,255,.8)', 260);
    shake(4);
    const c = centerOf(enemyArt);
    // Split the enemy along a diagonal sword line.
    const halves = ['polygon(0 0, 100% 0, 100% 38%, 0 62%)', 'polygon(0 62%, 100% 38%, 100% 100%, 0 100%)'].map((clip, i) => {
      const half = enemyArt.cloneNode() as HTMLElement;
      half.classList.add('half');
      half.style.clipPath = clip;
      enemyArt.parentElement!.appendChild(half);
      void anim(half, [{ transform: 'none', opacity: 1 }, { transform: i ? 'translate(40px, 60px) rotate(8deg)' : 'translate(-50px, -40px) rotate(-6deg)', opacity: 0, filter: 'brightness(.2)' }], 900, { fill: 'forwards', easing: 'cubic-bezier(.3,0,.7,1)' });
      return half;
    });
    enemyArt.style.visibility = 'hidden';
    const slash = h('div.kill-slash');
    root!.appendChild(slash);
    void anim(slash, [{ transform: 'translate(-50%,-50%) rotate(-14deg) scaleX(0)', opacity: 1 }, { transform: 'translate(-50%,-50%) rotate(-14deg) scaleX(1)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-50%) rotate(-14deg) scaleX(1)', opacity: 0 }], 700);
    slash.style.left = `${c.x}px`; slash.style.top = `${c.y}px`;
    burst(c.x, c.y, '#0b0d10', 40, 1.6, 'ink');
    burst(c.x, c.y, '#ffe4a8', 60, 2);
    playSfx('shatter');
    await wait(380);
    const seal = h('div.kill-seal.brush', null, '斩');
    root!.appendChild(seal);
    playSfx('stamp');
    await anim(seal, [{ transform: 'translate(-50%,-50%) scale(3) rotate(-20deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(.9) rotate(-8deg)', opacity: 1, offset: 0.5 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-8deg)', opacity: 1 }], 360, { fill: 'forwards' });
    if (b.bestHit > 0) {
      const best = b.bestHit > app.meta.bestHit && app.meta.bestHit > 0;
      const line = h(`div.kill-best${best ? '.record' : ''}`, null, best ? '新纪录 · ' : '本场最强一招 ', h('b', null, fmt(b.bestHit)));
      root!.appendChild(line);
      anim(line, [{ opacity: 0, transform: 'translate(-50%, 20px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], 300);
    }
    await wait(1100);
    halves.forEach(x => x.remove());
  } else {
    playSfx('defeat');
    root!.classList.add('defeated');
    await wait(1400);
  }
  setSkipping(false);
  busy = false;
  R.concludeBattle(run());
  if (run().stats.bestHit > app.meta.bestHit) { /* recorded at run end */ }
  save();
  render();
}

export { refreshAll as refreshBattle };
void RELIC;
