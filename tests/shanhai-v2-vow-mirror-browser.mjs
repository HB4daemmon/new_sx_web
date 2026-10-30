import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4178/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const replayKey = 'suishi-shanhai-replay-v2-overhaul';
const viewports = [360, 390, 430, 1440];
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
      // Try the next preinstalled local Playwright cache.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

const { chromium } = playwrightModule();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';

function trackPage(page, label) {
  page.on('pageerror', error => pageErrors.push(`${label}: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text()}`);
  });
}

async function waitForGame(page, phase) {
  await page.locator('.game-page').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const game = document.querySelector('.game-page');
    return game && !game.classList.contains('phase-loading');
  });
  if (phase) {
    await page.waitForFunction(({ saveKey, phase }) => {
      try {
        return JSON.parse(localStorage.getItem(saveKey) || 'null')?.state?.phase === phase;
      } catch {
        return false;
      }
    }, { saveKey, phase });
  }
}

async function readSave(page) {
  const text = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(text, 'Missing V2 run save');
  const parsed = JSON.parse(text);
  assert.ok(parsed?.state, 'V2 run save has no state');
  return parsed;
}

async function openBuild(page) {
  if (await page.locator('.game-layout.view-build .equipment-section').count()) return;
  const mobileTab = page.locator('.bottom-nav [data-action="tab"][data-id="build"]');
  const desktopTab = page.locator('.desktop-nav [data-action="tab"][data-id="build"]');
  const tab = await mobileTab.isVisible() ? mobileTab : desktopTab;
  await tab.click();
  await page.locator('.game-layout.view-build .equipment-section').waitFor({ state: 'visible' });
}

async function openJourney(page) {
  const mobileTab = page.locator('.bottom-nav [data-action="tab"][data-id="journey"]');
  const desktopTab = page.locator('.desktop-nav [data-action="tab"][data-id="journey"]');
  const tab = await mobileTab.isVisible() ? mobileTab : desktopTab;
  await tab.click();
}

async function assertNoPageOverflow(page, width, label) {
  await page.setViewportSize({ width, height: width >= 900 ? 900 : 844 });
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(metrics.documentWidth <= width + 1 && metrics.bodyWidth <= width + 1,
    `${label} at ${width}px has page overflow: ${JSON.stringify(metrics)}`);
}

