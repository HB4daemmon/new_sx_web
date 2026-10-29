import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const replayKey = 'suishi-shanhai-replay-v2-overhaul';
const screenshotDir = process.env.SCREENSHOT_DIR || '/tmp/shanhai-v2-overhaul-browser';
const viewports = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
];

function playwrightModule() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    '/opt/tools/browser-tools/node_modules/playwright',
    '/product/wxq/node_modules/playwright',
    '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Keep looking for the preinstalled browser harness module.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

const { chromium } = playwrightModule();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const pageErrors = [];
const consoleErrors = [];

async function installPreviewFixture(page) {
  return page.evaluate(async ({ saveKey }) => {
    const [{ loadContent }, run, combat, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, validateRunState } = run;
    const { calculateStats } = combat;
    const { SHANHAI_SAVE_KEY, saveRun } = persistence;
    if (SHANHAI_SAVE_KEY !== saveKey) throw new Error(`Unexpected overhaul save key: ${SHANHAI_SAVE_KEY}`);

    const game = ShanhaiGame.create(content, {
      seed: 'v2-overhaul-ui-fixture',
      name: '雷劫邀战验收行者',
      method: 'RKF04',
    });
    const companionId = 'RKF06';
    if (!content.byId[companionId]?.companion?.name || !content.byId[companionId]?.companion?.quick) {
      throw new Error('Overhaul UI fixture companion has no authored companion name/quick fields');
    }
    game.state.ownedMethods.push(companionId);
    game.state.talents[companionId] = [];
    if (game.player.companion !== companionId) {
      throw new Error(`Automatic companion selection was ${game.player.companion}, expected ${companionId}`);
    }

    // Give the real engine a legal, deterministic acquired build strong enough
    // to win this frozen boss encounter. The companion's poison trigger does
    // not match RKF04's burn, so the authoritative replay has no presentation
    // cue fixture mixed into its combat result.
    const authoredTalents = content.byId[game.state.method].talents || [];
    const fullTierTalents = Array.from({ length: 4 }, (_value, index) =>
      authoredTalents.find(talent => talent.tier === index + 1),
    );
    if (fullTierTalents.some(talent => !talent)) {
      throw new Error('High-tier battle fixture is missing an authored talent for a cultivation tier');
    }
    game.state.talents[game.state.method] = fullTierTalents.map(talent => talent.id);
    game.state.n = 4;
    game.state.xp = content.rules.cultivation.cumulative[3];
    game.state.artifacts = ['RL05', 'RC10', 'RR01', 'RR08'].map(id => ({ id, stacks: 1 }));
    game.state.equipment.slots = ['RL05', 'RC10', 'RR01', 'RR08'];
    game.state.hp = new ShanhaiGame(content, game.state).stats.max_hp;

    const routeMap = game.state.routeMap;
    const byKey = new Map(routeMap.nodes.map(node => [node.key, node]));
    let node = routeMap.nodes.find(candidate => candidate.depth === 0);
    const path = [];
    for (let depth = 0; depth < 10; depth += 1) {
      if (!node || node.depth !== depth) throw new Error(`Fixture route misses depth ${depth}`);
      path.push(node.key);
      node = node.next[0] ? byKey.get(node.next[0]) : undefined;
    }
    if (!node || node.depth !== 10 || node.type !== 'B') {
      throw new Error('Fixture route did not reach its authored act-one boss');
    }
    const completedPath = new Set(path);
    for (const routeNode of routeMap.nodes) routeNode.completed = completedPath.has(routeNode.key);
    routeMap.path = path;
    game.state.nodes = path.map(key => {
      const routeNode = byKey.get(key);
      return { type: routeNode.type, id: routeNode.id, completed: routeNode.completed };
    });
    game.state.step = path.length;
    game.state.phase = 'map';
    const staged = new ShanhaiGame(content, game.state);
    const boss = staged.availableNodes().find(candidate => candidate.key === node.key && candidate.type === 'B');
    if (!boss) throw new Error('Fixture boss is not reachable from its frozen map');
    const bossEntity = content.byId[boss.id];
    const previewEnemy = {
      name: bossEntity.name,
      method: bossEntity.method,
      n: bossEntity.n ?? 0,
      talents: bossEntity.talents ?? [],
      artifacts: bossEntity.artifacts ?? [],
      baseStats: structuredClone(bossEntity.stats),
    };
    const normalEnemyMaxHp = calculateStats(content, previewEnemy).max_hp;
    const challengedEnemy = structuredClone(previewEnemy);
    challengedEnemy.baseStats.max_hp *= 1.25;
    const challengedEnemyMaxHp = calculateStats(content, challengedEnemy).max_hp;
    staged.dispatch({ type: 'enter', id: boss.key });
    validateRunState(content, staged.state);
    if (!staged.canThunderChallenge()) throw new Error('Fixture boss does not allow a thunder challenge');
    saveRun(staged);

    // Existing keys belong to older V2 experiments and must remain untouched.
    localStorage.setItem('suishi-shanhai-run-v2-forging', 'preserve-forging-run');
    localStorage.setItem('suishi-shanhai-run-v2-reactions', 'preserve-reactions-run');
    localStorage.setItem('suishi-shanhai-replay-v2-forging', 'preserve-forging-replay');
    localStorage.setItem('suishi-shanhai-replay-v2-reactions', 'preserve-reactions-replay');
    return {
      companionId,
      companionName: content.byId[companionId].companion.name,
      companionQuick: content.byId[companionId].companion.quick,
      methodName: content.byId.RKF04.name,
      bossName: content.byId[boss.id].name,
      enemyArtifactCount: previewEnemy.artifacts.length,
      normalEnemyMaxHp,
      challengedEnemyMaxHp,
      saveKey: SHANHAI_SAVE_KEY,
    };
  }, { saveKey });
}

