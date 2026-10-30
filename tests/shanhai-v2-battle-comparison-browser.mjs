import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4191/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const replayKey = 'suishi-shanhai-replay-v2-overhaul';
const viewports = [390, 430, 1440, 360];
const pageErrors = [];
const consoleErrors = [];

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

async function prepareBattle(page) {
  return page.evaluate(async ({ saveKey, replayKey }) => {
    const [{ loadContent }, run, combat, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, registerCombatWorker, validateRunState } = run;
    const { calculateStats, simulateBattle } = combat;
    const { loadRun, saveRun } = persistence;

    // This fixture uses authored, equipable artifacts and the production combat
    // implementation for both the run and the later counterfactual replay.
    registerCombatWorker({ calculateStats, simulateBattle });
    const artifacts = [
      { id: 'RL08', stacks: 1 },
      { id: 'RC02', stacks: 3 },
    ];
    for (const stack of artifacts) {
      const entity = content.byId[stack.id];
      if (entity?.kind !== 'artifact' || !['core', 'support'].includes(entity.equipment_role) ||
          stack.stacks > entity.max_stacks) {
        throw new Error(`Battle comparison fixture has invalid authored equipment: ${stack.id}`);
      }
    }

    const game = ShanhaiGame.create(content, {
      seed: 'v2-battle-comparison-browser-real-engine',
      name: '法宝试演浏览器验收',
      method: 'RKF05',
    });
    game.state.artifacts = structuredClone(artifacts);
    game.state.equipment.slots = artifacts.map(stack => stack.id);
    game.state.hp = game.stats.max_hp;
    validateRunState(content, game.state);

    const node = game.availableNodes().find(candidate => candidate.type === 'C');
    if (!node) throw new Error('Battle comparison fixture has no reachable common battle');
    game.dispatch({ type: 'enter', id: node.key });
    if (game.state.phase !== 'preview') throw new Error('Fixture did not reach battle preview');
    game.dispatch({ type: 'fight' });
    if (game.state.phase !== 'battle' || !game.state.battleInput || !game.state.battle) {
      throw new Error('Fixture did not enter a real engine battle');
    }
    validateRunState(content, game.state);
    if (game.state.battle.frames.length <= 1) {
      throw new Error('Fixture battle needs multiple frames to exercise the skip-to-settlement control');
    }

    const saved = saveRun(game);
    const restored = loadRun(content);
    if (!restored?.state.battle || !restored.state.battleInput) {
      throw new Error('Saved battle did not restore through deterministic real-engine replay');
    }
    const battleFields = result => ({
      outcome: result.outcome,
      rounds: result.rounds,
      playerHp: result.playerHp,
      enemyHp: result.enemyHp,
    });
    const original = battleFields(game.state.battle);
    const restoredOriginal = battleFields(restored.state.battle);
    if (JSON.stringify(original) !== JSON.stringify(restoredOriginal)) {
      throw new Error(`Saved battle replay differs from the original: ${JSON.stringify({ original, restoredOriginal })}`);
    }

    localStorage.removeItem(saveKey);
    localStorage.removeItem(replayKey);
    const record = saveRun(game);
    return {
      artifactIds: artifacts.map(stack => stack.id),
      comparisonArtifactId: artifacts[1].id,
      seed: game.state.seed,
      battleSeed: game.state.battleInput.seed,
      frames: restored.state.battle.frames.length,
      original,
      restoredOriginal,
      savedAt: record.savedAt,
    };
  }, { saveKey, replayKey });
}

async function waitForBattlePause(page) {
  await page.waitForFunction(() => {
    const pause = document.querySelector('[data-action="battle-pause"]');
    return pause?.getAttribute('aria-pressed') === 'true';
  });
}

async function readSavedRun(page) {
  const raw = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(raw, 'Missing saved V2 battle');
  const record = JSON.parse(raw);
  assert.equal(record.key, saveKey);
  return { raw, state: record.state };
}

async function assertSavedRunUnchanged(page, before, point) {
  const after = await readSavedRun(page);
  assert.equal(after.raw, before.raw, `${point}: comparison changed the saved run record`);
  assert.deepEqual(after.state, before.state, `${point}: comparison changed run state, equipment, rewards, HP, or seed`);
}

function outcomeLabel(outcome) {
  return outcome === 'player' ? '玩家胜' : outcome === 'enemy' ? '敌人胜' : '平局';
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(0);
}

