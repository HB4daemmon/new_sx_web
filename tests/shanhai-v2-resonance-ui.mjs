import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const viewports = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
];
const pageErrors = [];

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

async function installFixture(page, phase) {
  return page.evaluate(async ({ phase, saveKey }) => {
    const [{ loadContent }, { ShanhaiGame, registerCombatWorker }, { calculateStats }, { saveRun }] =
      await Promise.all([
        import('/shanhai/content.js'),
        import('/shanhai/run.js'),
        import('/shanhai/combat.js'),
        import('/shanhai/persistence.js'),
      ]);
    const content = await loadContent('/content/');
    const method = content.byId.RKF01;
    const artifact = content.byId.RC13;
    const methodEffect = [...(method.passives || []), ...(method.effects || [])]
      .find(effect => effect?.id === `${method.id}-V2-RESONANCE`);
    const artifactEffect = [...(artifact.passives || []), ...(artifact.effects || [])]
      .find(effect => effect?.id === `${artifact.id}-V2-RESONANCE`);
    if (!methodEffect || !artifactEffect) {
      throw new Error('V2 resonance UI fixture requires authored RKF01 and RC13 rules');
    }

    registerCombatWorker({
      calculateStats,
      simulateBattle(_content, player, enemy) {
        const playerStats = calculateStats(content, player);
        const enemyStats = calculateStats(content, enemy);
        const playerView = {
          name: player.name,
          method: player.method,
          hp: player.hp ?? playerStats.max_hp,
          maxHp: playerStats.max_hp,
          shield: player.preparation ?? 0,
          rage: 12,
          rageCap: 100,
          statuses: {},
          lockedAction: 'basic_action',
          counters: [
            { id: methodEffect.id, name: '盾压', value: 12, max: 20 },
            { id: artifactEffect.id, name: '反击', value: 2, max: 3 },
            { id: 'fixture-resonance-counter', name: '余息', value: 1, max: 2 },
            { id: 'fixture-furnace-counter', name: '炉火', value: 1200, max: 2400 },
            { id: 'fixture-breath-counter', name: '归元蓄击', value: 1, max: 1 },
          ],
        };
        const enemyView = {
          name: enemy.name,
          method: enemy.method,
          hp: enemy.hp ?? enemyStats.max_hp,
          maxHp: enemyStats.max_hp,
          shield: enemy.preparation ?? 0,
          rage: 0,
          rageCap: 100,
          statuses: {},
        };
        const nextPlayerView = {
          ...playerView,
          counters: playerView.counters.map((counter, index) => ({
            ...counter,
            value: [13, 2, 1, 1300, 1][index],
          })),
        };
        const finalPlayerView = {
          ...playerView,
          counters: playerView.counters.map((counter, index) => ({
            ...counter,
            value: [15, 3, 2, 1500, 0][index],
          })),
        };
        const frame = (kind, text, source, currentPlayer = playerView) => ({
          round: 1,
          kind,
          actor: 'player',
          source,
          text,
          player: currentPlayer,
          enemy: enemyView,
        });
        return {
          outcome: 'player',
          rounds: 1,
          playerHp: playerView.hp,
          enemyHp: enemyView.hp,
          frames: [
            frame('start', '交锋开始', methodEffect.id),
            frame('action', '普攻', artifactEffect.id, nextPlayerView),
            frame('end', '斗法结束', artifactEffect.id, finalPlayerView),
          ],
          contributions: [],
        };
      },
    });

    const game = ShanhaiGame.create(content, {
      seed: `v2-resonance-ui-${phase}`,
      name: '共鸣验收行者',
      method: method.id,
    });
    game.state.artifacts = [{ id: artifact.id, stacks: 1 }];
    game.state.equipment = { slots: [artifact.id] };
    if (phase === 'reward' || phase === 'battle') {
      const node = game.availableNodes().find(candidate => ['C', 'L', 'B'].includes(candidate.type));
      if (!node) throw new Error('V2 resonance UI fixture has no reachable battle node');
      game.dispatch({ type: 'enter', id: node.key });
      game.dispatch({ type: 'fight' });
      if (phase === 'reward') {
        game.dispatch({ type: 'battle_done' });
        if (game.state.phase !== 'reward') throw new Error('V2 resonance UI fixture did not reach reward');
        game.state.rewardCandidates = [artifact.id];
      }
    }
    const saved = saveRun(game);
    if (game.state.battle) {
      // These frames exercise UI rendering, not deterministic combat replay.
      saved.state.battle.frames = game.state.battle.frames;
      delete saved.replay;
    }
    localStorage.clear();
    localStorage.setItem(saveKey, JSON.stringify(saved));
    return {
      methodName: method.name,
      methodBrief: method.summary || methodEffect.text,
      methodRuleText: methodEffect.text,
      artifactName: artifact.name,
      artifactBrief: artifact.summary || artifactEffect.text,
      artifactRewardBrief: artifact.summary?.split(/[；;]/).slice(1).join('；').trim() ||
        artifact.summary || artifactEffect.text,
      artifactRuleText: artifactEffect.text,
    };
  }, { phase, saveKey });
}