async function waitForPhase(page, phase) {
  await page.locator(`.game-page.phase-${phase}`).waitFor({ state: 'visible' });
}

async function assertEnemyPreviewMaxHp(page, expected, context) {
  const vital = page.locator('.enemy-side .preview-vital');
  await vital.waitFor({ state: 'visible' });
  const text = await vital.innerText();
  const maximum = Number(text.match(/\/\s*([\d.]+)/)?.[1]);
  assert.ok(Number.isFinite(maximum), `${context}: could not read enemy preview HP from ${JSON.stringify(text)}`);
  assert.equal(maximum, Math.round(expected),
    `${context}: preview showed ${maximum} max HP; calculated max HP is ${expected}`);
}

async function saveScreenshot(page, stage, viewport) {
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: join(screenshotDir, `${stage}-${viewport.width}.png`),
    fullPage: true,
  });
}

async function assertNoPageOverflow(page, viewport, stage) {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= viewport.width + 1,
    `${stage} document overflow at ${viewport.width}px: ${JSON.stringify(widths)}`);
  assert.ok(widths.body <= viewport.width + 1,
    `${stage} body overflow at ${viewport.width}px: ${JSON.stringify(widths)}`);
}

async function clickTab(page, id) {
  for (const selector of [
    `.bottom-nav [data-action="tab"][data-id="${id}"]`,
    `.desktop-nav [data-action="tab"][data-id="${id}"]`,
  ]) {
    const button = page.locator(selector);
    if (await button.isVisible()) {
      await button.click();
      return;
    }
  }
  throw new Error(`No visible ${id} navigation tab`);
}

