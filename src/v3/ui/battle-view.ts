import { canRage, rageCost, defense, enemyAttack, endlessLimit, MAX_CAST, previewCast, swordDamage, tribulationStart, type BEvent, type CastOutcome } from '../core/battle.js';
import { DODGE_CAP, METHOD, RAGES, REDUCE_CAP, RELIC, SPECIALS } from '../core/content.js';
import { counterOf, EL_NAME, KE, type El } from '../core/elements.js';
import { ACTS, ENEMY } from '../core/enemies.js';
import { COMBOS, fanTier, PATTERNS, PATTERN_ORDER, QI_PER_FAN, YAKU, YAKU_ORDER, HETU } from '../core/patterns.js';
import { dangerous, recommend, type AdviceMode } from '../core/advisor.js';
import { MOD_DESC, TALENT, TIER_NAME } from '../core/content.js';
import type { YakuId } from '../core/types.js';
import { BOND, BOSS_STORY, LORE } from '../core/story.js';
import * as R from '../core/run.js';
import type { CastResult, Step } from '../core/score.js';
import type { Move, RunState, Tile } from '../core/types.js';
import { anim, burst, centerOf, comet, EL_COLOR, flash, floatText, hitstop, isSkipping, lightning, reducedMotion, ring, setSkipping, shake, wait } from './fx.js';
import { $, $$, fmt, fmt1, h } from './h.js';
import { app, overlayOpen, render, save, showOverlay, toast } from './main.js';
import { announce, art, fateText, hud, showBag, showHelp } from './screens.js';
import { checkAchievements } from './progression.js';
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
    h('div.hero-wrap', { onclick: (e: Event) => { if (!busy) { e.stopPropagation(); showSelfInfo(); } }, title: '点击查看自身状态' },
      h('img.hero-art', { src: art(`hero-${r.method}`), alt: METHOD[r.method].name }),
      h('div.hero-shield'),
      h('div.hero-status'),
      h('div.hero-bar')),
    h('div.enemy-wrap', { onclick: (e: Event) => { if (!busy) { e.stopPropagation(); showEnemyInfo(); } }, title: '点击查看敌人意图与弱点' },
      h('div.enemy-intent'),
      h('img.enemy-art', { src: art(enemy.art), alt: enemy.name }),
      h('div.enemy-status')),
    h('div.enemy-plate', { onclick: (e: Event) => { if (!busy) { e.stopPropagation(); showEnemyInfo(); } } },
      h('div.enemy-name', null, h('span.e-el'), h('b', null, enemy.name), h('small', null, enemy.title)),
      h('div.enemy-bar'),
      enemy.traitText ? h('div.enemy-trait', null, enemy.traitText) : null,
      null),
    h('div.wheel-slot'),
    h('div.turn-tag'),
    h('div.score-panel', null,
      h('div.sp-pattern', null, '　'),
      h('div.sp-row', null, h('div.sp-box.sp-qi', null, h('small', null, '气'), h('b', null, '0')), h('span.sp-x', null, '×'), h('div.sp-box.sp-mult', null, h('small', null, '倍'), h('b', null, '0'))),
      h('div.sp-dmg'),
      h('div.sp-yaku')),
    h('div.lane'),
    h('div.hand-area', null, h('div.preview-line'), h('div.hand')),
    h('div.controls', null,
      h('button.qi-gauge', { type: 'button', 'data-action': 'rage', title: `怒技「${RAGES[r.method]?.name ?? '怒技'}」：${RAGES[r.method]?.desc ?? '本招 ×3'}\n剑意攒够即可开启 · 快捷键 R`, onclick: () => toggleRage() }, h('div.qi-fill'), h('div.qi-mark'), h('span.qi-text')),
      h('button.btn.seal.cast-btn', { type: 'button', 'data-action': 'cast', onclick: () => void doCast() }, h('span.cast-main', null, '出招'), h('small.cast-sub')),
      h('button.btn.ink.discard-btn', { type: 'button', 'data-action': 'discard', onclick: () => void doDiscard() }, '换符', h('small.discard-left'))),
    h('div.pile-dock', null,
        h('button.pile-btn.advise', { type: 'button', 'data-action': 'advise', title: '推荐出牌：再点一次换成另一种思路', onclick: () => advise() }, '荐', h('small', null, '推荐')),
        h('button.pile-btn', { type: 'button', onclick: () => showBag(r), title: '查看符袋' }, h('span.pile-draw'), h('small', null, '待抽')),
        h('button.pile-btn.sort', { type: 'button', title: '整理手牌', onclick: () => { sortMode = sortMode === 'el' ? 'v' : 'el'; renderHand(); } }, '理'),
        h('button.pile-btn', { type: 'button', title: '诀谱', onclick: () => showHelp() }, '谱')),
    hud(r, { battle: true }));
  container.appendChild(root);
  root.addEventListener('pointerdown', () => { if (busy && !cinematic) setSkipping(true); });
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
  const b = battle();
  const enemy = ENEMY[b.enemyId];
  const art = $('.enemy-art', root!);
  void anim(art, [{ transform: 'translateX(120px) scale(.9)', opacity: 0, filter: 'brightness(4)' }, { transform: 'none', opacity: 1, filter: 'none' }], 520);
  const fresh = b.turn === 1 && b.castCount === 0;
  if (enemy.rank === 'boss' && fresh && BOSS_STORY[enemy.id]) {
    busy = true;
    refreshControls();
    await dialogue(enemy.name, BOSS_STORY[enemy.id].before);
    busy = false;
    refreshControls();
  }
  if (enemy.rank !== 'fight') {
    playSfx('stamp');
    banner(enemy.rank === 'boss' ? enemy.name : `精英 · ${enemy.name}`, enemy.title, enemy.rank);
  }
  if (fresh && b.assists?.length) {
    busy = true;
    refreshControls();
    await wait(900);
    for (const id of b.assists) await assist(id);
    syncDisp();
    refreshAll();
    busy = false;
    refreshControls();
  }
}