async function installVowCandidate(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  const fixture = await page.evaluate(async ({ saveKey, replayKey }) => {
    const [{ loadContent }, run, combat, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, registerCombatWorker, validateRunState } = run;
    const { calculateStats, simulateBattle } = combat;
    const { saveRun } = persistence;
    const getEntity = id => content.byId instanceof Map
      ? content.byId.get(id)
      : content.byId?.[id] ?? content.entities.find(entity => entity.id === id);
    const vow = content.rules.insights.find(item => item.id === 'V2-J1-G');
    const mirror = getEntity('RL08');
    if (!vow || !mirror) throw new Error('4178 is not serving the V2-J1-G and RL08 content build');
    if (mirror.mirror_rule?.kind !== 'neighbor_awakening') throw new Error('RL08 mirror rule is missing');
    registerCombatWorker({ calculateStats, simulateBattle });

    const firstTierXp = getEntity('RULES')?.cultivation?.cumulative?.[0];
    if (!Number.isFinite(firstTierXp)) throw new Error('First breakthrough XP is missing from real content');
    const method = 'RKF03';
    let selectedSeed;
    for (let index = 0; index < 4096; index++) {
      const seed = `v2-vow-browser-${index}`;
      const probe = ShanhaiGame.create(content, { seed, name: '断生誓约验收', method });
      probe.state.xp = firstTierXp;
      if (probe.availableTalents().some(candidate => candidate.id === 'V2-J1-G')) {
        selectedSeed = seed;
        break;
      }
    }
    if (!selectedSeed) throw new Error('Could not find a legal seed offering V2-J1-G at the first breakthrough');

    const game = ShanhaiGame.create(content, {
      seed: selectedSeed,
      name: '断生誓约验收',
      method,
    });
    // A second authored start method makes the later in-run swap visible in the UI.
    game.state.ownedMethods.push('RKF01');
    game.state.talents.RKF01 = [];
    game.state.coins = 200;
    validateRunState(content, game.state);

    function chooseAvailableTalent(excludeVow = false) {
      const candidates = game.availableTalents();
      const candidate = candidates.find(item => !excludeVow || item.id !== 'V2-J1-G') || candidates[0];
      if (!candidate) throw new Error('A legal breakthrough must offer a talent');
      game.dispatch({ type: 'talent', id: candidate.id });
      return candidate.id;
    }

    function settleBattle() {
      let battle = game.state.battle;
      if (!battle && game.state.phase === 'preview') {
        game.dispatch({ type: 'fight' });
        battle = game.state.battle;
      }
      if (!battle) throw new Error(`Expected a real battle result, phase is ${game.state.phase}`);
      let continuations = 0;
      while (battle.outcome === 'draw' && continuations < 4) {
        game.dispatch({ type: 'continue_battle' });
        battle = game.state.battle;
        continuations++;
      }
      if (battle.outcome !== 'player') throw new Error(`Legal fixture route lost a real battle (${battle.outcome})`);
      game.dispatch({ type: 'battle_done' });
      if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
    }

    function settleEvent(routeNode) {
      const event = getEntity(routeNode.id);
      const option = event?.options?.find(candidate =>
        !candidate.rewards?.some(reward => reward.type === 'swap_method') &&
        game.optionAvailability(candidate.id).available);
      if (!option) throw new Error(`No available non-swap option on ${routeNode.id}`);
      game.dispatch({ type: 'event', id: option.id });
      if (game.state.phase === 'preview') settleBattle();
      if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
    }

    let visited = 0;
    while (game.state.phase !== 'talent' && visited < 8) {
      const nodes = game.availableNodes();
      const target = nodes.find(node => node.type === 'C') || nodes[0];
      if (!target) throw new Error('No legal route node is available before the first breakthrough');
      game.dispatch({ type: 'enter', id: target.key });
      if (['C', 'L', 'B', 'F'].includes(target.type)) settleBattle();
      else if (target.type === 'E' || target.type === 'K') settleEvent(target);
      else if (game.state.phase === 'rest') game.dispatch({ type: 'rest', choice: 'preparation' });
      else if (game.state.phase === 'shop') game.dispatch({ type: 'leave_shop' });
      if (game.state.phase === 'talent') break;
      while (game.state.phase === 'talent') chooseAvailableTalent(true);
      visited++;
    }
    if (game.state.phase !== 'talent') throw new Error('Real route did not reach the first breakthrough');
    const offeredIds = game.availableTalents().map(candidate => candidate.id);
    if (!offeredIds.includes('V2-J1-G')) throw new Error('The live draft does not contain V2-J1-G');
    validateRunState(content, game.state);
    localStorage.removeItem(saveKey);
    localStorage.removeItem(replayKey);
    saveRun(game);
    return { seed: selectedSeed, offeredIds, phase: game.state.phase, step: game.state.step };
  }, { saveKey, replayKey });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForGame(page, fixture.phase);
  return fixture;
}

