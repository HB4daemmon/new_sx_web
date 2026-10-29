import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const screenshotDir = process.env.SCREENSHOT_DIR;
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const buildKey = 'suishi-shanhai-build-v2-overhaul';
const replayKey = 'suishi-shanhai-replay-v2-overhaul';
const legacyKeys = [
  'suishi-shanhai-run-v2-forging',
  'suishi-shanhai-build-v2-forging',
  'suishi-shanhai-replay-v2-forging',
  'suishi-shanhai-run-v2-reactions',
  'suishi-shanhai-build-v2-reactions',
  'suishi-shanhai-replay-v2-reactions',
];
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

async function installRewardFixture(page) {
  return page.evaluate(async ({ saveKey, legacyKeys }) => {
    const [{ loadContent }, run, combat, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, registerCombatWorker, validateRunState } = run;
    const { calculateStats, simulateBattle } = combat;
    const { SHANHAI_SAVE_KEY, SHANHAI_BUILD_KEY, saveRun, saveWinningBuild } = persistence;
    registerCombatWorker({ calculateStats, simulateBattle });

    const settleBattle = (game, label) => {
      const node = game.availableNodes().find(candidate => candidate.type === 'C');
      if (!node) throw new Error(`${label} has no reachable common battle`);
      game.dispatch({ type: 'enter', id: node.key });
      game.dispatch({ type: 'fight' });
      const input = game.state.battleInput;
      if (!input || game.state.phase !== 'battle') {
        throw new Error(`${label} did not enter a real battle`);
      }
      const maxHp = game.stats.max_hp;
      const player = {
        ...structuredClone(input.player),
        baseStats: { attack: 100000, defense: 100, max_hp: maxHp, crit_rate: 0, speed: 100 },
        hp: maxHp,
      };
      const enemy = {
        ...structuredClone(input.enemy),
        baseStats: { attack: 1, defense: 0, max_hp: 1, crit_rate: 0, speed: 1 },
        hp: 1,
      };
      const battleInput = {
        ...input,
        player,
        enemy,
        seed: `${input.seed}:${label}`,
        roundLimit: 3,
        rules: 'awakening-v1',
      };
      const result = simulateBattle(content, player, enemy, battleInput.seed, {
        roundLimit: battleInput.roundLimit,
        artifactAwakenings: true,
      });
      game.state.battleInput = battleInput;
      game.state.battle = result;
      validateRunState(content, game.state);
      if (result.outcome !== 'player') {
        throw new Error(`${label} fixture battle did not produce a win`);
      }
      game.dispatch({ type: 'battle_done' });
      if (game.state.phase !== 'reward') {
        throw new Error(`${label} did not settle into its reward`);
      }
    };

    const game = ShanhaiGame.create(content, {
      seed: 'v2-forging-browser-flow',
      name: '炼宝真实行旅验收',
      method: 'RKF05',
    });
    game.state.n = 4;
    game.state._coreRewardOffered = true;
    game.startAct(2);

    game.state.artifacts = [
      { id: 'RC02', stacks: 1 },
      { id: 'RC03', stacks: 1 },
      { id: 'RC14', stacks: 2 },
      { id: 'RC01', stacks: 1 },
    ];
    game.state.equipment.slots = ['RC14', 'RC01'];
    game.state.hp = game.stats.max_hp;
    settleBattle(game, 'refining-reward');

    if (!Array.isArray(game.state.rewardRefinements)) {
      throw new Error('New run did not initialize reward refinement history');
    }
    const preview = game.rewardRefinePreview('RC03', 'RC14');
    if (!preview.available || preview.nextStacks !== 3 || !preview.awakening) {
      throw new Error(`Fixture has no real threshold refinement preview: ${JSON.stringify(preview)}`);
    }
    const candidates = game.state.rewardCandidates.slice();
    if (!candidates.length || candidates.some(id => content.byId[id]?.rarity !== 'common')) {
      throw new Error(`Fixture reward is not ordinary/common-only: ${JSON.stringify(candidates)}`);
    }
    const saved = saveRun(game);
    const archiveGame = new ShanhaiGame(content, structuredClone(game.state));
    archiveGame.state.phase = 'won';
    const archive = saveWinningBuild(archiveGame);
    if (SHANHAI_SAVE_KEY !== saveKey || SHANHAI_BUILD_KEY !== 'suishi-shanhai-build-v2-overhaul') {
      throw new Error('Persistence keys do not match the current V2 overhaul namespace');
    }
    if (!archive) throw new Error('Could not prepare the build export fixture');
    for (const key of legacyKeys) localStorage.setItem(key, `untouched:${key}`);

    return {
      phase: game.state.phase,
      act: game.state.act,
      sourceIds: ['RC02', 'RC03'],
      targetIds: ['RC14', 'RC01'],
      candidateIds: candidates,
      candidateNames: candidates.map(id => content.byId[id].name),
      sourceName: content.byId.RC03.name,
      targetName: content.byId.RC14.name,
      awakeningName: content.byId.RC14.awakening.name,
      targetNextStacks: preview.nextStacks,
      coinsBefore: game.state.coins,
      historyCount: game.state.history.length,
      saveKey: SHANHAI_SAVE_KEY,
      buildKey: SHANHAI_BUILD_KEY,
      saveRecordKey: saved.key,
      archiveBuildId: archive.buildId,
    };
  }, { saveKey, legacyKeys });
}