/** Tap-through dialogue box; resolves when every line has been read. */
function dialogue(speaker: string, lines: string[]): Promise<void> {
  return new Promise(resolve => {
    let i = 0;
    const text = h('p.dlg-text');
    const box = h('div.dialogue', null, h('div.dlg-name.brush', null, speaker), text, h('small.dlg-more', null, '点击继续 ▸'));
    const show = () => { text.textContent = lines[i]; anim(text, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 260); };
    const next = (e?: Event) => {
      e?.stopPropagation();
      i += 1;
      if (i >= lines.length) { window.removeEventListener('keydown', key, true); box.remove(); resolve(); return; }
      playSfx('click');
      show();
    };
    const key = (e: KeyboardEvent) => { if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); next(); } };
    box.addEventListener('click', next);
    window.addEventListener('keydown', key, true);
    root!.appendChild(box);
    show();
  });
}

async function assist(id: string) {
  const def = BOND[id];
  if (!def) return;
  playSfx('reward');
  const card = h('div.assist-card', null, h('div.assist-glyph.brush', null, def.glyph), h('div.assist-body', null, h('b', null, `因缘 · ${def.name}`), h('p', null, def.assistLine), h('small', null, def.assist)));
  root!.appendChild(card);
  await anim(card, [{ opacity: 0, transform: 'translate(-50%, 30px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], 320, { fill: 'forwards' });
  const e = centerOf($('.enemy-art', root!)), p = centerOf($('.hero-art', root!));
  if (id === 'houyi') { await comet({ x: p.x, y: p.y - 80 }, e, '#f6d36b', 260, 30); flash(); shake(3); burst(e.x, e.y, '#fff4d6', 40, 1.4); playSfx('heavy'); }
  if (id === 'tieshan') { burst(e.x, e.y, '#ff5a2c', 60, 1.2, 'ember'); playSfx('burn'); }
  if (id === 'shennong') { ring(p.x, p.y, '#4fdc8e', 140); ring(p.x, p.y, '#45c9f5', 170); playSfx('heal'); }
  if (id === 'nezha') { burst(p.x, p.y, '#c86cff', 40, 1, 'ember'); playSfx('rage'); }
  if (id === 'jingwei' || id === 'yu') { ring(e.x, e.y, '#45c9f5', 180); playSfx('shield'); }
  await wait(1500);
  await anim(card, [{ opacity: 1 }, { opacity: 0 }], 260, { fill: 'forwards' });
  card.remove();
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
    disp.eburn > 0 ? h('span.st.st-burn', { title: `灼烧：敌方回合开始时受到 层数×${1 + run().realm} 伤害` }, '焰 ', fmt(disp.eburn)) : null,
    battle().enemy.charged ? h('span.st.st-charge', { title: '蓄势：下一次攻击伤害翻倍' }, '蓄势') : null,
    battle().enemy.atkBonus > 0 ? h('span.st.st-buff', { title: '战意：攻击伤害提高' }, '怒 +', String(battle().enemy.atkBonus)) : null));
  const hs = $('.hero-status', root!)!;
  const b = battle();
  hs.replaceChildren(...nn(
    disp.pburn > 0 ? h('span.st.st-burn', null, '焰 ', String(disp.pburn)) : null,
    b.swords > 0 ? h('span.st.st-sword', { title: `飞剑：每次出招后齐射，每柄 ${swordDamage(run())} + 本招伤害的 6%` }, '剑 ×', String(b.swords)) : null,
    b.spring > 0 ? h('span.st.st-spring', { title: '春华：下一招计入气' }, '春 ', fmt(b.spring)) : null,
    b.stacks.thunder ? h('span.st.st-thunder', { title: '雷引：本场倍率永久提高' }, '雷 +', String(b.stacks.thunder)) : null,
    run().fate === 'xingxiu' && b.stacks.star !== undefined ? h('span.st.st-star', { title: '星宿命：本场这一路的番 ×2' }, '宿·', ...[b.stacks.star, b.stacks.star2].filter(x => x !== undefined).map(x => PATTERNS[PATTERN_ORDER[x!]].name).join('、')) : null,
    b.stacks.wheel ? h('span.st.st-wheel', { title: `命运轮盘：本回合转出 ${b.stacks.wheel}，本招有几张 ${b.stacks.wheel} 点的符，番就 ×几` }, '轮 ', String(b.stacks.wheel)) : null,
    b.stacks.omen !== undefined && run().relics.includes('tianjiqian') ? h('span.st.st-omen', { title: `天机签：本回合「吉」为${EL_NAME[(['mu', 'huo', 'tu', 'jin', 'shui'] as El[])[b.stacks.omen]]}，每张 +1 番` }, '吉·', EL_NAME[(['mu', 'huo', 'tu', 'jin', 'shui'] as El[])[b.stacks.omen]]) : null));
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
  // 无尽·限时斩敌: the countdown is the whole fight.
  const limit = run().endless ? endlessLimit(run()) - b.turn : null;
  $('.turn-tag', root!)!.replaceChildren(h('b', null, `第 ${b.turn} 回合`),
    limit !== null && left <= 0 ? h('small.tribulation', null, limit > 0 ? `限时 · 余 ${limit + 1} 回合` : '限时 · 最后一回合')
      : left > 0 ? h('small', null, `天劫 ${left} 回合后`) : h('small.tribulation', null, `天劫 · ${b.turn - start + 1} 重`));
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
  const rageName = RAGES[r.method]?.name ?? '怒技';
  $('.qi-text', root!)!.textContent = canRage(b) ? (rageOn ? `${rageName}·开` : rageName) : `剑意 ${Math.floor(disp.qi)}/${rageCost(b)}`;
  $('.qi-mark', root!)!.style.setProperty('--mark', `${rageCost(b)}%`);
  $('.discard-left', root!)!.textContent = r.vow === 'juenian' ? '绝念' : `余 ${b.discardsLeft}`;
  ($('.discard-btn', root!) as HTMLButtonElement).disabled = busy || b.discardsLeft <= 0;
  $('.discard-btn', root!)!.firstChild!.textContent = selected.length ? '换符' : '全换';
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
    const el = tileView(tile, { onclick: () => toggleTile(tile.uid) });
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
  fitHand();
  if (dealIn) for (let i = 0; i < tiles.length; i += 1) setTimeout(() => playSfx('draw'), i * 45);
  refreshPreview();
}

/** Big hands (talents, events, vows) first shrink the tiles down to HAND_MIN_ZOOM; past that the row scrolls sideways. */
const HAND_MIN_ZOOM = 0.72;
function fitHand() {
  const hand = root && $('.hand', root);
  const first = hand?.firstElementChild as HTMLElement | null;
  if (!hand || !first) return;
  hand.style.setProperty('--hand-zoom', '1');
  const n = hand.childElementCount;
  const gap = parseFloat(getComputedStyle(hand).columnGap) || 0;
  const room = hand.parentElement!.clientWidth - 8;
  // Only the tiles zoom; the gaps between them stay fixed.
  const zoom = Math.max(HAND_MIN_ZOOM, Math.min(1, (room - (n - 1) * gap) / (n * first.offsetWidth)));
  hand.style.setProperty('--hand-zoom', zoom.toFixed(3));
  hand.classList.toggle('scroll', n * first.offsetWidth * zoom + (n - 1) * gap > room + 1);
}
window.addEventListener('resize', () => requestAnimationFrame(fitHand));

function toggleTile(uid: number) {
  if (busy) return;
  if (selected.includes(uid)) selected = selected.filter(x => x !== uid);
  else if (selected.length < MAX_CAST) selected.push(uid);
  else { toast('一招至多五枚符'); return; }
  playSfx('select');
  renderHand();
}

function toggleRage() {
  if (busy || !canRage(battle())) { if (!canRage(battle())) toast(`剑意未满（需 ${rageCost(battle())}）`); return; }
  rageOn = !rageOn;
  playSfx(rageOn ? 'rage' : 'click');
  refreshControls();
  refreshPreview();
}

function refreshPreview() {
  if (!root) return;
  const line = $('.preview-line', root)!;
  const r = run(), b = battle();
  if (!selected.length) {
    line.replaceChildren(h('span.dim', null, r.stats.casts < 4 ? '点选 1–5 张成役，不看顺序 · 不会出就点「荐」' : '点选 1–5 张符'));
    setScore(null);
    refreshControls();
    return;
  }
  const res = previewCast(r, b, selected, rageOn);
  if (!res) return;
  const effects: string[] = [];
  if (res.shield) effects.push(`盾+${res.shield}`);
  if (res.heal) effects.push(`血+${res.heal}（挨打后）`);
  if (res.burn) effects.push(`焰+${res.burn}`);
  if (res.critChance > 5) effects.push(`暴击 ${Math.round(res.critChance)}%`);
  const lethal = res.damage >= b.enemy.hp + (b.enemy.armor || 0);
  // The score panel already shows 气 × 番 and the 役: the line only adds the result and side effects.
  line.replaceChildren(...nn(
    h('span.pv-calc', null, '伤害 ', h('b.pv-dmg', null, fmt(res.damage))),
    effects.length ? h('span.pv-fx', null, effects.join(' · ')) : null,
    lethal ? h('span.pv-kill', null, '斩！') : null));
  setScore(res);
  refreshControls();
}

function setScore(res: CastResult | null) {
  const panel = $('.score-panel', root!)!;
  panel.classList.toggle('preview', !!res);
  // The big 役 stamp is for the cast animation; while aiming, the chips below say it all.
  $('.sp-pattern', panel)!.textContent = '　';
  $('.sp-qi b', panel)!.textContent = res ? fmt(res.qi) : '0';
  $('.sp-mult b', panel)!.textContent = res ? fmt1(res.mult) : '0';
  $('.sp-dmg', panel)!.textContent = '';
  $('.sp-yaku', panel)!.replaceChildren(...(res ? yakuChips(res) : []));
}

/** Tappable 役 chips: what this cast scores, each opens its rule. */
function yakuChips(res: CastResult): HTMLElement[] {
  const chip = (label: string, fan: number, onclick: () => void, cls = '') => h(`button.yk-chip${cls}`, { type: 'button', onclick: (e: Event) => { e.stopPropagation(); onclick(); } }, label, h('i', null, `${fan}番`));
  const out = res.yaku.map(y => chip(YAKU[y.id].name, y.fan, () => showYakuInfo(y.id, res), YAKU[y.id].path === 'tian' ? '.tian' : YAKU[y.id].path === 'ben' ? '.ben' : ''));
  const bao = res.tiles.filter(t => t.mod === 'bao').length;
  if (!res.analysis.tian && bao) out.push(chip('宝符', bao, () => showModInfo('bao')));
  if (!res.analysis.tian && res.analysis.dewei) out.push(chip('得位', res.analysis.dewei, () => showDeweiInfo()));
  if (!out.length) out.push(h('span.yk-none', null, '散牌 · 没有成役'));
  return out;
}

function onKey(e: KeyboardEvent) {
  if (!root || overlayOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (busy) { if ((e.key === ' ' || e.key === 'Enter') && !cinematic) { setSkipping(true); e.preventDefault(); } return; }
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
  if (busy || b.discardsLeft <= 0) return;
  // Nothing selected: swap the whole hand.
  if (!selected.length) selected = b.hand.map(t => t.uid);
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
  const dealt = out.events.reduce((sum, e) => sum + (e.k === 'hit' && e.to === 'enemy' ? e.amount : 0), 0);
  const achieved = checkAchievements(app.meta, { kind: 'cast', run: r, battle: r.battle!, result: out.result, total: dealt, killed: r.battle!.outcome === 'won' });
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
  announce(achieved);
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
  if (res.rage) { setSkipping(false); await real(120); }
  await comet(mid, target, res.rage ? '#ff8a3a' : color, res.rage ? 320 : 200, res.rage ? 90 : 34);
  if (res.rage) rageImpact = true;
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
      const tier = fanTier(res.fan, !!res.analysis.tian);
      p.className = `sp-pattern tier-${tier}`;
      setVals();
      playSfx('stamp');
      if (tier >= 4) { shake(2); flash('rgba(255,220,150,.25)', 220); }
      await anim(p, [{ transform: 'scale(2.4) rotate(-6deg)', opacity: 0 }, { transform: 'scale(.92)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }], 300);
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
      if (step.dMult || step.x) floatText(c.x + 30, c.y + 50, step.x ? `×${fmt1(step.x)}` : `+${fmt1(step.dMult!)}番`, 'ft-fx ft-mult', 20, 600);
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
      if (step.k === 'bonus' && step.index !== undefined && clones[step.index]) { c = centerOf(clones[step.index]); c.y -= 120; ring(c.x, c.y + 120, '#ffe7a1', 70); }
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
      const c = centerOf(multB);
      floatText(c.x, c.y - 70, step.label, 'ft-rage', 30, 1200);
      multB.parentElement?.animate([{ transform: 'scale(2.2)', filter: 'brightness(3)' }, { transform: 'scale(1)', filter: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
      playSfx('xmult');
      shake(3);
      await real(450);
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

/** The 怒技 cut-in runs on real time: speed settings and tap-to-skip never rush it. */
let cinematic = false;
const real = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function rageCutIn() {
  const r = run();
  const m = METHOD[r.method];
  cinematic = true;
  setSkipping(false);
  playSfx('rage');
  const dim = h('div.cutin-dim');
  root!.appendChild(dim);
  dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'forwards' });
  await real(260);
  const hero = h('img.cutin-hero', { src: art(`hero-${r.method}`), alt: '' });
  const word = h('div.cutin-text.brush', null, '怒');
  const sub = h('div.cutin-sub.brush', null, RAGES[r.method]?.name ?? `${m.title} · 剑诀`);
  const cut = h('div.cutin', null, hero, word, sub);
  root!.appendChild(cut);
  cut.animate([{ clipPath: 'inset(50% 0 50% 0)' }, { clipPath: 'inset(16% 0 16% 0)' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' });
  hero.animate([{ transform: 'translateX(-60%) scale(1.1)', opacity: 0 }, { transform: 'translateX(0) scale(1)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' });
  await real(380);
  word.animate([{ transform: 'scale(3.2) rotate(-12deg)', opacity: 0 }, { transform: 'scale(.92) rotate(-4deg)', opacity: 1, offset: 0.7 }, { transform: 'scale(1) rotate(-4deg)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.3,0,.4,1)', fill: 'forwards' });
  await real(220);
  playSfx('ko');
  flash('rgba(255,255,255,.7)', 200);
  shake(4);
  const c = centerOf(word);
  burst(c.x, c.y, '#ffb347', 70, 2);
  ring(c.x, c.y, '#ff6a3d', 260);
  sub.animate([{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' }], { duration: 300, fill: 'forwards' });
  await real(700);
  cut.animate([{ clipPath: 'inset(16% 0 16% 0)', opacity: 1 }, { clipPath: 'inset(50% 0 50% 0)', opacity: 0 }], { duration: 260, fill: 'forwards' });
  dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
  await real(260);
  cut.remove();
  setTimeout(() => dim.remove(), 400);
  cinematic = false;
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
      if (!ev.n) ring(from.x, from.y, '#45c9f5', 160);
      toast(ev.n ? `${ev.n} 枚浊符混入你的符袋` : '精卫的石子填住了劫云——浊符没有落下', ev.n ? 'bad' : '');
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
    case 'dodge': {
      const c = centerOf(heroArt);
      floatText(c.x + (ev.hitIndex ?? 0) * 30, c.y - 70, '闪', 'ft-shield', 46, 600);
      await anim(heroArt, [{ transform: 'translateX(0)' }, { transform: 'translateX(-28px)' }, { transform: 'translateX(0)' }], 260);
      return;
    }
    case 'save': {
      const c = centerOf(heroArt);
      disp.php = ev.hp;
      floatText(c.x, c.y - 60, ev.name, 'ft-heal', 40, 1100);
      burst(c.x, c.y, '#4fdc8e', 26, 1, 'ember');
      playSfx('heal');
      refreshBars();
      await wait(400);
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
    case 'seed': {
      const sp = SPECIALS[ev.sp as keyof typeof SPECIALS];
      const from = centerOf(heroArt), to = centerOf($('.pile-btn', root!));
      await Promise.all(Array.from({ length: ev.n }, (_, i) => wait(i * 120).then(() => comet(from, to, EL_COLOR[sp.el], 360, 30))));
      toast(`${ev.n} 枚本门符「${sp.name}」化入待抽符堆`, 'ach');
      return;
    }
    case 'draw': return;
    case 'win': case 'lose': return;
  }
}

let rageImpact = false;
async function hitEnemy(amount: number, blocked: number, src: string, crit: boolean) {
  const rageHit = rageImpact && src === 'cast';
  if (rageHit) rageImpact = false;
  const enemyArt = $('.enemy-art', root!)!;
  const c = centerOf(enemyArt);
  const ratio = (amount + blocked) / Math.max(1, disp.emax);
  disp.ehp = Math.max(0, disp.ehp - amount);
  if (blocked) { disp.armor = Math.max(0, disp.armor - blocked); floatText(c.x - 60, c.y - 30, `破甲 ${fmt(blocked)}`, 'ft-armor', 50, 800); burst(c.x, c.y, '#d9e2ea', 14, 0.8); }
  const big = src === 'cast' || src === 'detonate';
  const level = !big ? 1 : ratio >= 0.5 ? 4 : ratio >= 0.25 ? 3 : ratio >= 0.1 ? 2 : 1;
  enemyArt.classList.add('hurt');
  if (rageHit) { flash('rgba(255,140,60,.6)', 260); await real(260); }
  else if (big) await hitstop(40 + Math.min(220, ratio * 420));
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
  announce(checkAchievements(app.meta, { kind: 'battle', run: run(), battle: b }));
  R.concludeBattle(run());
  if (run().stats.bestHit > app.meta.bestHit) { /* recorded at run end */ }
  save();
  render();
}

export { refreshAll as refreshBattle };
void RELIC;

// —— 点开就能看：役、敌人、自身 ——
function infoCard(...children: (HTMLElement | string | null)[]) {
  const close = showOverlay(h('div.info-card', null, ...children.filter(c => c !== null) as (HTMLElement | string)[], h('button.btn.ink.small', { type: 'button', onclick: () => close() }, '知道了')));
}

/** One 役: what it is, what it is worth here, and the rest of its 路 (only the best one counts). */
function showYakuInfo(id: YakuId, res?: CastResult) {
  const def = YAKU[id];
  const r = run();
  const got = res?.yaku.find(y => y.id === id);
  if (def.path === 'ben') {
    const own = YAKU_ORDER.filter(y => YAKU[y].method === def.method);
    infoCard(
      h('h3.brush', null, def.name, h('small', null, `　${METHOD[def.method!]?.name ?? ''} · 本门役`)),
      h('p', null, def.desc),
      h('p.info-num', null, `${def.fan} 番${got ? `　→ 本招 ${got.fan} 番，另带 ${got.fan * QI_PER_FAN} 气` : ''}`),
      h('p.dim', null, '本门役是功法自己的一路：看战况而不只看牌面，与其他各路的番相加；同样只算最高的一个，不受心法加成。'),
      h('div.info-list', null, ...own.map(y => h(`div.info-row.ben${y === id ? '.on' : ''}`, null, h('b', null, YAKU[y].name), h('span', null, YAKU[y].desc), h('i', null, `${YAKU[y].fan}番`)))));
    return;
  }
  const path = def.path === 'tian' ? null : PATTERNS[def.path];
  const lv = path ? r.patternLv[path.id] ?? 1 : 1;
  const siblings = YAKU_ORDER.filter(y => YAKU[y].path === def.path);
  infoCard(
    h('h3.brush', null, def.name, h('small', null, `　${def.alias}`)),
    h('p', null, def.desc),
    h('p.info-num', null, path
      ? `${def.fan} 番${lv > 1 ? ` ＋ 心法「${path.name}」${lv}重 ${lv - 1} 番` : ''}${got ? `　→ 本招 ${got.fan} 番，另带 ${got.fan * QI_PER_FAN} 气` : ''}`
      : `天成：倍率直接 ${def.fan} 番，不再与其他役相加`),
    path ? h('p.dim', null, `「${path.name}」路（${path.alias}）只算最高的一个役；不同路的番相加。`) : null,
    h('div.info-list', null, ...siblings.map(y => h(`div.info-row${y === id ? '.on' : ''}`, null, h('b', null, YAKU[y].name), h('small', null, YAKU[y].alias), h('span', null, YAKU[y].desc), h('i', null, `${YAKU[y].fan}番`)))));
}

function showModInfo(mod: string) {
  infoCard(h('h3.brush', null, `${{ ling: '灵', huan: '幻', bao: '宝', lei: '倍' }[mod] ?? ''}符`), h('p', null, MOD_DESC[mod] ?? ''));
}

function showDeweiInfo() {
  infoCard(h('h3.brush', null, '得位', h('small', null, '　宝牌')),
    h('p', null, `点数合该元素的河图数，每张 +1 番（另带 ${QI_PER_FAN} 气），与各路的役叠加。`),
    h('div.info-list', null, ...(Object.entries(HETU) as [El, number][]).map(([el, n]) => h('div.info-row', null, h('b', { class: `el-text-${el}` }, EL_NAME[el]), h('span', null, `${n} 或 ${n + 5}`)))));
}

/** Enemy: this turn's intent in full, what is coming next, its element and how to break it. */
function showEnemyInfo() {
  const r = run(), b = battle();
  const def = ENEMY[b.enemyId];
  const e = b.enemy;
  const moves = e.phase === 2 && def.phase2 ? def.phase2.moves : def.moves;
  const counter = counterOf(e.el), weak = KE[e.el];
  infoCard(
    h('h3.brush', null, def.name, h('small', null, `　${def.title}`)),
    LORE[b.enemyId] ? h('p.dim', null, LORE[b.enemyId]) : null,
    h('p.info-num', null, `气血 ${fmt(e.hp)} / ${fmt(e.maxHp)}`, e.armor ? `　护甲 ${fmt(e.armor)}` : '', e.burn ? `　灼烧 ${fmt(e.burn)}` : ''),
    h('div.info-sec', null, h('b', null, '这一回合：'), intentTitle(e.intent).replace(/\n/g, '；')),
    h('div.info-list', null, ...moves.map((m, i) => h(`div.info-row${i === e.moveIndex ? '.on' : ''}`, null, h('b', null, m.name), h('span', null, intentTitle(m).split('\n').slice(1).join('；') || '—')))),
    h('p.dim', null, '招式按顺序循环，亮起的是这一回合。'),
    h('div.info-sec', null, h('b', null, `属${EL_NAME[e.el]}：`), `${EL_NAME[counter]}符克它，点数 ×2；三张以上成「破阵」。${EL_NAME[weak]}符被它克，点数 ×0.5。`),
    e.charged ? h('div.info-sec', null, h('b', null, '蓄势：'), '下一次攻击翻倍。') : null,
    e.atkBonus ? h('div.info-sec', null, h('b', null, '战意：'), `攻击 +${e.atkBonus}。`) : null,
    def.traitText ? h('div.info-sec', null, h('b', null, '特性：'), def.traitText) : null,
    h('div.info-sec', null, h('b', null, '天劫：'), `第 ${tribulationStart(r)} 回合起天雷劈向双方，一重比一重狠。`),
    r.endless ? h('div.info-sec', null, h('b', null, '限时斩敌：'), `无尽天劫中，第 ${endlessLimit(r)} 回合结束时还没斩敌，天劫转而落到你身上（渡劫失败）。天劫每重劈去敌人气血上限的 4%，累计至多 60%，剩下的要靠自己。`) : null);
}

/** Self: HP, shield and every running counter, with what each does. */
function showSelfInfo() {
  const r = run(), b = battle();
  const m = METHOD[r.method];
  const rows: [string, string][] = [
    ['气血', `${fmt(b.player.hp)} / ${fmt(b.player.maxHp)}`],
    ['护盾', b.player.shield ? `${fmt(b.player.shield)}：在挨打前抵挡伤害${r.method === 'jingang' ? '（金刚功：护盾不散）' : '，回合开始时清空'}` : '没有。水符出招时获得护盾'],
    ['剑意', `${Math.floor(b.qi)} / ${rageCost(b)}：攒满开「${RAGES[r.method]?.name ?? '怒技'}」—${RAGES[r.method]?.desc ?? '本招 ×3'}`],
    ['换符', r.vow === 'juenian' ? '绝念：不能换符' : `本回合还能换 ${b.discardsLeft} 次`],
  ];
  if (b.player.burn) rows.push(['灼烧', `${b.player.burn}：回合开始时受到伤害，之后减半`]);
  if (b.swords) rows.push(['飞剑', `${b.swords} 柄：每次出招后齐射，每柄 ${swordDamage(r)} + 本招伤害的 6%`]);
  if (b.spring) rows.push(['春华', `${fmt(b.spring)}：下一招计入气`]);
  if (b.stacks.thunder) rows.push(['雷引', `本场倍率永久 +${b.stacks.thunder}`]);
  const d = defense(r, b);
  if (d.reduce) rows.push(['减伤', `受到敌人的伤害 −${d.reduce}%（上限 ${REDUCE_CAP}%）`]);
  if (d.dodge) rows.push(['闪避', `敌人每一击 ${d.dodge}% 机会闪开（上限 ${DODGE_CAP}%）`]);
  if (b.stacks.pendingHeal) rows.push(['待回复', `${b.stacks.pendingHeal}：敌人出手后回复`]);
  if (b.stacks.wheel) rows.push(['命运轮盘', `本回合转出 ${b.stacks.wheel}：本招有几张 ${b.stacks.wheel} 点的符，番就 ×几`]);
  if (r.relics.includes('tianjiqian') && b.stacks.omen !== undefined) rows.push(['天机签', `本回合「吉」为${EL_NAME[(['mu', 'huo', 'tu', 'jin', 'shui'] as El[])[b.stacks.omen]]}：每张 +1 番`]);
  if (r.talents.includes('kongling')) rows.push(['空灵根', '每回合手里随机一张符化为灵符']);
  if (r.fate) rows.push(['命格', fateText(r).replace(/\n/g, '；')]);
  if (r.talents.length) rows.push(['天赋', r.talents.map(id => `${TALENT[id]?.name ?? id}（${TIER_NAME[TALENT[id]?.tier ?? 'common']}）`).join('、')]);
  infoCard(
    h('h3.brush', null, m.name, h('small', null, `　${m.title}`)),
    h('div.info-list', null, ...rows.map(([k, v]) => h('div.info-row', null, h('b', null, k), h('span', null, v)))),
    h('div.info-sec', null, h('b', null, '功法：'), m.passive.join('；')));
}

// —— 荐 ——
let adviceTurn = -1;
let adviceMode: AdviceMode = 'max';
/** Picks the tiles for the player. First tap: the safer play if a heavy blow is coming, else max damage; tap again to flip. */
function advise() {
  if (busy) return;
  const r = run(), b = battle();
  const key = b.turn * 100 + b.castsThisTurn;
  adviceMode = adviceTurn === key ? (adviceMode === 'max' ? 'safe' : 'max') : dangerous(r, b) ? 'safe' : 'max';
  adviceTurn = key;
  const advice = recommend(r, b, adviceMode, rageOn);
  if (!advice) return;
  selected = advice.uids;
  playSfx('select');
  renderHand();
  const res = advice.result;
  const why = res.yaku.length ? res.yaku.map(y => YAKU[y.id].name).join('＋') : '散牌';
  void why;
  toast(advice.lethal ? '荐：可以斩杀' : adviceMode === 'safe' ? '荐：稳妥（再点换最高伤害）' : '荐：最高伤害（再点换稳妥）');
}