async function prepareService(page, type) {
  return page.evaluate(async ({ saveKey, type }) => {
    const [{ loadContent }, run, combat, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, registerCombatWorker, validateRunState } = run;
    const { calculateStats, simulateBattle } = combat;
    const { parseRunSave, saveRun } = persistence;
    const getEntity = id => content.byId instanceof Map
      ? content.byId.get(id)
      : content.byId?.[id] ?? content.entities.find(entity => entity.id === id);
    registerCombatWorker({ calculateStats, simulateBattle });
    const serialized = localStorage.getItem(saveKey);
    if (!serialized) throw new Error('Vow save disappeared before the legal route continued');
    const game = new ShanhaiGame(content, parseRunSave(content, serialized));
    if (game.state.phase !== 'map' || !game.state.bloodVow) {
      throw new Error(`Expected a saved map run with the permanent vow, got ${game.state.phase}`);
    }

    function choosePendingTalents() {
      while (game.state.phase === 'talent') {
        const offered = game.availableTalents();
        const choice = offered.find(candidate => candidate.id !== 'V2-J1-G') || offered[0];
        if (!choice) throw new Error('A route breakthrough had no authored talent choice');
        game.dispatch({ type: 'talent', id: choice.id });
      }
    }

    function pathTo(target) {
      const byKey = new Map(game.state.routeMap.nodes.map(node => [node.key, node]));
      for (const start of game.availableNodes()) {
        const pending = [[start.key]];
        while (pending.length) {
          const path = pending.shift();
          const current = byKey.get(path.at(-1));
          if (current?.key === target.key) return path;
          for (const next of current?.next || []) {
            if (!path.includes(next)) pending.push([...path, next]);
          }
        }
      }
      return null;
    }

    const targets = game.state.routeMap.nodes
      .filter(node => node.type === type)
      .sort((left, right) => left.depth - right.depth);
    let route;
    let destination;
    for (const candidate of targets) {
      const candidatePath = pathTo(candidate);
      if (candidatePath) {
        route = candidatePath;
        destination = candidate;
        break;
      }
    }
    if (!route || !destination) throw new Error(`No reachable ${type} service node remains in this act`);
    for (let index = 0; index < route.length; index++) {
      const key = route[index];
      const routeNode = game.state.routeMap.nodes.find(node => node.key === key);
      if (!routeNode) throw new Error(`Missing route node ${key}`);
      if (!game.availableNodes().some(node => node.key === key)) {
        throw new Error(`Planned legal route node ${key} is not currently reachable`);
      }
      game.dispatch({ type: 'enter', id: key });
      if (index === route.length - 1) break;

      if (['C', 'L', 'B', 'F'].includes(routeNode.type)) {
        // enterNode has already moved to preview; settleBattle expects a battle.
        let battle = game.state.battle;
        if (!battle) {
          game.dispatch({ type: 'fight' });
          battle = game.state.battle;
        }
        if (!battle) throw new Error(`Could not start the real fight at ${key}`);
        let continuations = 0;
        while (battle.outcome === 'draw' && continuations < 4) {
          game.dispatch({ type: 'continue_battle' });
          battle = game.state.battle;
          continuations++;
        }
        if (battle.outcome !== 'player') throw new Error(`Vow route lost at ${key} (${battle.outcome})`);
        game.dispatch({ type: 'battle_done' });
        if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
        choosePendingTalents();
      } else if (routeNode.type === 'E' || routeNode.type === 'K') {
        const event = getEntity(routeNode.id);
        const option = event?.options?.find(candidate =>
          !candidate.rewards?.some(reward => reward.type === 'swap_method') &&
          game.optionAvailability(candidate.id).available);
        if (!option) throw new Error(`No legal event choice at ${routeNode.id}`);
        game.dispatch({ type: 'event', id: option.id });
        if (game.state.phase === 'preview') {
          game.dispatch({ type: 'fight' });
          let battle = game.state.battle;
          let continuations = 0;
          while (battle?.outcome === 'draw' && continuations < 4) {
            game.dispatch({ type: 'continue_battle' });
            battle = game.state.battle;
            continuations++;
          }
          if (battle?.outcome !== 'player') throw new Error(`Vow route lost an event fight at ${routeNode.id}`);
          game.dispatch({ type: 'battle_done' });
        }
        if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
        choosePendingTalents();
      } else if (game.state.phase === 'rest') {
        game.dispatch({ type: 'rest', choice: 'preparation' });
        choosePendingTalents();
      } else if (game.state.phase === 'shop') {
        game.dispatch({ type: 'leave_shop' });
      } else {
        throw new Error(`Unexpected ${game.state.phase} at route node ${key}`);
      }
    }

    if (game.state.phase !== (type === 'R' ? 'rest' : 'shop')) {
      throw new Error(`Legal route arrived at phase ${game.state.phase}, expected ${type === 'R' ? 'rest' : 'shop'}`);
    }
    if (type === 'R') {
      game.state.hp = Math.min(game.state.hp, game.stats.max_hp - 1);
      game.state.hp = Math.max(1, game.state.hp);
    }
    validateRunState(content, game.state);
    saveRun(game);
    return {
      type,
      phase: game.state.phase,
      step: game.state.step,
      method: game.state.method,
      hp: game.state.hp,
      maxHp: game.stats.max_hp,
      coins: game.state.coins,
      route: route.map(key => game.state.routeMap.nodes.find(node => node.key === key)?.type),
    };
  }, { saveKey, type });
}