async function openAppAndReward(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.game-page, .landing-page').first().waitFor({ state: 'visible' });
  const fixture = await installRewardFixture(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-reward').waitFor({ state: 'visible' });
  return fixture;
}

async function assertRefineLayout(page, viewport, fixture) {
  const tool = page.locator('.reward-refine');
  const summary = tool.locator(':scope > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.reward-refine')?.open === true);
  assert.match(await tool.innerText(), /本幕炼宝 1 \/ 1 次/);
  assert.match(await tool.innerText(), /确认后放弃本次整份奖励/);
  assert.match(await tool.innerText(), new RegExp(fixture.targetName));
  assert.match(await tool.innerText(), new RegExp(fixture.awakeningName));
  assert.match(await tool.innerText(), /2 → 3 \/ 3/);
  for (const name of fixture.candidateNames) {
    assert.ok((await tool.innerText()).includes(name), `forfeited reward ${name} is not previewed`);
  }

  const source = tool.locator('[data-refine-source]');
  const target = tool.locator('[data-refine-target]');
  const confirm = tool.locator('[data-action="refine-reward"]');
  assert.equal(await source.inputValue(), fixture.sourceIds[0]);
  assert.equal(await target.inputValue(), fixture.targetIds[0]);
  assert.equal(await source.isDisabled(), false);
  assert.equal(await target.isDisabled(), false);
  assert.equal(await confirm.isDisabled(), false);

  await page.keyboard.press('Tab');
  assert.equal(await source.evaluate(element => element === document.activeElement),
    true, 'keyboard focus did not move from the disclosure to the source select');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(expected => {
    return document.querySelector('[data-refine-source]')?.value === expected;
  }, fixture.sourceIds[1]);
  assert.match(await tool.locator('.reward-refine-impact').innerText(), /材料耗尽/);
  await page.keyboard.press('Tab');
  assert.equal(await target.evaluate(element => element === document.activeElement),
    true, 'keyboard focus did not move to the target select');
  await page.keyboard.press('Tab');
  assert.equal(await confirm.evaluate(element => element === document.activeElement),
    true, 'keyboard focus did not reach the sole confirmation command');

  const metrics = await page.evaluate(() => {
    const selectors = [
      '.reward-refine > summary',
      '[data-refine-source]',
      '[data-refine-target]',
      '[data-action="refine-reward"]',
    ];
    const controls = selectors.map(selector => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect ? {
        selector,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      } : null;
    });
    const containers = [
      '.reward-refine-body',
      '.reward-refine-selects',
      '.reward-refine-impact',
      '.reward-refine-forfeit',
    ].map(selector => {
      const element = document.querySelector(selector);
      return element ? {
        selector,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      } : null;
    });
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      controls,
      containers,
    };
  });
  assert.ok(metrics.documentWidth <= viewport.width + 1 &&
    metrics.bodyWidth <= viewport.width + 1,
  `${viewport.width}px document overflow: ${JSON.stringify(metrics)}`);
  for (const control of metrics.controls) {
    assert.ok(control && control.left >= 0 && control.right <= viewport.width + 1,
      `${viewport.width}px control escapes the viewport: ${JSON.stringify(control)}`);
    assert.ok(control.height >= 44 && control.width >= 44,
      `${viewport.width}px control is below the touch target minimum: ${JSON.stringify(control)}`);
  }
  for (const container of metrics.containers) {
    assert.ok(container && container.scrollWidth <= container.clientWidth + 1,
      `${viewport.width}px refinement content overflows ${container?.selector}: ${JSON.stringify(container)}`);
  }
  const decline = page.locator('.stage-actions [data-action="reward"][data-id=""]');
  await decline.scrollIntoViewIfNeeded();
  const declineUnobscured = await decline.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return element === topmost || element.contains(topmost);
  });
  assert.equal(declineUnobscured, true, `${viewport.width}px bottom navigation blocks the decline command`);
  await confirm.scrollIntoViewIfNeeded();
  return { source, confirm };
}

