// End-to-end browser check for 山海劫 V3 (needs `npm run dev` and Playwright).
// Plays through the UI in landscape and portrait: title → method → map → a full
// battle by clicking tiles → reward → map, plus relic drag, keyboard and layout bounds.
import assert from 'node:assert/strict';
import { launch, BASE } from './pw.mjs';

const browser = await launch();
const problems = [];

async function inStage(page, label) {
  await page.waitForTimeout(450); // let the screen transition settle
  const out = await page.evaluate(() => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    const bad = [];
    for (const el of document.querySelectorAll('button, .tile, .relic, .enemy-plate, .hud')) {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('.overlay, .lane, .fx-canvas')) continue;
      // Inside a scroll area the player can swipe to it (test:screens checks that properly).
      if (el.closest('.panel-body, .md-body, .hand.scroll')) continue;
      if (r.left < stage.left - 2 || r.right > stage.right + 2 || r.top < stage.top - 2 || r.bottom > stage.bottom + 2) bad.push(`${el.className} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    return { bad, scrollW: document.documentElement.scrollWidth, w: innerWidth };
  });
  if (out.bad.length) problems.push(`${label}: outside stage → ${out.bad.slice(0, 4).join(' | ')}`);
  if (out.scrollW > out.w) problems.push(`${label}: page scrolls horizontally`);
}

async function playBattle(page, label) {
  for (let turn = 0; turn < 40; turn += 1) {
    const screen = await page.getAttribute('#stage', 'data-screen');
    if (screen !== 'battle') return screen;
    await page.waitForSelector('.battle-scr:not(.busy)', { timeout: 20000 }).catch(() => {});
    if ((await page.getAttribute('#stage', 'data-screen')) !== 'battle') continue;
    const count = await page.locator('.hand .tile').count();
    for (let i = 0; i < Math.min(5, count); i += 1) await page.locator('.hand .tile').nth(i).click();
    const rage = page.locator('.qi-gauge.full');
    if (await rage.count()) await rage.click();
    await page.click('[data-action="cast"]');
    // Tap through the animation (fast-forward).
    for (let k = 0; k < 6; k += 1) { await page.mouse.click(5, 5); await page.waitForTimeout(80); }
    await page.waitForFunction(() => !document.querySelector('.battle-scr.busy'), null, { timeout: 30000 }).catch(() => {});
  }
  throw new Error(`${label}: battle did not finish`);
}

for (const [label, viewport] of [['landscape', { width: 1366, height: 768 }], ['portrait', { width: 390, height: 844 }], ['phone-browser', { width: 360, height: 640 }], ['wide-phone', { width: 844, height: 390 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('shanhai-v3-meta', JSON.stringify({ speed: 2, sound: false, advise: true, tutorialDone: true, unlocked: ['yuhuo', 'jingang', 'benlei', 'huichun', 'zhulong'] })); });
  await page.reload();
  await page.waitForSelector('[data-action="new-run"]');
  await inStage(page, `${label} title`);
  await page.click('[data-action="new-run"]');
  // Every method's start button must be tappable in place (no hidden overflow blocking the flow).
  for (const id of await page.$$eval('.method-card:not(:disabled)', els => els.map(e => e.dataset.method))) {
    await page.click(`[data-method="${id}"]`);
    await page.waitForTimeout(350);
    const hit = await page.evaluate(() => {
      const go = document.querySelector('[data-action="start"]');
      const r = go.getBoundingClientRect();
      const s = document.querySelector('#stage').getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const body = document.querySelector('.md-body').getBoundingClientRect();
      const floats = body.bottom > r.top + 1 && body.right > r.left && body.left < r.right;
      return { ok: !!el && go.contains(el) && r.bottom <= s.bottom + 1 && r.top >= s.top - 1, floats };
    });
    if (!hit.ok) problems.push(`${label} select ${id}: start button not visible`);
    if (hit.floats) problems.push(`${label} select ${id}: start button floats over the method text`);
  }
  await page.click('[data-method="jingang"]');
  await inStage(page, `${label} select`);
  await page.click('[data-action="start"]');
  // 择命格: three 命格 on offer (or none); take the first one.
  await page.waitForSelector('.fate-pick');
  assert.equal(await page.locator('.fate-card').count(), 3, 'three 命格 on offer');
  await page.locator('.fate-card [data-fate]').first().click();
  // Act 1 opens on the story scroll; tap once to reveal everything, then set off.
  await page.waitForSelector('.story-scr');
  await inStage(page, `${label} story`);
  await page.click('.story-card');
  await page.click('.story-go');
  await page.waitForSelector('.map-node.reach');
  await inStage(page, `${label} map`);
  await page.locator('.map-node.reach').first().click();
  await page.waitForSelector('.battle-scr .hand .tile');
  await page.waitForTimeout(600);
  await inStage(page, `${label} battle`);
  // Keyboard: "1" selects the first tile, Escape clears.
  await page.keyboard.press('1');
  assert.equal(await page.locator('.hand .tile.sel').count(), 1, 'keyboard select');
  assert.ok((await page.textContent('.preview-line')).includes('伤害'), 'live preview shows the damage');
  assert.match(await page.textContent('.sp-qi b'), /^[\d,]+$/, 'score panel shows 气');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.hand .tile.sel').count(), 0);
  // 荐 picks tiles; the 役 it makes show up as tappable chips that open their rule; the enemy opens its intent.
  await page.click('[data-action="advise"]');
  assert.ok(await page.locator('.hand .tile.sel').count() >= 1, '荐 selects tiles');
  assert.ok(await page.locator('.sp-yaku .yk-chip, .sp-yaku .yk-none').count() >= 1, '役 chips');
  if (await page.locator('.sp-yaku .yk-chip').count()) {
    await page.locator('.sp-yaku .yk-chip').first().click();
    await page.waitForSelector('.info-card');
    await page.locator('.info-card .btn').click();
  }
  await page.locator('.enemy-plate').click();
  await page.waitForSelector('.info-card');
  assert.ok((await page.textContent('.info-card')).includes('这一回合'), 'enemy intent panel');
  await page.locator('.info-card .btn').click();
  await page.waitForFunction(() => !document.querySelector('.info-card') && !document.querySelector('.overlay-root')?.childElementCount);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.hand .tile.sel').count(), 0, 'selection cleared before the scripted fight');
  const end = await playBattle(page, label);
  assert.ok(['reward', 'lost'].includes(end), `${label}: battle ended on ${end}`);
  if (end === 'reward') {
    await inStage(page, `${label} reward`);
    await page.locator('.reward .card:not(:disabled)').first().click();
    await page.click('[data-action="continue"]');
    await page.waitForSelector('.map-node.reach');
    // Relic drag: give two relics, drag the first onto the second slot.
    await page.evaluate(() => {
      const run = JSON.parse(localStorage.getItem('shanhai-v3-run'));
      run.relics = ['huwen', 'taotie'];
      localStorage.setItem('shanhai-v3-run', JSON.stringify(run));
    });
    await page.reload();
    await page.click('.title-menu .btn.seal');
    await page.waitForSelector('.relic[data-relic="huwen"]');
    const a = await page.locator('.hud .relic[data-relic="huwen"]').boundingBox();
    const b = await page.locator('.hud .relic[data-relic="taotie"]').boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    const order = await page.evaluate(() => JSON.parse(localStorage.getItem('shanhai-v3-run')).relics);
    assert.deepEqual(order, ['taotie', 'huwen'], `${label}: relic drag reorders`);
  }
  if (errors.length) problems.push(`${label}: page errors ${errors.join(' / ')}`);
  console.log(`${label}: ok (${end})`);
  await page.close();
}
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('V3 browser check passed');