async function expectedComparison(page, artifactId) {
  return page.evaluate(async ({ saveKey, artifactId }) => {
    const [{ loadContent }, combat] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/combat.js'),
    ]);
    const content = await loadContent('/content/');
    const { calculateStats, simulateBattle } = combat;
    const saved = JSON.parse(localStorage.getItem(saveKey));
    const input = structuredClone(saved.state.battleInput);
    if (!input.player.artifacts.some(stack => stack.id === artifactId)) {
      throw new Error(`Selected artifact ${artifactId} is not in the frozen battle input`);
    }
    const playerWithoutArtifact = structuredClone(input.player);
    playerWithoutArtifact.artifacts = playerWithoutArtifact.artifacts
      .filter(stack => stack.id !== artifactId);
    const noArtifactResult = simulateBattle(
      content,
      playerWithoutArtifact,
      structuredClone(input.enemy),
      input.seed,
      { roundLimit: input.roundLimit, artifactAwakenings: input.rules === 'awakening-v1' },
    );
    const stats = loadout => calculateStats(content, structuredClone(loadout));
    const scenario = (result, player, enemy) => ({
      outcome: result.outcome,
      rounds: result.rounds,
      playerHp: result.playerHp,
      enemyHp: result.enemyHp,
      playerMaxHp: stats(player).max_hp,
      enemyMaxHp: stats(enemy).max_hp,
    });
    return {
      original: scenario(saved.state.battle, input.player, input.enemy),
      withoutArtifact: scenario(noArtifactResult, playerWithoutArtifact, input.enemy),
      inputSeed: input.seed,
      removedArtifact: artifactId,
    };
  }, { saveKey, artifactId });
}

function expectedScenario(label, result) {
  return [
    label,
    `${outcomeLabel(result.outcome)} · ${formatNumber(result.rounds)} 回合`,
    `我方气血 ${formatNumber(result.playerHp)} / ${formatNumber(result.playerMaxHp)} · 敌方气血 ${formatNumber(result.enemyHp)} / ${formatNumber(result.enemyMaxHp)}`,
  ];
}

async function readDisplayedScenarios(page) {
  return page.locator('.battle-comparison-results > div').evaluateAll(elements =>
    elements.map(element => [
      element.querySelector('b')?.innerText.trim() || '',
      ...[...element.querySelectorAll('span')].map(span => span.innerText.trim()),
    ]),
  );
}