async function assertSavedRefinement(page, fixture) {
  const stored = await page.evaluate(async ({ saveKey }) => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const raw = JSON.parse(localStorage.getItem(saveKey) || 'null');
    const loaded = loadRun(content);
    return {
      raw,
      phase: loaded?.state.phase,
      act: loaded?.state.act,
      artifacts: loaded?.state.artifacts,
      equipment: loaded?.state.equipment,
      candidates: loaded?.state.rewardCandidates,
      refinements: loaded?.state.rewardRefinements,
      historyCount: loaded?.state.history.length,
      coins: loaded?.state.coins,
    };
  }, { saveKey });
  assert.ok(stored.raw, 'confirmation did not persist a run save');
  assert.equal(stored.raw.key, saveKey);
  assert.equal(stored.phase, 'map', 'refinement did not complete the reward node');
  assert.equal(stored.act, fixture.act);
  assert.deepEqual(stored.candidates, [], 'refinement left claimable reward candidates');
  assert.equal(stored.refinements.length, 1, 'refinement record was not saved exactly once');
  assert.deepEqual(stored.refinements[0].forfeited, fixture.candidateIds);
  assert.equal(stored.refinements[0].source, fixture.sourceIds[1]);
  assert.equal(stored.refinements[0].target, fixture.targetIds[0]);
  assert.equal(stored.artifacts.some(item => item.id === fixture.sourceIds[1]), false,
    'the last layer of the selected material was not consumed');
  assert.equal(stored.artifacts.find(item => item.id === fixture.targetIds[0])?.stacks, 3);
  assert.deepEqual(stored.equipment.slots, fixture.targetIds);
  assert.equal(stored.coins, fixture.coinsBefore, 'refinement changed the coin balance');
  assert.equal(stored.historyCount, fixture.historyCount + 1,
    'refinement did not complete exactly one reward node');
  return stored;
}