async function previewLayout(page, viewport) {
  const metrics = await page.evaluate(() => {
    const rect = element => {
      const value = element?.getBoundingClientRect();
      if (!value) return null;
      return { x: value.x, y: value.y, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const overlaps = (a, b) => Boolean(a && b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y);
    const field = document.querySelector('.thunder-challenge');
    const copy = field?.querySelector('.thunder-challenge-copy');
    const actions = document.querySelector('.phase-preview .stage-actions');
    const controls = [...document.querySelectorAll('.phase-preview .stage-actions button')].map(element => ({
      text: element.innerText,
      ...rect(element),
      fontSize: parseFloat(getComputedStyle(element).fontSize),
    }));
    const label = field?.querySelector('.thunder-challenge-choice');
    const input = field?.querySelector('input[type="checkbox"]');
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      field: rect(field),
      label: rect(label),
      input: rect(input),
      actions: rect(actions),
      overlaps: overlaps(rect(field), rect(actions)),
      copyOverflow: copy ? copy.scrollWidth > copy.clientWidth + 1 : true,
      copyFont: copy ? Math.min(...[...copy.querySelectorAll('small')].map(item => parseFloat(getComputedStyle(item).fontSize))) : 0,
      controls,
      allVisible: !!field && !!label && [...field.querySelectorAll('small')].every(item => item.getBoundingClientRect().height > 0),
    };
  });
  assert.equal(metrics.documentWidth <= viewport.width + 1, true,
    `preview overflow at ${viewport.width}px: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.bodyWidth <= viewport.width + 1, true,
    `body overflow at ${viewport.width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.label?.height >= 44, `challenge label hit area is below 44px at ${viewport.width}px`);
  assert.ok(metrics.field?.right <= viewport.width + 1, `challenge details extend past viewport at ${viewport.width}px`);
  assert.ok(metrics.input?.width >= 20 && metrics.input?.height >= 20, 'native checkbox is not visibly actionable');
  assert.equal(metrics.overlaps, false, `challenge card overlaps preview controls at ${viewport.width}px`);
  assert.equal(metrics.copyOverflow, false, `challenge copy clips at ${viewport.width}px`);
  assert.ok(metrics.copyFont >= 14,
    `challenge copy is too small at ${viewport.width}px: ${metrics.copyFont}px; ${JSON.stringify(metrics)}`);
  assert.equal(metrics.allVisible, true, 'challenge risk text is not visible');
  assert.ok(metrics.controls.length >= 2, 'preview navigation controls are missing');
  for (const control of metrics.controls) {
    assert.ok(control.width >= 44 && control.height >= 44,
      `small preview target at ${viewport.width}px: ${JSON.stringify(control)}`);
    assert.ok(control.fontSize >= 14, `small preview text at ${viewport.width}px: ${JSON.stringify(control)}`);
    assert.ok(control.x >= -1 && control.right <= viewport.width + 1,
      `preview control is outside viewport at ${viewport.width}px: ${JSON.stringify(control)}`);
  }
  return metrics;
}

async function installPresentationBattleFixture(page) {
  return page.evaluate(async ({ saveKey, replayKey }) => {
    const [{ loadContent }, run, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const stored = JSON.parse(localStorage.getItem(saveKey) || 'null');
    if (stored?.replay !== 'deterministic-input-v1') {
      throw new Error('Presentation fixture requires a completed deterministic battle save');
    }

    // This load repeats deterministic input validation after the browser's
    // real page reload. Its outcome, rounds and remaining HP stay authoritative.
    const game = persistence.loadRun(content);
    if (!game || game.state.phase !== 'battle' || game.state._thunderChallenge !== true ||
        game.state.battle?.outcome !== 'player' || !game.state.battle.frames.length) {
      throw new Error('Real replay did not restore the winning thunder-challenge battle');
    }
    const battle = game.state.battle;
    const authoritative = {
      outcome: battle.outcome,
      rounds: battle.rounds,
      playerHp: battle.playerHp,
      enemyHp: battle.enemyHp,
    };
    const input = game.state.battleInput;
    const start = battle.frames.find(frame => frame.kind === 'start') || battle.frames[0];
    const finish = battle.frames.at(-1);
    const rageSource = `${input.player.method}-RAGE-CHAIN`;
    const companionSource = `${input.player.companion}-COMPANION`;
    const makeFrame = (kind, text, view, extra = {}) => ({
      round: kind === 'start' ? start.round : Math.max(1, finish.round),
      kind,
      text,
      player: structuredClone(view.player),
      enemy: structuredClone(view.enemy),
      ...extra,
    });

    // Presentation-only frames keep the real result metadata above. They let
    // this browser check cue ownership and ranking visuals while the engine
    // replay independently exercises the actual deterministic combat result.
    const frames = [
      makeFrame('start', '交锋开始', start),
      makeFrame('reaction', 'this text carries no cue label', start, {
        actor: 'player', target: 'enemy', source: rageSource,
        cue: { kind: 'rage_chain', owner: 'player', sourceId: rageSource, count: 2 },
      }),
      makeFrame('damage', 'fixture first impact', start, {
        actor: 'player', target: 'enemy', source: input.player.method, amount: 100,
      }),
      makeFrame('action', '绝技连斩 ×3 同伴助战', start, {
        actor: 'player', source: input.player.method,
      }),
      makeFrame('damage', 'fixture companion impact', finish, {
        actor: 'player', target: 'enemy', source: companionSource, amount: 1,
      }),
      makeFrame('reaction', 'this text carries no companion name', finish, {
        actor: 'player', target: 'enemy', source: companionSource,
        cue: { kind: 'companion_assist', owner: 'player', sourceId: companionSource },
      }),
    ];
    const companionName = content.byId[input.player.companion]?.companion?.name;
    if (!companionName) throw new Error('Frozen battle companion has no authored companion name');
    const presentationContributions = [
      { id: input.player.method, name: content.byId[input.player.method].name, triggers: 1, damage: 300, healing: 0, shield: 0, absorbed: 0, rage: 0 },
      { id: companionSource, name: companionName, triggers: 1, damage: 200, healing: 5000, shield: 7000, absorbed: 0, rage: 0 },
      { id: 'RKF07', name: '第三伤害来源', triggers: 1, damage: 100, healing: 0, shield: 0, absorbed: 0, rage: 0 },
      { id: 'RKF08', name: '第四伤害来源', triggers: 1, damage: 50, healing: 0, shield: 0, absorbed: 0, rage: 0 },
      { id: 'RKF09', name: '仅治疗与护盾来源', triggers: 2, damage: 0, healing: 9000, shield: 12000, absorbed: 0, rage: 0 },
    ];
    const presentationState = structuredClone(game.state);
    presentationState.battle.frames = frames;
    presentationState.battle.contributions = presentationContributions;

    let serialized = '';
    persistence.saveRun({ content, state: presentationState }, {
      getItem: () => null,
      setItem: (_key, value) => { serialized = value; },
    });
    const record = JSON.parse(serialized);
    if (record.replay !== 'deterministic-input-v1') {
      throw new Error('Saving the presentation fixture did not validate the real battle state');
    }
    record.state.battle.frames = frames;
    record.state.battle.contributions = presentationContributions;
    delete record.replay;
    run.validateRunState(content, record.state);
    const parsed = persistence.parseRunSave(content, JSON.stringify(record));
    for (const key of ['outcome', 'rounds', 'playerHp', 'enemyHp']) {
      if (parsed.battle[key] !== authoritative[key]) {
        throw new Error(`Presentation fixture changed authoritative battle ${key}`);
      }
    }
    localStorage.setItem(saveKey, JSON.stringify(record));
    const key = [record.state.id, record.state.act, record.state.step, frames.length].join(':');
    localStorage.setItem(replayKey, JSON.stringify({ key, cursor: frames.length - 1 }));
    return {
      frames: frames.length,
      companionName,
      companionSource,
      methodName: content.byId[input.player.method].name,
      authoritative,
      deterministicReplay: stored.replay,
      saveKey,
    };
  }, { saveKey, replayKey });
}

async function setReplayCursor(page, cursor) {
  await page.evaluate(({ saveKey, replayKey, cursor }) => {
    const saved = JSON.parse(localStorage.getItem(saveKey));
    const state = saved.state;
    const key = [state.id, state.act, state.step, state.battle.frames.length].join(':');
    localStorage.setItem(replayKey, JSON.stringify({ key, cursor }));
  }, { saveKey, replayKey, cursor });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, 'battle');
}

async function assertBattleLayout(page, viewport, fixture) {
  const metrics = await page.evaluate(() => {
    const rect = element => {
      const value = element?.getBoundingClientRect();
      if (!value) return null;
      return { x: value.x, y: value.y, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const overlaps = (a, b) => Boolean(a && b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y);
    const cue = document.querySelector('[data-combat-semantic-cue="companion_assist"]');
    const bars = cue?.classList.contains('owner-enemy')
      ? document.querySelector('.combatant.side-e .fighter-bars')
      : document.querySelector('.combatant.side-p .fighter-bars');
    const floats = document.querySelectorAll('.combat-feedback-group');
    const controls = [...document.querySelectorAll('.battle-controls button, .battle-detail-actions button')].map(element => ({
      text: element.innerText,
      ...rect(element),
      fontSize: parseFloat(getComputedStyle(element).fontSize),
    }));
    const ranking = [...document.querySelectorAll('.battle-damage-source-copy')].map(element => {
      const name = element.querySelector('b')?.innerText.trim() || '';
      const metrics = element.querySelector('span')?.innerText.trim() || '';
      return `${name} · ${metrics}`;
    });
    const meters = [...document.querySelectorAll('.battle-damage-meter')].map(element => ({
      value: Number(element.getAttribute('aria-valuenow')),
      label: element.getAttribute('aria-label'),
      width: parseFloat(element.firstElementChild?.style.width || '0'),
    }));
    return {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      cue: rect(cue),
      bars: rect(bars),
      cueBarsOverlap: overlaps(rect(cue), rect(bars)),
      cueFloatOverlap: [...floats].some(float => overlaps(rect(cue), rect(float))),
      controls,
      ranking,
      meters,
      phase: document.querySelector('.game-page')?.dataset.phase,
    };
  });
  assert.equal(metrics.phase, 'battle');
  assert.ok(metrics.documentWidth <= viewport.width + 1, `battle overflow at ${viewport.width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyWidth <= viewport.width + 1, `battle body overflow at ${viewport.width}px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.cue, `companion cue is missing at ${viewport.width}px`);
  assert.equal(metrics.cueBarsOverlap, false, `companion cue overlaps its HP bars at ${viewport.width}px`);
  assert.equal(metrics.cueFloatOverlap, false, `companion cue overlaps a damage float at ${viewport.width}px`);
  assert.ok(metrics.controls.length >= 5, 'battle controls are missing');
  for (const control of metrics.controls) {
    assert.ok(control.width >= 44 && control.height >= 44,
      `small battle target at ${viewport.width}px: ${JSON.stringify(control)}`);
    assert.ok(control.x >= -1 && control.right <= viewport.width + 1,
      `battle control is outside viewport at ${viewport.width}px: ${JSON.stringify(control)}`);
  }
  assert.deepEqual(metrics.ranking, [
    `${fixture.methodName} · 伤害 300 · 46%`,
    `${fixture.companionName} · 伤害 200 · 31%`,
    '第三伤害来源 · 伤害 100 · 15%',
  ]);
  assert.deepEqual(metrics.meters.map(meter => meter.value), [46, 31, 15]);
  assert.equal(metrics.meters.length, 3, 'only the top three credited damage sources should be shown');
  assert.ok(metrics.meters.every(meter => meter.label.includes('伤害') && meter.width > 0),
    'damage progress bars need named, visible damage values');
}

const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: viewports[1] });
const page = await context.newPage();
page.on('pageerror', error => pageErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.game-page, .landing-page').first().waitFor({ state: 'visible' });
  const fixture = await installPreviewFixture(page);
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, 'preview');
  assert.ok(fixture.enemyArtifactCount > 0, 'preview fixture enemy must exercise artifact-adjusted max HP');
  await assertEnemyPreviewMaxHp(page, fixture.normalEnemyMaxHp, 'unchallenged preview');
  assert.equal(await page.locator('[data-thunder-challenge]').isChecked(), false);
  assert.match(await page.locator('.thunder-challenge').innerText(), /敌方基础气血 \+25%/);
  assert.match(await page.locator('.thunder-challenge').innerText(), /15%.*20 怒气/);
  assert.match(await page.locator('.thunder-challenge').innerText(), /基础战斗经验 \+50%/);
  assert.match(await page.locator('.thunder-challenge').innerText(), /另选 1 件稀有或传奇法宝/);
  assert.match(await page.locator('.thunder-challenge').innerText(), /不会将普通奖励升为稀有/);
  assert.match(await page.locator('.thunder-challenge').innerText(), /改为灵石/);

  await clickTab(page, 'build');
  await page.locator(`[data-active-companion="${fixture.companionId}"]`).waitFor({ state: 'visible' });
  const companionText = await page.locator(`[data-active-companion="${fixture.companionId}"]`).innerText();
  assert.ok(companionText.includes(fixture.companionName));
  assert.ok(companionText.includes(fixture.companionQuick));
  await clickTab(page, 'journey');
  await waitForPhase(page, 'preview');

  const toggle = page.locator('[data-thunder-challenge]');
  await toggle.check();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.state?._thunderChallenge === true, saveKey);
  assert.equal(await toggle.isChecked(), true, 'challenge toggle did not retain the selected state');
  await assertEnemyPreviewMaxHp(page, fixture.challengedEnemyMaxHp, 'enabled challenge preview');
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, 'preview');
  assert.equal(await page.locator('[data-thunder-challenge]').isChecked(), true,
    'enabled challenge state did not survive a reload');
  await assertEnemyPreviewMaxHp(page, fixture.challengedEnemyMaxHp, 'reloaded challenge preview');
  const reloadedToggle = page.locator('[data-thunder-challenge]');
  await reloadedToggle.uncheck();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.state?._thunderChallenge === false, saveKey);
  assert.equal(await reloadedToggle.isChecked(), false, 'challenge toggle could not be unchecked');
  await assertEnemyPreviewMaxHp(page, fixture.normalEnemyMaxHp, 'disabled challenge preview');
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, 'preview');
  assert.equal(await page.locator('[data-thunder-challenge]').isChecked(), false,
    'disabled challenge state did not survive a reload');
  await assertEnemyPreviewMaxHp(page, fixture.normalEnemyMaxHp, 'reloaded normal preview');
  const persistedToggle = page.locator('[data-thunder-challenge]');
  await persistedToggle.check();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.state?._thunderChallenge === true, saveKey);
  assert.equal(await persistedToggle.isChecked(), true, 'challenge could not be re-enabled after reload');
  await assertEnemyPreviewMaxHp(page, fixture.challengedEnemyMaxHp, 're-enabled challenge preview');
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await previewLayout(page, viewport);
    await saveScreenshot(page, 'preview', viewport);
  }

  await page.locator('[data-action="fight"]').click();
  await waitForPhase(page, 'battle');
  const actualBattle = await page.evaluate(key => {
    const record = JSON.parse(localStorage.getItem(key) || 'null');
    const battle = record?.state?.battle;
    return {
      replay: record?.replay,
      phase: record?.state?.phase,
      outcome: battle?.outcome,
      rounds: battle?.rounds,
      playerHp: battle?.playerHp,
      enemyHp: battle?.enemyHp,
      persistedFrames: battle?.frames?.length,
    };
  }, saveKey);
  assert.equal(actualBattle.replay, 'deterministic-input-v1', 'real battle save omitted deterministic replay validation');
  assert.equal(actualBattle.phase, 'battle');
  assert.equal(actualBattle.outcome, 'player', 'legal authored test build must win the real boss encounter');
  assert.ok(actualBattle.rounds > 0, 'real engine did not record any combat rounds');
  assert.equal(actualBattle.enemyHp, 0, 'real winning battle must finish with the enemy at zero HP');
  assert.equal(actualBattle.persistedFrames, 0, 'normal save should persist deterministic input instead of frames');

  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, 'battle');
  const replayedBattle = await page.evaluate(key => {
    const record = JSON.parse(localStorage.getItem(key) || 'null');
    return {
      replay: record?.replay,
      phase: record?.state?.phase,
      outcome: record?.state?.battle?.outcome,
      rounds: record?.state?.battle?.rounds,
      playerHp: record?.state?.battle?.playerHp,
      enemyHp: record?.state?.battle?.enemyHp,
    };
  }, saveKey);
  assert.deepEqual(replayedBattle, {
    replay: 'deterministic-input-v1',
    phase: 'battle',
    outcome: actualBattle.outcome,
    rounds: actualBattle.rounds,
    playerHp: actualBattle.playerHp,
    enemyHp: actualBattle.enemyHp,
  }, 'browser reload must restore and validate the actual deterministic battle result');

  const battleFixture = await installPresentationBattleFixture(page);
  assert.equal(battleFixture.saveKey, saveKey);
  assert.deepEqual(battleFixture.authoritative, {
    outcome: actualBattle.outcome,
    rounds: actualBattle.rounds,
    playerHp: actualBattle.playerHp,
    enemyHp: actualBattle.enemyHp,
  });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, 'battle');
  await page.locator('[data-combat-semantic-cue="companion_assist"]').waitFor({ state: 'visible' });
  await page.locator('.battle-damage-ranking').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-combat-semantic-cue="companion_assist"]').innerText(), /同伴助战/);
  assert.ok((await page.locator('[data-combat-semantic-cue="companion_assist"]').innerText()).includes(fixture.companionName));
  assert.match(await page.locator('.battle-damage-ranking').innerText(), /伤害来源 · 实际记账/);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await assertBattleLayout(page, viewport, fixture);
    await saveScreenshot(page, 'battle', viewport);
  }

  await setReplayCursor(page, 1);
  const pause = page.locator('[data-action="battle-pause"]');
  if (await pause.isVisible() && await pause.getAttribute('aria-pressed') === 'false') await pause.click();
  await page.locator('[data-combat-semantic-cue="rage_chain"]').waitFor({ state: 'visible' });
  const rageCue = await page.locator('[data-combat-semantic-cue="rage_chain"]').innerText();
  assert.match(rageCue, /绝技连斩\s*×2/);
  assert.equal(await page.locator('[data-combat-semantic-cue="companion_assist"]').count(), 0,
    'a later companion cue leaked into the rage-chain frame');

  await setReplayCursor(page, 3);
  const actionPause = page.locator('[data-action="battle-pause"]');
  if (await actionPause.isVisible() && await actionPause.getAttribute('aria-pressed') === 'false') await actionPause.click();
  assert.equal(await page.locator('[data-combat-semantic-cue]').count(), 0,
    'cue labels were inferred from ordinary frame text');

  await page.locator('[data-action="battle-skip"]').click();
  await page.locator('[data-action="battle-finish"]').waitFor({ state: 'visible' });
  await page.locator('[data-action="battle-finish"]').click();
  await waitForPhase(page, 'reward');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.state?._thunderRewardStage === 'normal', saveKey);
  assert.match(await page.locator('.game-page').innerText(), /雷劫邀战 · 普通战斗奖励/);
  const normalReward = page.locator('.reward-card [data-action="reward"][data-id]').first();
  await normalReward.waitFor({ state: 'visible' });
  await normalReward.click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.state?._thunderRewardStage === 'bonus', saveKey);
  await waitForPhase(page, 'reward');
  assert.match(await page.locator('.game-page').innerText(), /雷劫邀战 · 额外奖励/);
  assert.match(await page.locator('.thunder-reward-note').innerText(), /普通战斗奖励已单独结算/);
  const bonusRewards = page.locator('.reward-card');
  assert.ok(await bonusRewards.count() > 0, 'thunder bonus stage has no authored reward choices');
  assert.equal(await page.locator('.reward-card.rarity-rare, .reward-card.rarity-legendary').count(),
    await bonusRewards.count(), 'thunder bonus choices must be rare or legendary artifacts');
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await assertNoPageOverflow(page, viewport, 'bonus reward');
    await saveScreenshot(page, 'bonus-reward', viewport);
  }
  const bonusReward = page.locator('.reward-card [data-action="reward"][data-id]').first();
  await bonusReward.click();
  await waitForPhase(page, 'transition');
  await page.waitForFunction(key => {
    const state = JSON.parse(localStorage.getItem(key) || 'null')?.state;
    const challenges = state?.thunderChallenges || [];
    return state?.phase === 'transition' && state?._thunderChallenge === false &&
      state?._thunderRewardStage === undefined && challenges.length === 1 &&
      challenges[0]?.outcome === 'win' && challenges[0]?.normalSettled === true &&
      typeof challenges[0]?.normalReward === 'string' &&
      typeof challenges[0]?.extraReward === 'string';
  }, saveKey);
  const settledChallenge = await page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key) || 'null')?.state;
    return { phase: state?.phase, challenges: state?.thunderChallenges };
  }, saveKey);
  assert.equal(settledChallenge.phase, 'transition');
  assert.equal(settledChallenge.challenges.length, 1, 'boss challenge rewards must settle exactly once');
  assert.equal(settledChallenge.challenges[0].normalSettled, true);
  assert.ok(settledChallenge.challenges[0].normalReward);
  assert.ok(settledChallenge.challenges[0].extraReward);

  const legacyKeys = await page.evaluate(() => [
    localStorage.getItem('suishi-shanhai-run-v2-forging'),
    localStorage.getItem('suishi-shanhai-run-v2-reactions'),
    localStorage.getItem('suishi-shanhai-replay-v2-forging'),
    localStorage.getItem('suishi-shanhai-replay-v2-reactions'),
  ]);
  assert.deepEqual(legacyKeys, [
    'preserve-forging-run',
    'preserve-reactions-run',
    'preserve-forging-replay',
    'preserve-reactions-replay',
  ]);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  console.log(`V2 overhaul browser checks passed at 360, 390, 430 and 1440px. Screenshots: ${screenshotDir}`);
} finally {
  await context.close();
  await browser.close();
}