async function assertResponsiveLayout(page, width) {
  const measurements = await page.evaluate(() => {
    const select = document.querySelector('[data-battle-comparison-artifact]');
    const button = document.querySelector('[data-action="battle-compare-artifact"]');
    const bounds = element => {
      const rect = element?.getBoundingClientRect();
      return rect ? { width: rect.width, height: rect.height, left: rect.left, right: rect.right } : null;
    };
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      sectionWidth: document.querySelector('.battle-result-detail')?.clientWidth ?? 0,
      sectionScrollWidth: document.querySelector('.battle-result-detail')?.scrollWidth ?? 0,
      select: bounds(select),
      button: bounds(button),
    };
  });
  assert.equal(measurements.viewport, width);
  assert.ok(measurements.documentWidth <= width + 1 && measurements.bodyWidth <= width + 1,
    `${width}: page has horizontal overflow ${JSON.stringify(measurements)}`);
  assert.ok(measurements.sectionWidth > 0 &&
    measurements.sectionScrollWidth <= measurements.sectionWidth + 1,
  `${width}: battle settlement overflows horizontally ${JSON.stringify(measurements)}`);
  assert.ok(measurements.select && measurements.select.width > 0 && measurements.select.height >= 44,
    `${width}: artifact selector touch target is smaller than 44px ${JSON.stringify(measurements)}`);
  assert.ok(measurements.button && measurements.button.width > 0 && measurements.button.height >= 44,
    `${width}: comparison button touch target is smaller than 44px ${JSON.stringify(measurements)}`);
  assert.ok(measurements.select.left >= -1 && measurements.select.right <= width + 1 &&
    measurements.button.left >= -1 && measurements.button.right <= width + 1,
  `${width}: comparison controls are outside the viewport ${JSON.stringify(measurements)}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    // Hold the animation in place, then exercise the actual skip-to-settlement button.
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        const pause = document.querySelector('[data-action="battle-pause"]');
        if (pause?.getAttribute('aria-pressed') === 'false') {
          observer.disconnect();
          pause.click();
        }
      });
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('.game-page, .landing-page').first().waitFor({ state: 'visible' });
    const fixture = await prepareBattle(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.game-page.phase-battle').waitFor({ state: 'visible' });
    await waitForBattlePause(page);

    const before = await readSavedRun(page);
    assert.equal(before.state.seed, fixture.seed);
    assert.deepEqual(before.state.equipment.slots, fixture.artifactIds);
    assert.equal(before.state.battleInput.player.artifacts.length, fixture.artifactIds.length);
    assert.equal(before.state.battle.frames.length, 0,
      'Persisted battle frames should be reconstructed from deterministic input');

    const skip = page.getByRole('button', { name: '跳过播放，跳至结算' });
    await skip.waitFor({ state: 'visible' });
    assert.match(await skip.innerText(), /跳至结算/);
    await skip.click();
    await page.locator('.battle-settlement').waitFor({ state: 'visible' });
    await assertSavedRunUnchanged(page, before, 'after skip to settlement');
    await page.locator('[data-action="battle-details"][data-tab="result"]').click();
    await page.locator('.battle-detail-dialog[role="dialog"]').waitFor({ state: 'visible' });

    const comparison = page.locator('details.battle-comparison');
    await comparison.locator('summary').click();
    await comparison.locator('.battle-comparison-body').waitFor({ state: 'visible' });
    assert.match(await comparison.locator('.battle-comparison-body').innerText(), /同一场战斗、同一命数/);
    assert.equal(await comparison.locator('[data-battle-comparison-artifact] option').count(),
      fixture.artifactIds.length);

    const select = comparison.locator('[data-battle-comparison-artifact]');
    await select.selectOption(fixture.comparisonArtifactId);
    await comparison.locator('[data-action="battle-compare-artifact"]').click();
    await page.waitForFunction(() =>
      document.querySelector('.battle-comparison-results') ||
      document.querySelector('.battle-comparison-message[role="status"]'),
      null,
      { timeout: 1500 },
    ).catch(() => undefined);
    const expected = await expectedComparison(page, fixture.comparisonArtifactId);
    assert.equal(expected.inputSeed, fixture.battleSeed, 'Counterfactual must use the frozen battle seed');
    assert.equal(expected.removedArtifact, fixture.comparisonArtifactId);
    let comparisonFailure = '';
    if (await comparison.locator('.battle-comparison-results').count()) {
      assert.deepEqual(
        await readDisplayedScenarios(page),
        [expectedScenario('本场', expected.original), expectedScenario('不带此宝', expected.withoutArtifact)],
        'Displayed original and no-artifact scenarios must match real-engine results',
      );
      assert.deepEqual({
        outcome: expected.original.outcome,
        rounds: expected.original.rounds,
        playerHp: expected.original.playerHp,
        enemyHp: expected.original.enemyHp,
      }, fixture.restoredOriginal, 'Displayed original must match the saved battle replay');

      const firstDisplay = await comparison.locator('.battle-comparison-results').innerText();
      await comparison.locator('[data-action="battle-compare-artifact"]').click();
      await page.waitForFunction(previous =>
        document.querySelector('.battle-comparison-results')?.innerText === previous,
      firstDisplay);
      assert.equal(await comparison.locator('.battle-comparison-results').innerText(), firstDisplay,
        'Repeated same-seed comparison returned different results');
    } else {
      const status = comparison.locator('.battle-comparison-message[role="status"]');
      const statusText = await status.count() ? await status.innerText() : '无加载状态、错误提示或试演结果';
      comparisonFailure = `点击“试演不带此宝”后未显示试演结果（${statusText}）；真实引擎原战=${JSON.stringify(expected.original)}，无宝=${JSON.stringify(expected.withoutArtifact)}。`;
      await comparison.locator('[data-action="battle-compare-artifact"]').click();
    }
    await assertSavedRunUnchanged(page, before, 'after repeated comparison');

    for (const width of viewports) {
      await page.setViewportSize({ width, height: width > 900 ? 900 : width === 360 ? 780 : 844 });
      await assertResponsiveLayout(page, width);
    }

    assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('\n')}`);
    assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join('\n')}`);
    await context.close();
    if (comparisonFailure) throw new Error(comparisonFailure);
    console.log(`Battle comparison browser acceptance passed at ${viewports.join(', ')}px.`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
