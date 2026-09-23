import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const reportOverride = process.env.BROWSER_REPORT_DIR || process.env.BROWSER_OUTPUT_DIR;
const reportDir = reportOverride
  ? path.resolve(reportOverride)
  : path.join(root, 'verification', 'shanhai', 'browser');

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
const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function noOverflow(page, label) {
  const result = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  assert.ok(result.documentWidth <= result.width + 1, `${label}: document overflow ${JSON.stringify(result)}`);
  assert.ok(result.bodyWidth <= result.width + 1, `${label}: body overflow ${JSON.stringify(result)}`);
  return result;
}

async function clearStorage(page) {
  await page.evaluate(() => localStorage.clear());
}

async function phase(page) {
  return page.locator('.game-page').getAttribute('class').then(value => value?.match(/phase-([a-z_]+)/)?.[1] || null);
}

async function createFixture(page, target, seed = `browser-${target}`) {
  await page.evaluate(async ({ target, seed }) => {
    const [{ loadContent }, { ShanhaiGame }, { saveRun, saveWinningBuild }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = ShanhaiGame.create(content, { seed, name: `浏览器${target}`, method: 'RKF01' });
    game.dispatch({ type: 'route', id: 'steady' });

    const finishBattle = () => {
      if (game.state.phase !== 'battle') return;
      while (game.state.battle?.outcome === 'draw') game.dispatch({ type: 'continue_battle' });
      if (game.state.phase === 'battle') game.dispatch({ type: 'battle_done' });
    };
    const finishReward = () => {
      if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
    };
    const advance = () => {
      if (game.state.phase === 'route') {
        game.dispatch({ type: 'route', id: game.availableRoutes()[0].id });
      } else if (game.state.phase === 'map') {
        game.dispatch({ type: 'enter' });
      } else if (game.state.phase === 'preview') {
        game.dispatch({ type: 'fight' });
      } else if (game.state.phase === 'battle') {
        finishBattle();
      } else if (game.state.phase === 'reward') {
        finishReward();
      } else if (game.state.phase === 'event') {
        const event = content.byId[game.node.id];
        const option = event.options.find(candidate => game.optionAvailability(candidate).available);
        if (!option) throw new Error(`No available event option for ${game.node.id}`);
        game.dispatch({ type: 'event', id: option.id });
      } else if (game.state.phase === 'event_result') {
        game.dispatch({ type: 'continue' });
      } else if (game.state.phase === 'shop') {
        game.dispatch({ type: 'leave_shop' });
      } else if (game.state.phase === 'rest') {
        if (game.state._restFromEvent) {
          const method = game.state.ownedMethods.find(id => id !== game.state.method);
          if (!method) throw new Error('Event rest has no owned method choice');
          game.dispatch({ type: 'rest', choice: 'swap_method', method });
        } else {
          game.dispatch({ type: 'rest', choice: 'heal' });
        }
      } else if (game.state.phase === 'talent') {
        const talent = game.availableTalents()[0];
        if (!talent) throw new Error('Talent phase has no talent choice');
        game.dispatch({ type: 'talent', id: talent.id });
      } else if (game.state.phase === 'transition') {
        game.dispatch({ type: 'continue' });
      } else {
        throw new Error(`Cannot advance fixture from ${game.state.phase}`);
      }
    };

    if (['event', 'shop', 'rest', 'talent'].includes(target)) {
      const step = target === 'event' || target === 'talent' ? 1 : target === 'rest' ? 3 : 5;
      game.state.nodes.slice(0, step).forEach(node => { node.completed = true; });
      game.state.step = step;
      if (target === 'talent') game.state.xp = 120;
      game.dispatch({ type: 'enter' });
      if (target === 'talent') {
        let guard = 0;
        while (game.state.phase !== 'talent' && guard++ < 20) advance();
      }
    } else if (target === 'won') {
      const finalEnemy = content.entities.find(entity =>
        entity.kind === 'enemy' && entity.tier === 'final');
      if (!finalEnemy) throw new Error('Content has no final enemy');
      game.state.act = 5;
      game.state.step = 0;
      game.state.nodes = [{ type: 'F', id: finalEnemy.id, completed: true }];
      game.state.routes = ['final'];
      game.state._routeHistory = ['final'];
      game.state.history = [{
        act: 5,
        step: 0,
        title: finalEnemy.name ?? finalEnemy.id,
        text: '测试构筑渡过天门。',
      }];
      game.state.phase = 'won';
      game.state.resultText = '测试构筑渡过天门。';
      saveWinningBuild(game);
    }

    let guard = 0;
    while (!['event', 'shop', 'rest', 'talent', 'won'].includes(target) &&
      game.state.phase !== target && !['won', 'lost'].includes(game.state.phase) && guard++ < 260) {
      advance();
    }
    if (target === 'won' && game.state.phase !== 'won') {
      while (!['won', 'lost'].includes(game.state.phase) && guard++ < 500) advance();
    }
    if (game.state.phase !== target) throw new Error(`Fixture ${target} ended at ${game.state.phase}`);
    saveRun(game);
  }, { target, seed });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#shanhai-app').waitFor();
  await page.waitForTimeout(80);
}

async function setReplayFrame(page, kind, target) {
  await page.evaluate(async ({ kind, target }) => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    if (!game?.state.battle) throw new Error('Replay frame fixture has no battle');
    const index = game.state.battle.frames.findIndex(frame =>
      frame.kind === kind && frame.amount > 0 && (!target || frame.target === target));
    if (index < 0) throw new Error(`Replay has no ${kind} frame for ${target || 'any target'}`);
    const state = game.state;
    const key = `${state.id}:${state.act}:${state.step}:${state.battle.frames.length}`;
    localStorage.setItem('suishi-shanhai-replay-v1', JSON.stringify({ key, cursor: index }));
  }, { kind, target });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#shanhai-app').waitFor();
  await page.waitForTimeout(80);
}