async function assertVowFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  trackPage(page, 'vow');
  try {
    const fixture = await installVowCandidate(page);
    assert.equal(fixture.phase, 'talent');
    const vowCard = page.locator('.talent-candidate[data-id="V2-J1-G"]');
    await vowCard.waitFor({ state: 'visible' });
    assert.match(await vowCard.getAttribute('class'), /is-shared/);
    const prompt = await vowCard.innerText();
    assert.match(prompt, /断生入魔/);
    assert.match(prompt, /共通洞见/);
    assert.match(prompt, /本局永久战外禁疗/);
    assert.match(prompt, /换法洗点不解除/);
    assert.match(prompt, /治疗×1\.5/);
    assert.match(prompt, /直伤与派生伤害×1\.35/);
    await page.screenshot({ path: '/tmp/shanhai-v2-vow-candidate.png', fullPage: true });
    for (const width of viewports) await assertNoPageOverflow(page, width, 'vow candidate');

    await page.setViewportSize({ width: 390, height: 844 });
    await vowCard.locator('[data-action="talent"]').click();
    await waitForGame(page, 'map');
    let save = await readSave(page);
    assert.equal(save.state.bloodVow, true, 'Selecting V2-J1-G must persist the permanent vow marker');
    assert.ok(save.state.talents[save.state.method].includes('V2-J1-G'));

    const rest = await prepareService(page, 'R');
    assert.equal(rest.phase, 'rest');
    await page.reload({ waitUntil: 'networkidle' });
    await waitForGame(page, 'rest');
    const healChoice = page.locator('.rest-choice[data-choice="heal"]');
    assert.equal(await healChoice.isDisabled(), true, 'Rest healing must be disabled after the vow');
    assert.match(await healChoice.innerText(), /断生之誓：本局战外无法回血/);
    save = await readSave(page);
    const beforeBlockedRest = { hp: save.state.hp, coins: save.state.coins };
    assert.ok(beforeBlockedRest.hp < rest.maxHp,
      'The rest fixture should make an attempted heal meaningful');
    await page.screenshot({ path: '/tmp/shanhai-v2-vow-rest.png', fullPage: true });
    for (const width of viewports) await assertNoPageOverflow(page, width, 'vow rest');
    const unchangedRest = await readSave(page);
    assert.equal(unchangedRest.state.hp, beforeBlockedRest.hp);
    assert.equal(unchangedRest.state.coins, beforeBlockedRest.coins);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('details[data-details="rest-swap"] > summary').click();
    await page.locator('[data-action="rest-method"][data-id="RKF01"]').click();
    await waitForGame(page, 'talent');
    save = await readSave(page);
    assert.equal(save.state.method, 'RKF01');
    assert.equal(save.state.bloodVow, true, 'Changing the active method must retain the vow');
    const swapChoices = save.state.talentDrafts['RKF01:1:0'];
    const swapTalentId = swapChoices?.find(id => id !== 'V2-J1-G') || swapChoices?.[0];
    assert.ok(swapTalentId, 'Method swap should produce a legal first-tier draft');
    await page.locator(`.talent-candidate[data-id="${swapTalentId}"] [data-action="talent"]`).click();
    await waitForGame(page, 'map');
    save = await readSave(page);
    assert.equal(save.state.bloodVow, true);
    assert.ok(!save.state.talents.RKF01.includes('V2-J1-G'), 'The swapped method should keep its own selected talent');

    await openBuild(page);
    assert.match(await page.locator('.build-focus').innerText(), /本局战外无法回血，换法或洗点也不会解除/);
    await page.screenshot({ path: '/tmp/shanhai-v2-vow-after-method-swap.png', fullPage: true });

    const shop = await prepareService(page, 'S');
    assert.equal(shop.phase, 'shop');
    await page.reload({ waitUntil: 'networkidle' });
    await waitForGame(page, 'shop');
    const recovery = page.locator('.shop-item.service-recovery');
    await recovery.waitFor({ state: 'visible' });
    assert.equal(await recovery.locator('[data-action="buy"]').isDisabled(), true,
      'The recovery service must be disabled by the permanent vow');
    assert.match(await recovery.locator('.shop-item-unavailable').innerText(), /断生之誓：本局战外无法回血/);
    save = await readSave(page);
    const beforeBlockedShop = { hp: save.state.hp, coins: save.state.coins };
    await page.screenshot({ path: '/tmp/shanhai-v2-vow-shop-recovery.png', fullPage: true });
    for (const width of viewports) await assertNoPageOverflow(page, width, 'vow shop');
    const unchangedShop = await readSave(page);
    assert.equal(unchangedShop.state.hp, beforeBlockedShop.hp);
    assert.equal(unchangedShop.state.coins, beforeBlockedShop.coins);

    await page.setViewportSize({ width: 390, height: 844 });
    const resetPurchase = page.locator('.shop-item.service-talent_reset [data-action="buy"][data-id="talent_reset"]');
    assert.equal(await resetPurchase.isDisabled(), false, 'The real talent reset should remain purchasable');
    await resetPurchase.click();
    const resetDialog = page.locator('.talent-reset-dialog[role="dialog"]');
    await resetDialog.waitFor({ state: 'visible' });
    const confirmation = await resetDialog.innerText();
    assert.match(confirmation, /断生之誓不会解除/);
    assert.match(confirmation, /不再选中断生入魔时，战斗增益也不再生效/);
    await page.screenshot({ path: '/tmp/shanhai-v2-vow-reset-confirm.png', fullPage: true });
    const beforeReset = await readSave(page);
    await resetDialog.locator('[data-action="confirm-talent-reset"]').click();
    await waitForGame(page, 'talent');
    let afterReset = await readSave(page);
    assert.equal(afterReset.state.bloodVow, true, 'The reset prompt must correspond to a lasting vow');
    assert.equal(afterReset.state.shop.find(item => item.id === 'talent_reset')?.sold, true);
    assert.ok(!afterReset.state.talents[afterReset.state.method].includes('V2-J1-G'));
    assert.ok(afterReset.state.coins < beforeReset.state.coins, 'Confirmed talent reset should charge its real price');
    const resetDraft = afterReset.state.talentDrafts[`${afterReset.state.method}:1:${afterReset.state.talentDraftGeneration}`];
    const resetChoice = resetDraft?.find(id => id !== 'V2-J1-G') || resetDraft?.[0];
    assert.ok(resetChoice, 'Talent reset should open a real replacement draft');
    await page.locator(`.talent-candidate[data-id="${resetChoice}"] [data-action="talent"]`).click();
    await waitForGame(page, 'shop');
    afterReset = await readSave(page);
    assert.equal(afterReset.state.bloodVow, true, 'Washing out the talent must not wash out the run marker');
    assert.ok(!afterReset.state.talents[afterReset.state.method].includes('V2-J1-G'));
    await page.reload({ waitUntil: 'networkidle' });
    await waitForGame(page, 'shop');
    assert.equal((await readSave(page)).state.bloodVow, true, 'The run marker must survive a real save reload');
    assert.equal(await page.locator('.shop-item.service-recovery [data-action="buy"]').isDisabled(), true,
      'Healing must remain unavailable after reload and talent reset');
    assert.match(await page.locator('.shop-item.service-recovery .shop-item-unavailable').innerText(),
      /断生之誓：本局战外无法回血/);
    await page.screenshot({ path: '/tmp/shanhai-v2-vow-after-reset-reload.png', fullPage: true });
    console.log(`Vow flow passed: seed=${fixture.seed}, initial step=${fixture.step}, rest=${rest.step}, shop=${shop.step}`);
  } finally {
    await context.close();
  }
}

