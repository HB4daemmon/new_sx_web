// Layout sweep for 山海劫 V3 (needs `npm run dev` and Playwright).
// A bot plays a few runs and snapshots every non-map screen state; each snapshot is loaded as a saved
// run at several viewports, and every button must be reachable: inside the stage, not covered, and not
// hidden behind an overflow the player cannot scroll. Optional arg: a screen-name prefix to limit the sweep.
import { launch, BASE } from './pw.mjs';
import * as R from '../../build/v3/core/run.js';
import { METHODS } from '../../build/v3/core/content.js';
import { playBattle } from './bot.mjs';
// Snapshot every screen state seen while a simple bot plays, keeping the "biggest" (longest JSON) per key.
const seen = {};
const keep = (run, key) => {
  const json = R.serialize(run);
  const k = `${key}`;
  seen[k] ??= [];
  seen[k].push(json);
};
for (const m of METHODS) for (let seed = 0; seed < 2; seed++) {
  const run = R.createRun({ seed: `cap-${seed}`, method: m.id });
  let steps = 0;
  while (!['won','lost'].includes(run.screen.name) && steps++ < 3000) {
    const s = run.screen;
    const key = s.name === 'event' ? `event-${s.resolved !== undefined ? 'resolved' : 'open'}` : s.name === 'rest' ? `rest-${s.done ? 'done' : 'open'}` : s.name;
    if (s.name !== 'map' && s.name !== 'battle') keep(run, key);
    switch (s.name) {
      case 'map': { const n = R.reachable(run); R.enterNode(run, n[steps % n.length].id); break; }
      case 'battle': if (steps % 7 === 0) keep(run, 'battle'); playBattle(run); break;
      case 'reward': if (!s.relicPicked) { if (!R.takeReward(run, 'relic', 0, run.relics.length >= run.relicSlots ? 0 : undefined)) s.relicPicked = true; } else if (!s.picked && s.options.length) R.takeReward(run, 'main', 0); else R.leaveReward(run); break;
      case 'breakthrough': R.chooseBreakthrough(run, 0); break;
      case 'story': R.leaveStory(run); break;
      case 'ending': keep(run, 'ending'); R.chooseEnding(run, 'return'); break;
      case 'shop': if (steps % 2) { R.startRemove(run); } else R.leaveShop(run); break;
      case 'rest': if (s.done) R.leaveRest(run); else R.restChoose(run, steps % 2 ? 'heal' : 'insight', R.insightChoices(run)[0]); break;
      case 'event': if (s.resolved !== undefined) R.leaveEvent(run); else { const before = JSON.stringify(run.screen); R.chooseEvent(run, 0); if (JSON.stringify(run.screen) === before) R.leaveEvent(run); } break;
      case 'pick-tile': R.pickTiles(run, run.bag.slice(0, s.count).map(t => t.uid)); break;
      default: console.error('unknown', s.name); steps = 1e9;
    }
  }
  if (['won','lost'].includes(run.screen.name)) keep(run, run.screen.name);
}
const out = {};
for (const [k, list] of Object.entries(seen)) {
  const sorted = [...new Set(list)].sort((a, b) => b.length - a.length);
  out[k] = [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted.at(-1)].filter((x, i, a) => x && a.indexOf(x) === i);
}

const snaps = out;
const only = process.argv[2];
const VPS = { landscape: [1366, 768], portrait: [390, 844], phone: [360, 640], short: [390, 664], wide: [844, 390] };
const b = await launch();
const fails = [];
for (const [vpn, [w, hgt]] of Object.entries(VPS)) {
  const p = await b.newPage({ viewport: { width: w, height: hgt } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE);
  for (const [key, list] of Object.entries(snaps)) {
    if (only && !key.startsWith(only)) continue;
    for (const [i, json] of list.entries()) {
      await p.evaluate(j => { localStorage.clear(); localStorage.setItem('shanhai-v3-meta', JSON.stringify({ speed: 2, sound: false, tutorialDone: true, runs: 1 })); localStorage.setItem('shanhai-v3-run', j); }, json);
      await p.reload();
      const cont = p.locator('.title-menu .btn.seal.big').first();
      if (!(await p.locator('#stage[data-screen]').count()) || await p.locator('.title-scr').count()) { if (await cont.count()) await cont.click(); }
      await p.waitForTimeout(700);
      // One-off notices (开路) sit on top until read.
      for (let k = 0; k < 3 && await p.locator('.overlay-close').count(); k += 1) { await p.locator('.overlay-close').first().click(); await p.waitForTimeout(150); }
      // Battle intros (boss dialogue, banners) are tap-through by design: read them first.
      for (let k = 0; k < 12 && await p.locator('.dialogue').count(); k += 1) { await p.locator('.dialogue').click(); await p.waitForTimeout(150); }
      await p.waitForFunction(() => !document.querySelector('.battle-scr.busy'), null, { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(300);
      const bad = await p.evaluate(() => {
        const stage = document.querySelector('#stage').getBoundingClientRect();
        const out = [];
        const userScrollable = el => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY + cs.overflowX); };
        for (const el of document.querySelectorAll('.screen-root button')) {
          const r0 = el.getBoundingClientRect();
          if (!r0.width || getComputedStyle(el).visibility === 'hidden' || el.closest('.hand, .lane')) continue;
          const saved = [];
          for (let a = el.parentElement; a; a = a.parentElement) saved.push([a, a.scrollTop, a.scrollLeft]);
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          let hiddenScroll = false;
          for (const [a, t, l] of saved) if ((a.scrollTop !== t || a.scrollLeft !== l) && !userScrollable(a)) hiddenScroll = true;
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
          const inStage = r.top >= stage.top - 2 && r.bottom <= stage.bottom + 2 && r.left >= stage.left - 2 && r.right <= stage.right + 2;
          if (hiddenScroll || !inStage || !(hit && (el.contains(hit) || hit.contains(el)))) out.push(`${el.className || el.textContent.trim().slice(0, 8)}${hiddenScroll ? '[clip]' : ''}${inStage ? '' : '[off]'}${hit && (el.contains(hit)) ? '' : '[covered:' + (hit?.className || hit?.tagName) + ']'}`);
          for (const [a, t, l] of saved) { a.scrollTop = t; a.scrollLeft = l; }
        }
        return [document.querySelector('#stage').dataset.screen, out];
      });
      if (bad[1].length) fails.push(`${vpn} ${key}#${i} (${bad[0]}): ${[...new Set(bad[1])].slice(0, 5).join(' | ')}`);
    }
  }
  if (errs.length) fails.push(`${vpn} page errors: ${errs.slice(0, 3).join(' | ')}`);
  await p.close();
}
await b.close();
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
console.log(`V3 screen sweep passed: ${Object.keys(snaps).length} screen states × ${Object.keys(VPS).length} viewports`);