async function forceMaxDraw(page) {
  await page.evaluate(async () => {
    const [{ loadContent }, { loadRun, saveRun }, { simulateBattle }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
      import('/shanhai/run.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    if (!game?.state.battle || !game.state.battleInput) throw new Error('Max-draw fixture has no battle');
    const input = game.state.battleInput;
    for (const loadout of [input.player, input.enemy]) {
      loadout.method = 'RKF01';
      loadout.n = 0;
      loadout.talents = [];
      loadout.artifacts = [];
      loadout.baseStats = {
        attack: 0,
        defense: 100000,
        max_hp: 100000,
        crit_rate: 0,
        speed: 1,
      };
      loadout.hp = 100000;
    }
    input.roundLimit = 4096;
    game.state.battle = simulateBattle(content, input.player, input.enemy, input.seed, { roundLimit: input.roundLimit });
    if (game.state.battle.outcome !== 'draw') throw new Error(`Expected draw fixture, got ${game.state.battle.outcome}`);
    saveRun(game);
    localStorage.removeItem('suishi-shanhai-replay-v1');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#shanhai-app').waitFor();
  await page.waitForTimeout(80);
}

async function forceRewardCandidate(page, id) {
  await page.evaluate(async ({ id }) => {
    const [{ loadContent }, { loadRun, saveRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    if (!game || game.state.phase !== 'reward') throw new Error('Reward fixture is not in reward phase');
    game.state.rewardCandidates = [id];
    saveRun(game);
  }, { id });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#shanhai-app').waitFor();
  await page.waitForTimeout(80);
}

async function forceMissingArtifactEvent(page) {
  await page.evaluate(async () => {
    const [{ loadContent }, { loadRun, saveRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    if (!game) throw new Error('Event reason fixture has no run');
    const state = game.state;
    state.nodes[state.step] = { type: 'K', id: 'RK005', completed: false };
    state.phase = 'event';
    state.eventOption = undefined;
    state.artifacts = [];
    state.flags = {};
    state._pendingEvent = undefined;
    state._eventSettled = false;
    saveRun(game);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#shanhai-app').waitFor();
  await page.waitForTimeout(80);
}

async function forceZeroContribution(page) {
  await page.evaluate(async () => {
    const [{ loadContent }, { loadRun, saveRun }, { simulateBattle }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
      import('/shanhai/run.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    if (!game?.state.battle || !game.state.battleInput) throw new Error('Contribution fixture has no battle');
    const input = game.state.battleInput;
    input.roundLimit = 1;
    input.player.n = 3;
    input.player.talents = ['RKF01-J3-B'];
    input.player.artifacts = [{ id: 'RC07', stacks: 1 }];
    input.enemy.talents = [];
    input.enemy.artifacts = [];
    input.enemy.n = 0;
    input.enemy.baseStats = {
      ...input.enemy.baseStats,
      attack: 0,
    };
    game.state.battle = simulateBattle(content, input.player, input.enemy, input.seed, { roundLimit: input.roundLimit });
    saveRun(game);
    localStorage.removeItem('suishi-shanhai-replay-v1');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#shanhai-app').waitFor();
  await page.waitForTimeout(80);
}

async function run() {
  await mkdir(reportDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  for (const page of [desktop, mobile]) {
    page.on('pageerror', error => errors.push({ page: page === desktop ? 'desktop' : 'mobile', error: error.message }));
    page.on('console', message => {
      if (message.type() === 'error') errors.push({ page: page === desktop ? 'desktop' : 'mobile', error: message.text() });
    });
  }

  try {
    await check('desktop setup has five methods and no overflow', async () => {
      await desktop.goto(url, { waitUntil: 'networkidle' });
      await clearStorage(desktop);
      await desktop.reload({ waitUntil: 'networkidle' });
      await desktop.locator('.method-choice').nth(4).waitFor();
      assert.equal(await desktop.locator('.method-choice').count(), 5);
      assert.match(await desktop.locator('.method-detail').textContent(), /下一场战斗准备/);
      await noOverflow(desktop, 'desktop setup');
      await desktop.screenshot({ path: path.join(reportDir, 'setup-desktop.png'), fullPage: true });
    });

    await check('mobile setup has five methods and no overflow', async () => {
      await mobile.goto(url, { waitUntil: 'networkidle' });
      await clearStorage(mobile);
      await mobile.reload({ waitUntil: 'networkidle' });
      await mobile.locator('.method-choice').nth(4).waitFor();
      assert.equal(await mobile.locator('.method-choice').count(), 5);
      await noOverflow(mobile, 'mobile setup');
      await mobile.screenshot({ path: path.join(reportDir, 'setup-mobile.png'), fullPage: true });
    });

    await check('battle playback speed pause and skip controls', async () => {
      await desktop.goto(url, { waitUntil: 'networkidle' });
      await clearStorage(desktop);
      await desktop.reload({ waitUntil: 'networkidle' });
      await createFixture(desktop, 'battle', 'browser-battle');
      assert.equal(await phase(desktop), 'battle');
      assert.equal(await desktop.locator('.profile-actions .profile-action').count(), 2);
      assert.ok((await desktop.locator('.profile-build').textContent()).includes('未选天赋'));
      await setReplayFrame(desktop, 'damage', 'enemy');
      assert.match(await desktop.locator('[data-amount-kind="damage"]').textContent(), /^-/);
      assert.doesNotMatch(await desktop.locator('[data-frame-kind]').textContent(), /\b(action|damage|dot|heal|shield|status|rage|phase|start|round|draw|end|summary)\b/i);
      await setReplayFrame(desktop, 'shield', 'player');
      assert.match(await desktop.locator('[data-amount-kind="shield"]').textContent(), /^\+/);
      await desktop.locator('[data-action="battle-speed"][data-speed="2"]').click();
      assert.equal(await desktop.locator('[data-action="battle-speed"][data-speed="2"]').getAttribute('aria-pressed'), 'true');
      await desktop.locator('[data-action="battle-pause"]').click();
      assert.equal(await desktop.locator('[data-action="battle-pause"]').getAttribute('aria-pressed'), 'true');
      await desktop.locator('[data-action="battle-skip"]').click();
      await desktop.locator('[data-action="battle-finish"]').waitFor();
      assert.equal(await desktop.locator('[data-action="battle-finish"]').count(), 1);
      assert.equal(await desktop.locator('[data-action="battle-finish"]').evaluate(element => element.tagName), 'BUTTON');
      assert.equal(await desktop.locator('.replay-progress > i').getAttribute('style'), 'width:100%');
      assert.equal(await desktop.locator('details[data-details="battle-diagnostics"]').getAttribute('open'), '');
      await noOverflow(desktop, 'desktop battle');
      await desktop.screenshot({ path: path.join(reportDir, 'battle-desktop.png'), fullPage: true });
    });

    await check('4096-round draw keeps explicit retirement and disables continuation', async () => {
      await desktop.goto(url, { waitUntil: 'networkidle' });
      await clearStorage(desktop);
      await desktop.reload({ waitUntil: 'networkidle' });
      await createFixture(desktop, 'battle', 'browser-max-draw');
      await forceMaxDraw(desktop);
      await desktop.locator('[data-action="battle-skip"]').click();
      const continueButton = desktop.locator('[data-action="continue-battle"]');
      assert.equal(await continueButton.isDisabled(), true);
      assert.match(await continueButton.textContent(), /4096/);
      assert.ok(await desktop.locator('[data-action="retire"]').isVisible());
      await noOverflow(desktop, 'desktop max draw');
    });

    await check('reward candidates remain frozen after reload', async () => {
      await desktop.goto(url, { waitUntil: 'networkidle' });
      await clearStorage(desktop);
      await desktop.reload({ waitUntil: 'networkidle' });
      await createFixture(desktop, 'reward', 'browser-reward');
      assert.equal(await phase(desktop), 'reward');
      const before = await desktop.locator('.reward-card h2').allTextContents();
      const declineBefore = await desktop.locator('[data-action="reward"][data-id=""]').textContent();
      await desktop.reload({ waitUntil: 'networkidle' });
      const after = await desktop.locator('.reward-card h2').allTextContents();
      const declineAfter = await desktop.locator('[data-action="reward"][data-id=""]').textContent();
      assert.deepEqual(after, before);
      assert.equal(declineAfter, declineBefore);
    });

    await check('reward percentages and contribution reasons stay readable', async () => {
      await desktop.goto(url, { waitUntil: 'networkidle' });
      await clearStorage(desktop);
      await desktop.reload({ waitUntil: 'networkidle' });
      await createFixture(desktop, 'reward', 'browser-copy');
      await forceRewardCandidate(desktop, 'RC07');
      assert.match(await desktop.locator('.reward-card .attribute-list').textContent(), /暴击\s*\+2%/);

      await desktop.goto(url, { waitUntil: 'networkidle' });
      await clearStorage(desktop);
      await desktop.reload({ waitUntil: 'networkidle' });
      await createFixture(desktop, 'battle', 'browser-contribution-copy');
      await forceZeroContribution(desktop);
      await desktop.locator('[data-action="battle-skip"]').click();
      const details = desktop.locator('details[data-details="battle-diagnostics"]');
      if (!(await details.getAttribute('open'))) await details.locator('summary').click();
      const diagnostics = await details.textContent();
      assert.match(diagnostics, /属性已生效/);
      assert.match(diagnostics, /本局未满足触发条件/);
      assert.doesNotMatch(diagnostics, /permanent|conditional|invalid|absent/i);
    });

    await check('event unavailable reasons stay Chinese and disabled', async () => {
      await desktop.goto(url, { waitUntil: 'networkidle' });
      await clearStorage(desktop);
      await desktop.reload({ waitUntil: 'networkidle' });
      await createFixture(desktop, 'event', 'browser-event-reason');
      await forceMissingArtifactEvent(desktop);
      assert.equal(await phase(desktop), 'event');
      const option = desktop.locator('.event-option[data-id="RK005-carry-sight"]');
      assert.equal(await option.count(), 1);
      assert.equal(await option.isDisabled(), true);
      const reason = await option.locator('.disabled-reason').textContent();
      assert.match(reason, /缺少明目珠/);
      assert.doesNotMatch(reason, /required-artifact-missing|capacity|flag|method-not-known|cannot-pay/i);
      await noOverflow(desktop, 'desktop event reason');
    });

    for (const target of ['event', 'shop', 'rest', 'talent', 'won']) {
      await check(`${target} fixture renders`, async () => {
        await desktop.goto(url, { waitUntil: 'networkidle' });
        await clearStorage(desktop);
        await desktop.reload({ waitUntil: 'networkidle' });
        await createFixture(desktop, target, `browser-${target}`);
        assert.equal(await phase(desktop), target);
        if (target === 'event') {
          assert.ok(await desktop.locator('.event-option').count() > 0);
          await desktop.locator('.event-option:not([disabled])').last().click();
          assert.equal(await phase(desktop), 'event_result');
          await desktop.locator('[data-action="continue"]').click();
          assert.notEqual(await phase(desktop), 'event_result', 'Event continue must dispatch, not merely rerender');
          assert.equal(await desktop.locator('.inline-error').count(), 0);
        }
        if (target === 'shop') assert.ok(await desktop.locator('.shop-item').count() > 0);
        if (target === 'rest') assert.ok(await desktop.locator('.rest-choice').count() > 0 || await desktop.locator('.method-swap').count() > 0);
        if (target === 'talent') assert.ok(await desktop.locator('.talent-card').count() > 0);
        if (target === 'won') {
          assert.equal(await desktop.locator('.end-seal.win').count(), 1);
          await desktop.locator('.header-actions [data-action="archives"]').click();
          assert.equal(await desktop.locator('.dialog .archive-item').count(), 1);
          assert.equal(await desktop.locator('[data-action="export-archive"]').count(), 1);
          await desktop.locator('.dialog-close').click();
        }
        await noOverflow(desktop, `${target} desktop`);
      });
    }

    await check('mobile battle controls stay reachable', async () => {
      await mobile.goto(url, { waitUntil: 'networkidle' });
      await clearStorage(mobile);
      await mobile.reload({ waitUntil: 'networkidle' });
      await createFixture(mobile, 'battle', 'browser-mobile-battle');
      await mobile.locator('[data-action="battle-skip"]').scrollIntoViewIfNeeded();
      assert.ok(await mobile.locator('[data-action="battle-skip"]').isVisible());
      await noOverflow(mobile, 'mobile battle');
      await mobile.screenshot({ path: path.join(reportDir, 'battle-mobile.png'), fullPage: true });
    });
  } finally {
    await browser.close();
    await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
      url,
      generatedAt: new Date().toISOString(),
      checks,
      errors,
    }, null, 2));
  }
  if (errors.length) throw new Error(`Browser console errors: ${JSON.stringify(errors)}`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