async function installMirrorFixture(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  const fixture = await page.evaluate(async ({ saveKey, replayKey }) => {
    const [{ loadContent }, run, combat, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, registerCombatWorker, validateRunState } = run;
    const { calculateStats, simulateBattle } = combat;
    const { saveRun } = persistence;
    const getEntity = id => content.byId instanceof Map
      ? content.byId.get(id)
      : content.byId?.[id] ?? content.entities.find(entity => entity.id === id);
    registerCombatWorker({ calculateStats, simulateBattle });
    const mirror = getEntity('RL08');
    const qingfeng = getEntity('RC01');
    if (!mirror || mirror.mirror_rule?.kind !== 'neighbor_awakening') {
      throw new Error('Real RL08 mirror artifact is not in served content');
    }
    if (!qingfeng?.awakening || qingfeng.awakening.at_stacks !== qingfeng.max_stacks) {
      throw new Error('Real Qingfeng full-stack awakening is not in served content');
    }
    const game = ShanhaiGame.create(content, {
      seed: 'v2-vow-mirror-browser-real-battle',
      name: '昆仑镜邻位验收',
      method: 'RKF01',
    });
    game.state.artifacts = [
      { id: 'RC01', stacks: qingfeng.max_stacks },
      { id: 'RL08', stacks: 1 },
    ];
    game.state.equipment.slots = ['RC01', 'RL08'];
    validateRunState(content, game.state);
    localStorage.removeItem(saveKey);
    localStorage.removeItem(replayKey);
    saveRun(game);
    return {
      ids: { mirror: mirror.id, neighbor: qingfeng.id },
      slots: [...game.state.equipment.slots],
      neighborStacks: qingfeng.max_stacks,
      phase: game.state.phase,
    };
  }, { saveKey, replayKey });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForGame(page, fixture.phase);
  return fixture;
}