async function waitForApp(page) {
  await page.locator('.landing-page, .game-page').first().waitFor({ state: 'visible' });
}

async function assertBattleCounterLayout(page, viewport, methodName, artifactName) {
  await page.locator('.combat-arena').waitFor({ state: 'visible' });
  const pause = page.locator('.battle-controls [data-action="battle-pause"]');
  if (await pause.isVisible() && await pause.getAttribute('aria-pressed') !== 'true') {
    await pause.click();
  }

  const metrics = await page.evaluate(() => {
    const arena = document.querySelector('.combat-arena');
    const fighter = arena?.querySelector('.combatant[data-side="player"]');
    const fighterRect = fighter?.getBoundingClientRect();
    const counters = fighter?.querySelector('.fighter-counters');
    const boxes = ['.fighter-art', '.fighter-identity', '.fighter-bars', '.fighter-counters']
      .map(selector => fighter?.querySelector(selector))
      .filter(element => element && !element.hidden)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { selector: element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    const counterRect = counters?.getBoundingClientRect();
    const arenaRect = arena?.getBoundingClientRect();
    const itemRects = [...(counters?.querySelectorAll('.fighter-counter') ?? [])].map(item => {
      const rect = item.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const overlaps = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 &&
      a.top < b.bottom - 1 && b.top < a.bottom - 1;
    return {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      arena: arenaRect && { left: arenaRect.left, right: arenaRect.right, width: arena.clientWidth },
      fighter: fighterRect && { left: fighterRect.left, right: fighterRect.right },
      counter: counterRect && {
        left: counterRect.left,
        right: counterRect.right,
        top: counterRect.top,
        bottom: counterRect.bottom,
        height: counters.clientHeight,
        scrollWidth: counters.scrollWidth,
      },
      boxes,
      itemRects,
      itemEscapesCounter: itemRects.some(item => !counterRect ||
        item.left < counterRect.left - 1 || item.right > counterRect.right + 1),
      flowOverlaps: boxes.some((box, index) =>
        boxes.slice(index + 1).some(other => overlaps(box, other))),
      itemOverlaps: itemRects.some((box, index) =>
        itemRects.slice(index + 1).some(other => overlaps(box, other))),
      values: counters?.innerText.trim() || '',
      count: counters?.querySelectorAll('.fighter-counter').length || 0,
    };
  });
  assert.equal(metrics.count, 5, `${viewport.width}: fighter counter fixture did not render ${JSON.stringify(metrics)}`);
  assert.match(metrics.values, /盾压\s*\d+\s*\/\s*20/);
  assert.match(metrics.values, /反击\s*\d+\s*\/\s*3/);
  assert.ok(metrics.counter && metrics.fighter &&
    metrics.counter.left >= metrics.fighter.left - 1 &&
    metrics.counter.right <= metrics.fighter.right + 1,
  `${viewport.width}: counter line escaped its fighter panel ${JSON.stringify(metrics)}`);
  assert.ok(metrics.counter && metrics.counter.scrollWidth <= metrics.counter.right - metrics.counter.left + 1,
    `${viewport.width}: counter line has horizontal overflow ${JSON.stringify(metrics)}`);
  assert.ok(metrics.counter && metrics.counter.height <= 140,
    `${viewport.width}: counter wrapping exceeded its bounded height ${JSON.stringify(metrics)}`);
  assert.equal(metrics.flowOverlaps, false, `${viewport.width}: counter line overlaps fighter content ${JSON.stringify(metrics)}`);
  assert.equal(metrics.itemOverlaps, false, `${viewport.width}: counter chips overlap ${JSON.stringify(metrics)}`);
  assert.equal(metrics.itemEscapesCounter, false,
    `${viewport.width}: counter chips escape their line ${JSON.stringify(metrics)}`);
  assert.ok(metrics.documentWidth <= viewport.width + 1 && metrics.bodyWidth <= viewport.width + 1,
    `${viewport.width}: battle view has horizontal overflow ${JSON.stringify(metrics)}`);

  const skip = page.locator('.battle-shell [data-action="battle-skip"]');
  if (await skip.isVisible()) await skip.click();
  const finalCounters = await page.locator('.combatant[data-side="player"] .fighter-counters').innerText();
  assert.match(finalCounters, /盾压\s*15\s*\/\s*20/,
    `${viewport.width}: counter snapshot did not update during replay`);
  assert.match(finalCounters, /反击\s*3\s*\/\s*3/,
    `${viewport.width}: artifact counter snapshot did not update during replay`);
  await page.locator('.battle-shell [data-action="battle-details"][data-tab="log"]').click();
  const log = page.locator('.battle-detail-dialog .battle-log');
  await log.waitFor({ state: 'visible' });
  assert.ok((await log.innerText()).includes(`${methodName}·共鸣`),
    `${viewport.width}: resonance source label is missing from the combat log`);
  assert.ok((await log.innerText()).includes(`${artifactName}·共鸣`),
    `${viewport.width}: artifact resonance source label is missing from the combat log`);
}

async function run() {
  const { chromium } = playwrightModule();
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        isMobile: viewport.width < 700,
        hasTouch: viewport.width < 700,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => pageErrors.push(`${viewport.width}: ${error.message}`));

      await page.goto(url, { waitUntil: 'networkidle' });
      await waitForApp(page);
      await page.locator('.method-choice[data-id="RKF01"]').click();
      const landing = await page.evaluate(async () => {
        const { loadContent } = await import('/shanhai/content.js');
        const content = await loadContent('/content/');
        const method = content.byId.RKF01;
        const effect = [...(method.passives || []), ...(method.effects || [])]
          .find(item => item?.id === `${method.id}-V2-RESONANCE`);
        if (!effect) throw new Error('RKF01 V2 resonance effect is missing');
        return { brief: method.summary || effect.text, ruleText: effect.text };
      });
      const choiceBrief = page.locator('.method-quick-actions .method-resonance-brief');
      await choiceBrief.waitFor({ state: 'visible' });
      assert.ok((await choiceBrief.innerText()).includes(landing.brief),
        `${viewport.width}: method choice does not show authored resonance copy`);
      await page.locator('.method-full-detail > summary').click();
      assert.ok((await page.locator('.method-full-detail .resonance-details').innerText())
        .includes(landing.ruleText),
      `${viewport.width}: full method resonance rule is missing from details`);

      const build = await installFixture(page, 'map');
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.game-page').waitFor({ state: 'visible' });
      const buildTab = page.locator('.bottom-nav [data-action="tab"][data-id="build"]');
      await (await buildTab.isVisible()
        ? buildTab
        : page.locator('.desktop-nav [data-action="tab"][data-id="build"]')).click();
      await page.locator('.game-layout.view-build .equipment-section').waitFor({ state: 'visible' });
      assert.ok((await page.locator('.build-resonance-brief').innerText()).includes(build.methodBrief),
        `${viewport.width}: build page does not show authored method resonance copy`);
      assert.ok((await page.locator(`.equipment-slot-item[data-id="RC13"] .equipment-resonance-brief`).innerText())
        .includes(build.artifactBrief),
      `${viewport.width}: equipped artifact card does not show authored resonance copy`);
      await page.locator('[data-action="build-filter"][data-filter="all"]').click();
      const artifactCard = page.locator('.deck-grid .ability-card[data-id="RC13"]');
      await artifactCard.waitFor({ state: 'visible' });
      assert.ok((await artifactCard.innerText()).includes(build.artifactBrief),
        `${viewport.width}: artifact catalog card does not show authored resonance copy`);
      await page.locator('.equipment-slot-item[data-id="RC13"]').click();
      const artifactDialog = page.locator('.item-dialog[role="dialog"]');
      await artifactDialog.waitFor({ state: 'visible' });
      assert.ok((await artifactDialog.locator('.effect-list').innerText()).includes(build.artifactRuleText),
        `${viewport.width}: full artifact resonance rule is missing from details`);
      await page.keyboard.press('Escape');
      await artifactDialog.waitFor({ state: 'detached' });

      const reward = await installFixture(page, 'reward');
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.game-page.phase-reward').waitFor({ state: 'visible' });
      const rewardCard = page.locator('.reward-card[data-id="RC13"]');
      await rewardCard.waitFor({ state: 'visible' });
      assert.ok((await rewardCard.locator('.reward-mechanic').innerText()).includes(reward.artifactRewardBrief),
        `${viewport.width}: reward card does not show authored resonance copy`);
      assert.equal(await rewardCard.locator('[data-action="reward"][data-id="RC13"]').count(), 1,
        `${viewport.width}: resonance copy added a duplicate reward action`);

      const battle = await installFixture(page, 'battle');
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.game-page.phase-battle').waitFor({ state: 'visible' });
      await assertBattleCounterLayout(page, viewport, battle.methodName, battle.artifactName);
      assert.deepEqual(pageErrors.filter(error => error.startsWith(`${viewport.width}:`)), [],
        `${viewport.width}: page reported an uncaught error`);
      await context.close();
    }
    assert.deepEqual(pageErrors, [], `Page reported uncaught errors: ${pageErrors.join(' | ')}`);
    console.log('ok - V2 resonance source labels, authored UI copy and battle counters at 360/390/430/1440px');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