async function advanceToBattle(page) {
  for (let visited = 0; visited < 8; visited += 1) {
    const route = await page.evaluate(async () => {
      const [{ loadContent }, { loadRun }] = await Promise.all([
        import('/shanhai/content.js'),
        import('/shanhai/persistence.js'),
      ]);
      const content = await loadContent('/content/');
      const game = loadRun(content);
      return {
        phase: game?.state.phase,
        available: game?.availableNodes().map(({ key, type }) => ({ key, type })) || [],
      };
    });
    assert.equal(route.phase, 'map', `expected the route map before moving: ${route.phase}`);
    assert.ok(route.available.length, 'the actual route map has no reachable next node');

    const battleNode = route.available.find(({ type }) => ['C', 'L', 'B', 'F'].includes(type));
    const next = battleNode || route.available[0];
    await page.locator(`.map-scroll .map-node.available[data-id="${next.key}"]`).click();
    await page.locator('.node-preview-dialog').waitFor({ state: 'visible' });
    await page.locator('.modal [data-action="confirm-node"]').click();

    for (let resolution = 0; resolution < 4; resolution += 1) {
      const phase = await page.locator('.game-page').getAttribute('data-phase');
      if (phase === 'preview') {
        await page.locator('.phase-preview [data-action="fight"]').click();
        await page.locator('.game-page.phase-battle').waitFor({ state: 'visible' });
        return next;
      }
      if (phase === 'battle') return next;
      if (phase === 'event') {
        const option = page.locator('.phase-event [data-action="event"]:not([disabled])').first();
        await option.waitFor({ state: 'visible' });
        await option.click();
        await page.waitForFunction(() =>
          document.querySelector('.game-page')?.dataset.phase !== 'event');
        continue;
      }
      if (phase === 'event_result') {
        await page.locator('.phase-event_result [data-action="continue"]').click();
        await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
        break;
      }
      if (phase === 'shop') {
        await page.locator('.phase-shop [data-action="leave-shop"]').click();
        await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
        break;
      }
      if (phase === 'rest') {
        await page.locator('.phase-rest [data-action="rest"][data-choice="heal"]').click();
        await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
        break;
      }
      if (phase === 'talent') {
        await page.locator('.phase-talent [data-action="talent"]').first().click();
        await page.waitForFunction(() =>
          document.querySelector('.game-page')?.dataset.phase !== 'talent');
        continue;
      }
      throw new Error(`unexpected phase while following the route to battle: ${phase}`);
    }
  }
  throw new Error('did not reach a real battle within eight reachable route nodes');
}