async function openArtifactDetails(page, id) {
  await page.locator(`.equipment-section [data-action="inspect-artifact"][data-id="${id}"]`).click();
  const detail = page.locator('.item-dialog[role="dialog"]');
  await detail.waitFor({ state: 'visible' });
  return detail;
}

async function assertMirrorBoard(page, width) {
  await openBuild(page);
  const layout = await page.evaluate(() => {
    const board = document.querySelector('.equipment-section');
    const grid = board?.querySelector('.equipment-slot-grid');
    const dialog = document.querySelector('.item-dialog');
    const dialogRect = dialog?.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      boardWidth: board?.clientWidth,
      boardScrollWidth: board?.scrollWidth,
      gridWidth: grid?.clientWidth,
      gridScrollWidth: grid?.scrollWidth,
      occupied: [...(grid?.querySelectorAll('.equipment-slot.is-filled') ?? [])].map(slot => ({
        number: slot.getAttribute('data-slot'),
        text: slot.innerText,
      })),
      dialogWidth: dialog?.clientWidth,
      dialogScrollWidth: dialog?.scrollWidth,
      dialogLeft: dialogRect?.left,
      dialogRight: dialogRect?.right,
    };
  });
  assert.ok(layout.boardWidth && layout.boardWidth > 0, `${width}: equipment board is missing`);
  assert.ok(layout.documentWidth <= width + 1 && layout.bodyWidth <= width + 1,
    `${width}: mirror board causes page overflow ${JSON.stringify(layout)}`);
  assert.ok(layout.boardScrollWidth <= layout.boardWidth + 1 && layout.gridScrollWidth <= layout.gridWidth + 1,
    `${width}: equipment board itself overflows ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.occupied.map(slot => slot.number), ['1', '2'],
    `${width}: the mirror and full-stack neighbor must remain in adjacent numbered slots`);
  if (layout.dialogWidth !== undefined) {
    assert.ok(layout.dialogWidth > 0 && layout.dialogScrollWidth <= layout.dialogWidth + 1,
      `${width}: artifact detail dialog overflows ${JSON.stringify(layout)}`);
    assert.ok(layout.dialogLeft >= -1 && layout.dialogRight <= width + 1,
      `${width}: artifact detail dialog is outside the viewport ${JSON.stringify(layout)}`);
  }
}

async function assertMirrorFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  trackPage(page, 'mirror');
  try {
    const fixture = await installMirrorFixture(page);
    assert.equal(fixture.phase, 'map');
    assert.deepEqual(fixture.slots, ['RC01', 'RL08']);
    await openBuild(page);
    assert.match(await page.locator('.equipment-slot[data-slot="2"]').innerText(), /右侧无器物/);

    let detail = await openArtifactDetails(page, 'RL08');
    assert.match(await detail.locator('.equipment-status').innerText(), /已装备 · 装备位 2/);
    assert.match(await detail.locator('.item-dialog-summary').innerText(), /紧邻右侧已装备、层数已达其上限/);
    assert.match(await detail.locator('.item-dialog-summary').innerText(), /不复制属性、行旅、核心规则、融合或自己/);
    await page.screenshot({ path: '/tmp/shanhai-v2-mirror-neighbor-limits.png', fullPage: true });
    for (const width of viewports) {
      await page.setViewportSize({ width, height: width >= 900 ? 900 : 844 });
      await assertMirrorBoard(page, width);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await detail.locator('.equipment-order-button[data-direction="left"]').click();
    let save = await readSave(page);
    assert.deepEqual(save.state.equipment.slots, ['RL08', 'RC01'],
      'Using the real left-reorder control should place RL08 beside RC01');
    assert.match(await page.locator('.item-dialog .equipment-status').innerText(), /装备位 1/);
    assert.match(await page.locator('.item-dialog .mirror-target-status').innerText(), /当前镜映：青锋石/);
    await detail.locator('.dialog-close[data-action="modal-close"]').click();

    await page.reload({ waitUntil: 'networkidle' });
    await waitForGame(page, 'map');
    save = await readSave(page);
    assert.deepEqual(save.state.equipment.slots, ['RL08', 'RC01'],
      'The real equipment order must persist across reload');
    await openBuild(page);
    const firstSlot = page.locator('.equipment-section .equipment-slot[data-slot="1"]');
    const secondSlot = page.locator('.equipment-section .equipment-slot[data-slot="2"]');
    assert.match(await firstSlot.innerText(), /昆仑镜/);
    assert.match(await firstSlot.innerText(), /镜映待出手触发/);
    assert.match(await secondSlot.innerText(), /青锋石/);
    detail = await openArtifactDetails(page, 'RL08');
    assert.match(await detail.locator('.equipment-status').innerText(), /已装备 · 装备位 1/);
    assert.match(await detail.locator('.item-dialog-summary').innerText(), /紧邻右侧已装备、层数已达其上限/);
    await detail.locator('.dialog-close[data-action="modal-close"]').click();
    detail = await openArtifactDetails(page, 'RC01');
    assert.match(await detail.locator('.equipment-status').innerText(), /已装备 · 装备位 2/);
    assert.match(await detail.locator('.artifact-awakening').innerText(), /已达第 5 层/);
    assert.match(await detail.locator('.artifact-awakening').innerText(), /每次普攻完成后额外造成0\.18倍攻击伤害/);
    await page.screenshot({ path: '/tmp/shanhai-v2-mirror-adjacent-full-qingfeng.png', fullPage: true });
    await detail.locator('.dialog-close[data-action="modal-close"]').click();

    for (const width of viewports) {
      await page.setViewportSize({ width, height: width >= 900 ? 900 : 844 });
      await assertMirrorBoard(page, width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await openJourney(page);
    const commonNode = page.locator('.map-node.available[data-node-type="C"]').first();
    await commonNode.waitFor({ state: 'visible' });
    await commonNode.click();
    await page.locator('.node-preview-dialog[role="dialog"]').waitFor({ state: 'visible' });
    await page.locator('.node-preview-dialog [data-action="confirm-node"]').click();
    await page.locator('[data-action="fight"]').waitFor({ state: 'visible' });
    await page.locator('[data-action="fight"]').click();
    await waitForGame(page, 'battle');
    save = await readSave(page);
    assert.deepEqual(save.state.equipment.slots, ['RL08', 'RC01']);
    assert.ok(save.state.battleInput?.player.artifacts.some(item => item.id === 'RL08' && item.stacks === 1));
    assert.ok(save.state.battleInput?.player.artifacts.some(item => item.id === 'RC01' && item.stacks === 5));
    const frames = await page.evaluate(async key => {
      const [{ loadContent }, { calculateStats, simulateBattle }, { registerCombatWorker }, { parseRunSave }] = await Promise.all([
        import('/shanhai/content.js'), import('/shanhai/combat.js'),
        import('/shanhai/run.js'), import('/shanhai/persistence.js'),
      ]);
      const content = await loadContent('/content/');
      registerCombatWorker({ calculateStats, simulateBattle });
      return parseRunSave(content, localStorage.getItem(key)).battle?.frames || [];
    }, saveKey);
    const mirrorIndex = frames.findIndex(frame => frame.source === 'RL08-MIRROR-AWAKENING-1');
    const nativeIndex = frames.findIndex(frame => frame.source === 'RC01-AWAKENING-1');
    assert.ok(mirrorIndex >= 0, 'The real run battle must contain the RL08 mirror awakening frame');
    assert.ok(nativeIndex >= 0, 'The real run battle must contain the neighbor’s native awakening frame');
    assert.ok(mirrorIndex < nativeIndex, 'Mirror output should resolve before the neighbor native awakening');
    assert.match(frames[mirrorIndex].text, /法宝镜映（昆仑镜）：青锋余芒/);
    await page.locator('[data-action="battle-skip"]').click();
    await page.locator('.battle-settlement').waitFor({ state: 'visible' });
    await page.locator('.battle-detail-actions [data-action="battle-details"][data-tab="log"]').click();
    const log = page.locator('.battle-detail-dialog[role="dialog"] .battle-log');
    await log.waitFor({ state: 'visible' });
    assert.match(await log.innerText(), /法宝镜映（昆仑镜）：青锋余芒/);
    assert.match(await log.innerText(), /昆仑镜效果/);
    await page.screenshot({ path: '/tmp/shanhai-v2-mirror-real-battle-log.png', fullPage: true });
    console.log(`Mirror flow passed: actual ${frames.length}-frame battle, mirrored frame ${mirrorIndex}, native frame ${nativeIndex}`);
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await assertVowFlow(browser);
    await assertMirrorFlow(browser);
    assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('\n')}`);
    assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join('\n')}`);
    console.log('V2 vow and mirror browser acceptance passed at 360, 390, 430, and 1440px.');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