async function assertRc01CoreCopyAndActualLog(page) {
  await page.locator('.bottom-nav [data-action="tab"][data-id="build"]').click();
  const rc01 = page.locator('.deck-grid [data-action="inspect-artifact"][data-id="RC01"]');
  await rc01.waitFor({ state: 'visible' });
  await rc01.click();
  const detail = page.locator('.item-dialog .core-rule-detail');
  await detail.waitFor({ state: 'visible' });
  const detailText = await detail.innerText();
  assert.match(detailText, /主普攻本体/);
  assert.match(detailText, /不可暴击|不作暴击判定/);
  assert.match(detailText, /怒技、回响、飞剑、连锁与法宝派生伤害均独立结算/);
  assert.match(detailText, /零段普攻不生成命中/);
  assert.doesNotMatch(detailText, /所有追击.*合一/);
  await page.keyboard.press('Escape');

  await page.locator('.bottom-nav [data-action="tab"][data-id="journey"]').click();
  await advanceToBattle(page);

  const actualBattle = await page.evaluate(async ({ saveKey }) => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    const frames = game?.state.battle?.frames || [];
    return {
      phase: game?.state.phase,
      artifacts: game?.state.battleInput?.player.artifacts,
      frameCount: frames.length,
      convergence: frames.map((frame, index) => ({ frame, index }))
        .filter(({ frame }) => frame.kind === 'status' && frame.source === 'RC01-CORE')
        .map(({ frame, index }) => ({
          index,
          text: frame.text,
          preceding: frames[index - 1]?.kind,
          following: frames[index + 1]?.kind,
        })),
    };
  }, { saveKey });
  assert.equal(actualBattle.phase, 'battle');
  assert.ok(actualBattle.frameCount > 0, 'the next battle did not produce real combat frames');
  assert.deepEqual(actualBattle.artifacts, [
    { id: 'RC14', stacks: 3 },
    { id: 'RC01', stacks: 1 },
  ], 'the next battle did not load the refined, equipped build');
  assert.ok(actualBattle.convergence.length > 0, 'next battle omitted RC01 core status frames');
  assert.ok(actualBattle.convergence.every(item =>
    /^凝锋：\d+段合一，不可暴击$/.test(item.text) &&
    item.preceding === 'action' && item.following === 'damage'),
  `RC01 status frames are not truthful or ordered around the base hit: ${JSON.stringify(actualBattle.convergence)}`);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/battle-mobile-${page.viewportSize().width}.png` });
  }

  await page.locator('.phase-battle [data-action="battle-skip"]').click();
  await page.locator('.battle-detail-actions [data-action="battle-details"][data-tab="log"]').click();
  const battleLog = await page.locator('.battle-detail-dialog .battle-log').innerText();
  assert.ok(actualBattle.convergence.some(item => battleLog.includes(item.text)),
    'battle log did not display the engine status text');
  const replay = await page.evaluate(({ replayKey, legacyKeys }) => ({
    current: localStorage.getItem(replayKey),
    legacy: legacyKeys.map(key => localStorage.getItem(key)),
  }), { replayKey, legacyKeys });
  assert.ok(replay.current, 'app did not write replay progress under the overhaul namespace');
  assert.deepEqual(replay.legacy, legacyKeys.map(key => `untouched:${key}`),
    'app modified an older V2 namespace');
}

async function assertRunExportNamespace(page) {
  await page.keyboard.press('Escape');
  await page.locator('.game-page [data-action="settings"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.settings-dialog [data-action="export"]').click(),
  ]);
  const file = await download.path();
  assert.ok(file, 'run export did not create a downloadable file');
  const exported = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(exported.format, 'suishi-shanhai-run-v2-overhaul');
}

async function assertBuildExportNamespace(page, fixture) {
  await page.locator('.game-page [data-action="settings"]').click();
  await page.locator('.settings-dialog [data-action="archives"]').click();
  const archiveButton = page.locator('.archive-item [data-action="export-archive"]');
  await archiveButton.waitFor({ state: 'visible' });
  assert.equal(await archiveButton.getAttribute('data-id'), fixture.archiveBuildId);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    archiveButton.click(),
  ]);
  const file = await download.path();
  assert.ok(file, 'build export did not create a downloadable file');
  const exported = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(exported.format, 'suishi-shanhai-winning-build-v2-overhaul');
}

async function run() {
  const { chromium } = playwrightModule();
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath });
  const pageErrors = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: viewport.width < 700,
        hasTouch: viewport.width < 700,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => pageErrors.push(`${viewport.width}px: ${error.message}`));
      const fixture = await openAppAndReward(page);
      const { confirm } = await assertRefineLayout(page, viewport, fixture);
      if (screenshotDir) {
        await page.locator('.reward-refine').evaluate(element =>
          element.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${screenshotDir}/forging-${viewport.width}.png` });
      }

      if (viewport.width === 390) {
        const dispatchCount = await page.evaluate(async () => {
          const { ShanhaiGame } = await import('/shanhai/run.js');
          const prototype = ShanhaiGame.prototype;
          const original = prototype.dispatch;
          window.__refineDispatchCount = 0;
          prototype.dispatch = function (command) {
            if (command?.type === 'refine_reward') window.__refineDispatchCount += 1;
            return original.call(this, command);
          };
          return true;
        });
        assert.equal(dispatchCount, true);
        await confirm.click();
        await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
        const dispatches = await page.evaluate(() => window.__refineDispatchCount);
        assert.equal(dispatches, 1, 'the confirmation emitted more than one refine command');
        await assertSavedRefinement(page, fixture);
        await assertRunExportNamespace(page);
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
        await assertBuildExportNamespace(page, fixture);
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
        await assertRc01CoreCopyAndActualLog(page);
      }

      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
      await context.close();
    }
    console.log('ok - V2 forging disclosure, real refine save/load, and next battle');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
