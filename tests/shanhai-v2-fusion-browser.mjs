import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4194/';
const viewports = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
];
const fusionRecipeIds = ['RL06', 'RL07', 'RL10', 'RL11', 'RL12', 'RL13'];
const fusionFixtureSeed = 'v2-fusion-real-win-0';
const fusionFixtureName = '融合验收夹具（预置材料 · 非玩家旅程）';

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
      // Keep looking for a preinstalled browser harness.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

async function installFusionFixture(page) {
  return page.evaluate(async () => {
    const [{ loadContent }, run, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, validateRunState } = run;
    const { saveRun } = persistence;
    const expectedRecipeIds = ['RL06', 'RL07', 'RL10', 'RL11', 'RL12', 'RL13'];
    const recipes = content.entities
      .filter(artifact => Array.isArray(artifact.fusion_recipe?.inputs))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (JSON.stringify(recipes.map(artifact => artifact.id)) !== JSON.stringify(expectedRecipeIds)) {
      throw new Error(`Expected six authored fusion recipes; received ${recipes.map(artifact => artifact.id).join(', ')}`);
    }
    const recipeById = new Map(recipes.map(artifact => [artifact.id, artifact]));
    const game = ShanhaiGame.create(content, {
      seed: 'v2-fusion-real-win-0',
      name: '融合验收夹具（预置材料 · 非玩家旅程）',
      method: 'RKF01',
    });
    const recipe = id => {
      const artifact = recipeById.get(id);
      if (!artifact || !Array.isArray(artifact.fusion_recipe?.inputs)) {
        throw new Error(`Missing authored fusion recipe ${id}`);
      }
      return { artifact, inputs: artifact.fusion_recipe.inputs };
    };
    const rl06 = recipe('RL06');
    const rl07 = recipe('RL07');
    const allRecipes = recipes.map(artifact => recipe(artifact.id));
    const recordFor = id => game.state.fusionProgress.find(record => record.id === id);
    if (game.state.fusionProgress.length !== expectedRecipeIds.length ||
      expectedRecipeIds.some(id => !recordFor(id) || recordFor(id).wins.length !== 0)) {
      throw new Error('The fresh fixture does not initialize all six empty content-authored fusion records');
    }
    if (game.state.fusionHistory.length || game.state.catalyses.length) {
      throw new Error('The fresh fixture unexpectedly contains fusion history or catalysis evidence');
    }

    const resolveTalents = () => {
      while (game.state.phase === 'talent') {
        const talent = game.availableTalents()[0];
        if (!talent) throw new Error('The fixture reached a talent draft with no available choice');
        game.dispatch({ type: 'talent', id: talent.id });
      }
    };
    const resolveNextEvent = () => {
      const node = game.availableNodes().find(candidate => ['E', 'K'].includes(candidate.type));
      if (!node) throw new Error('The fixture route has no event between the qualifying battles');
      game.dispatch({ type: 'enter', id: node.key });
      if (game.state.phase !== 'event') throw new Error(`Expected an event at step ${game.state.step}`);
      const event = content.byId[node.id];
      const option = event?.options?.find(candidate => !candidate.encounter &&
        game.optionAvailability(candidate.id).available);
      if (!option) throw new Error(`The fixture event ${node.id} has no available non-battle option`);
      game.dispatch({ type: 'event', id: option.id });
      if (game.state.phase !== 'event_result') throw new Error(`Event ${node.id} did not settle`);
      game.dispatch({ type: 'continue' });
      resolveTalents();
    };
    const winNextBattle = () => {
      const node = game.availableNodes().find(candidate => ['C', 'L', 'B'].includes(candidate.type));
      if (!node) throw new Error(`The fixture route has no battle at step ${game.state.step}`);
      game.dispatch({ type: 'enter', id: node.key });
      if (game.state.phase !== 'preview') throw new Error(`Expected a battle preview at step ${game.state.step}`);
      game.dispatch({ type: 'fight' });
      const battle = game.state.battle;
      if (battle?.outcome !== 'player') {
        throw new Error(`Real fixture battle at step ${game.state.step} was not a player victory: ${battle?.outcome}`);
      }
      const eligibleRecipes = game.state._fusionBattleEntry?.eligibleRecipes ?? [];
      const result = {
        act: game.state.act,
        step: game.state.step,
        outcome: battle.outcome,
        enemyId: game.state.battleInput.enemy.id,
        enemy: game.state.battleInput.enemy.name,
        eligibleRecipes,
      };
      game.dispatch({ type: 'battle_done' });
      if (game.state.phase !== 'reward') throw new Error(`Victory at step ${result.step} did not enter reward settlement`);
      game.dispatch({ type: 'reward', id: null });
      resolveTalents();
      return result;
    };

    // A clearly named browser fixture preloads authored materials so all six recipes can be inspected.
    // It never assigns wins, catalyses, fusion history, or battle outcomes: both victories below use
    // the registered combat engine and the ordinary enter/fight/battle_done/reward commands.
    const fixtureMaterials = [...new Set(allRecipes.flatMap(({ inputs }, index) =>
      index < 2 ? inputs : inputs.slice(0, 1)))];
    game.state.artifacts = fixtureMaterials.map(id => ({ id, stacks: 1 }));
    game.dispatch({ type: 'equip', id: rl06.inputs[0] });
    const firstBattle = winNextBattle();
    if (JSON.stringify(firstBattle.eligibleRecipes) !== JSON.stringify(['RL06', 'RL07']) ||
      recordFor('RL06').wins.length !== 1 || recordFor('RL07').wins.length !== 1 ||
      expectedRecipeIds.slice(2).some(id => recordFor(id).wins.length !== 0)) {
      throw new Error(`The first actual victory did not qualify exactly RL06 and RL07: ${JSON.stringify({
        eligible: firstBattle.eligibleRecipes,
        progress: game.state.fusionProgress.map(record => ({ id: record.id, wins: record.wins.length })),
      })}`);
    }
    resolveNextEvent();

    // Leave RC14 out of the second battle so that its actual victory completes RL07 only.
    game.dispatch({ type: 'unequip', id: rl06.inputs[0] });
    game.state.artifacts = game.state.artifacts.filter(stack => stack.id !== rl06.inputs[0]);
    const secondLoadout = [...rl07.inputs, rl06.inputs[1], recipe('RL10').inputs[0]];
    for (const id of secondLoadout) game.dispatch({ type: 'equip', id });
    const secondBattle = winNextBattle();
    if (JSON.stringify(secondBattle.eligibleRecipes) !== JSON.stringify(['RL07']) ||
      recordFor('RL06').wins.length !== 1 || recordFor('RL07').wins.length !== 2 ||
      expectedRecipeIds.slice(2).some(id => recordFor(id).wins.length !== 0)) {
      throw new Error('The second actual victory did not complete only RL07');
    }
    if (game.state.fusionHistory.length !== 1 || game.state.fusionHistory[0].id !== 'RL07') {
      throw new Error('The normal battle settlement did not create RL07 fusion history');
    }
    const rl07Evidence = recordFor('RL07').wins;
    if (rl07Evidence.length !== 2 || rl07Evidence.some(win =>
      win.kind !== 'node' || !win.enemyId || !win.entryInventory.length || !win.settlementInventory.length)) {
      throw new Error('RL07 progress is missing evidence from its two actual node victories');
    }

    // Restore a held RL06 material for the detail view and equip both real inventory items.
    if (!game.state.artifacts.some(stack => stack.id === rl06.inputs[0])) {
      game.state.artifacts.push({ id: rl06.inputs[0], stacks: 1 });
    }
    for (const id of [...game.state.equipment.slots]) game.dispatch({ type: 'unequip', id });
    game.dispatch({ type: 'equip', id: rl06.inputs[0] });
    game.dispatch({ type: 'equip', id: 'RL07' });
    const completion = game.state.fusionHistory.find(record => record.id === 'RL07');
    const completedText = completion?.text;
    if (!completion || completion.title !== rl07.artifact.name || !completedText) {
      throw new Error('The game did not record the authored RL07 fusion completion');
    }
    validateRunState(content, game.state);
    saveRun(game);
    const saved = persistence.loadRun(content);
    if (!saved || saved.state.name !== game.state.name ||
      saved.state.fusionHistory.length !== 1 || saved.state.fusionHistory[0].id !== 'RL07') {
      throw new Error('The validated fixture save did not preserve its real RL07 completion');
    }
    return {
      seed: game.state.seed,
      fixtureName: game.state.name,
      rl06Name: rl06.artifact.name,
      rl07Name: rl07.artifact.name,
      recipes: allRecipes.map(({ artifact, inputs }) => ({
        id: artifact.id,
        name: artifact.name,
        inputs: inputs.map(id => ({ id, name: content.byId[id].name })),
      })),
      rl06Inputs: rl06.inputs.map(id => ({ id, name: content.byId[id].name })),
      rl07Inputs: rl07.inputs.map(id => ({ id, name: content.byId[id].name })),
      rl06Summary: rl06.artifact.summary,
      rl07Effect: rl07.artifact.description,
      completionText: completedText,
      winningBattles: [firstBattle, secondBattle],
      savedProgress: saved.state.fusionProgress.map(record => ({ id: record.id, wins: record.wins.length })),
    };
  });
}

async function readFusionCatalog(page) {
  return page.evaluate(async () => {
    const { loadContent } = await import('/shanhai/content.js');
    const content = await loadContent('/content/');
    const recipes = content.entities
      .filter(artifact => Array.isArray(artifact.fusion_recipe?.inputs))
      .sort((left, right) => left.id.localeCompare(right.id));
    return recipes.map(artifact => ({
      id: artifact.id,
      name: artifact.name,
      inputs: artifact.fusion_recipe.inputs.map(inputId => ({
        id: inputId,
        name: content.byId[inputId]?.name,
      })),
    }));
  });
}

async function assertNoViewportOverflow(page, viewport, context) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(dimensions.document <= viewport.width + 1 && dimensions.body <= viewport.width + 1,
    `${viewport.width}px ${context} causes page overflow: ${JSON.stringify(dimensions)}`);
}

async function openApp(page, viewport) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.landing-page').waitFor({ state: 'visible' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.landing-page').waitFor({ state: 'visible' });

  await page.locator('[name="player-name"]').fill(`融合空白验收${viewport.width}`);
  await page.locator('[name="seed"]').evaluate((input, seed) => { input.value = seed; }, `v2-fusion-empty-${viewport.width}`);
  await page.locator('.method-choice').first().click();
  await page.locator('[data-action="start"]').click();
  await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });

  const initialState = await page.evaluate(async () => {
    const [{ loadContent }, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = persistence.loadRun(content);
    if (!game) throw new Error('The UI-created fresh run was not saved');
    return {
      artifacts: game.state.artifacts.map(stack => stack.id),
      progress: game.state.fusionProgress.map(record => ({ id: record.id, wins: record.wins.length })),
      history: game.state.fusionHistory.map(record => record.id),
      catalyses: game.state.catalyses.length,
    };
  });
  assert.deepEqual(initialState.artifacts, [], 'a fresh UI-created run unexpectedly owns fusion ingredients');
  for (const id of fusionRecipeIds) {
    const record = initialState.progress.find(item => item.id === id);
    assert.ok(record, `fresh run is missing initialized fusion progress for ${id}`);
    assert.equal(record.wins, 0, `fresh run already has qualifying wins for ${id}`);
  }
  assert.deepEqual(initialState.history, [], 'a fresh UI-created run unexpectedly has fusion history');
  assert.equal(initialState.catalyses, 0, 'a fresh UI-created run unexpectedly has catalysis history');

  const recipes = await readFusionCatalog(page);
  assert.deepEqual(recipes.map(recipe => recipe.id), fusionRecipeIds,
    'the served game content must define exactly the six authored fusion recipes');
  const buildTab = page.locator('.game-page [data-action="tab"][data-id="build"]:visible').first();
  await buildTab.click();
  await page.locator('.game-layout.view-build').waitFor({ state: 'visible' });
  await page.locator('.game-layout.view-build [data-action="build-filter"][data-filter="all"]').click();
  const build = page.locator('.game-layout.view-build');
  const buildText = await build.innerText();
  for (const recipe of recipes) {
    assert.equal(await build.locator(`.deck-grid [data-action="inspect-artifact"][data-id="${recipe.id}"]`).count(), 0,
      `${recipe.id} appeared in the fresh-run compendium before its ingredients were owned`);
    assert.ok(!buildText.includes(recipe.name), `${recipe.name} appeared in the fresh-run compendium before its ingredients were owned`);
  }
  assert.equal(await build.locator('.fusion-ledger, .fusion-recipe').count(), 0,
    'fresh run disclosed a fusion recipe or ledger before owning ingredients');
  await assertNoViewportOverflow(page, viewport, 'fresh build view');

  const inputIds = [...new Set(recipes.flatMap(recipe => recipe.inputs.map(input => input.id)))];
  for (const id of inputIds) {
    const card = build.locator(`.deck-grid [data-action="inspect-artifact"][data-id="${id}"]`);
    await card.waitFor({ state: 'visible' });
    await card.click();
    const dialog = page.locator('.item-dialog[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await dialog.locator('.fusion-usage, .fusion-recipe').count(), 0,
      `unowned ingredient ${id} leaked fusion usage in a fresh run`);
    const detailText = await dialog.innerText();
    for (const recipe of recipes) {
      assert.ok(!detailText.includes(recipe.id) && !detailText.includes(recipe.name),
        `${recipe.id} leaked into unowned ingredient ${id} inspection before any ingredient was owned`);
    }
    await dialog.locator('.dialog-actions [data-action="modal-close"]').click();
  }

  const fixture = await installFusionFixture(page);
  assert.equal(fixture.seed, fusionFixtureSeed);
  assert.match(fixture.fixtureName, /验收夹具/);
  assert.match(fixture.fixtureName, /非玩家旅程/);
  assert.deepEqual(fixture.recipes.map(recipe => recipe.id), fusionRecipeIds);
  assert.deepEqual(fixture.savedProgress, [
    { id: 'RL06', wins: 1 },
    { id: 'RL07', wins: 2 },
    { id: 'RL10', wins: 0 },
    { id: 'RL11', wins: 0 },
    { id: 'RL12', wins: 0 },
    { id: 'RL13', wins: 0 },
  ]);
  assert.deepEqual(fixture.winningBattles.map(battle => battle.outcome), ['player', 'player']);
  assert.deepEqual(fixture.winningBattles.map(battle => battle.eligibleRecipes), [
    ['RL06', 'RL07'],
    ['RL07'],
  ]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
  await buildTab.click();
  await page.locator('.game-layout.view-build').waitFor({ state: 'visible' });
  await page.locator('.game-layout.view-build [data-action="build-filter"][data-filter="all"]').click();
  await assertNoViewportOverflow(page, viewport, 'qualified build view');
  return fixture;
}

async function inspect(page, id) {
  await page.locator(`.game-layout.view-build .deck-grid [data-action="inspect-artifact"][data-id="${id}"]`).click();
  const dialog = page.locator('.item-dialog[role="dialog"]');
  await dialog.waitFor({ state: 'visible' });
  await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  return page.locator('.item-dialog');
}

async function assertFiveSlotBoard(page) {
  const slots = await page.locator('.equipment-section .equipment-slot').evaluateAll(elements =>
    elements.map(element => element.getAttribute('data-slot')));
  assert.deepEqual(slots, ['1', '2', '3', '4', '5'], 'the build board must retain all five numbered positions');
  const positionGuide = await page.locator('.equipment-position-guide').innerText();
  assert.match(positionGuide, /阵首（第1格）/);
  assert.match(positionGuide, /阵尾（第5格）/);
}

async function assertFusionDetail(page, viewport, fixture) {
  assert.match(await page.locator('.header-run-summary .run-identity').innerText(), /验收夹具/,
    'the saved fusion fixture must remain visibly marked as a test fixture');
  await assertFiveSlotBoard(page);
  const build = page.locator('.game-layout.view-build');
  for (const recipe of fixture.recipes) {
    assert.equal(await build.locator(`.deck-grid [data-action="inspect-artifact"][data-id="${recipe.id}"]`).count(), 1,
      `${recipe.id} is missing from the six-recipe compendium`);
    assert.ok((await build.innerText()).includes(recipe.name), `${recipe.name} is missing from the compendium`);
  }

  const dialog = await inspect(page, 'RL06');
  const summary = await dialog.locator('.item-dialog-summary').innerText();
  assert.match(summary, /融合器物/);
  assert.notEqual(summary, fixture.rl06Summary,
    'the unowned fusion artifact displayed its authored effect summary');
  assert.doesNotMatch(summary, /毒火交织并引爆|中毒和燃烧/,
    'an unowned fusion artifact revealed its effect summary');
  assert.equal(await dialog.locator('.effect-list, .core-rule-detail, .attribute-list').count(), 0,
    'the unowned fusion artifact displayed an effect, rule, or attribute panel');

  const recipe = dialog.locator('.fusion-recipe[data-fusion-output="RL06"]');
  await recipe.waitFor({ state: 'visible' });
  const recipeText = await recipe.innerText();
  assert.match(recipeText, /1 \+ 0 \/ 2/);
  assert.match(recipeText, /尚未形成 · 未取得/);
  for (const input of fixture.rl06Inputs) assert.ok(recipeText.includes(input.name), `${input.name} is missing from the recipe`);
  assert.match(recipeText, /已装备 · 装备位 1/);
  assert.match(recipeText, /背包中/);
  assert.match(await dialog.locator('.fusion-consumption-note').innerText(), /装备中的材料也会消耗/);
  assert.match(await dialog.locator('.fusion-consumption-note').innerText(), /有空装备位时成品自动装备/);
  assert.match(await dialog.locator('.fusion-consumption-note').innerText(), /否则收入背包/);

  const metrics = await page.evaluate(() => {
    const rect = element => {
      const value = element?.getBoundingClientRect();
      return value ? {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      } : null;
    };
    const dialog = document.querySelector('.item-dialog');
    const close = dialog?.querySelector('.modal-close');
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      dialog: rect(dialog),
      close: rect(close),
      widths: [...dialog?.querySelectorAll('.fusion-recipe, .fusion-inputs, .fusion-input, .fusion-consumption-note') || []]
        .map(element => ({ selector: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
    };
  });
  assert.ok(metrics.documentWidth <= viewport.width + 1 && metrics.bodyWidth <= viewport.width + 1,
    `${viewport.width}px fusion detail causes page overflow: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.dialog && metrics.dialog.left >= 0 && metrics.dialog.right <= viewport.width + 1,
    `${viewport.width}px fusion dialog escapes viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.close && metrics.close.width >= 44 && metrics.close.height >= 44 &&
    metrics.close.left >= 0 && metrics.close.right <= viewport.width + 1,
  `${viewport.width}px close control is obscured or too small: ${JSON.stringify(metrics.close)}`);
  for (const width of metrics.widths) {
    assert.ok(width.scrollWidth <= width.clientWidth + 1,
      `${viewport.width}px fusion content overflows ${width.selector}: ${JSON.stringify(width)}`);
  }
  await page.screenshot({ path: `/tmp/shanhai-v2-fusion-${viewport.width}.png`, fullPage: true });

  await dialog.locator('.dialog-actions [data-action="modal-close"]').scrollIntoViewIfNeeded();
  const returnControl = dialog.locator('.dialog-actions [data-action="modal-close"]');
  const returnRect = await returnControl.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  });
  assert.ok(returnRect.width >= 44 && returnRect.height >= 44 && returnRect.left >= 0 &&
    returnRect.right <= viewport.width + 1,
  `${viewport.width}px return control is obscured or too small: ${JSON.stringify(returnRect)}`);
  await returnControl.click();

  await inspect(page, 'RL07');
  const acquired = page.locator('.item-dialog .fusion-recipe[data-fusion-output="RL07"]');
  assert.match(await acquired.innerText(), /2 \+ 0 \/ 2/);
  assert.match(await acquired.innerText(), /已形成 · 已收入/);
  assert.doesNotMatch(await page.locator('.item-dialog').innerText(), /没有额外触发效果/);
  assert.ok(fixture.rl07Effect.includes('不可暴击派生伤害'),
    'the acquired artifact fixture no longer exercises its authored effect');
  assert.match(await page.locator('.item-dialog-summary').innerText(), /不可暴击派生伤害/,
    'the received artifact did not reveal its authored effect');
  await page.locator('.item-dialog .dialog-actions [data-action="modal-close"]').click();

  const ledger = page.locator('.game-layout.view-build .fusion-ledger');
  const ledgerSummary = ledger.locator(':scope > summary');
  await ledgerSummary.scrollIntoViewIfNeeded();
  const summaryRect = await ledgerSummary.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
      unobscured: element === topmost || element.contains(topmost),
    };
  });
  assert.ok(summaryRect.width >= 44 && summaryRect.height >= 44 && summaryRect.left >= 0 &&
    summaryRect.right <= viewport.width + 1 && summaryRect.unobscured,
  `${viewport.width}px fusion progress disclosure is obscured or too small: ${JSON.stringify(summaryRect)}`);
  await ledgerSummary.click();
  await assertNoViewportOverflow(page, viewport, 'fusion ledger');
  const ledgerText = await ledger.innerText();
  const ledgerRecipes = ledger.locator('.fusion-recipe[data-fusion-output]');
  assert.equal(await ledgerRecipes.count(), 6, 'the progress ledger must include all six known recipes');
  for (const recipe of fixture.recipes) {
    const row = ledger.locator(`.fusion-recipe[data-fusion-output="${recipe.id}"]`);
    assert.equal(await row.count(), 1, `${recipe.id} is missing from the fusion progress ledger`);
    for (const input of recipe.inputs) assert.ok(ledgerText.includes(input.name), `${input.name} is missing from the ledger`);
    if (recipe.id === 'RL06') {
      assert.equal(await row.getAttribute('data-fusion-wins'), '1');
      assert.equal(await row.getAttribute('data-fusion-catalyses'), '0');
    } else if (recipe.id === 'RL07') {
      assert.equal(await row.getAttribute('data-fusion-wins'), '2');
      assert.equal(await row.getAttribute('data-fusion-catalyses'), '0');
    } else {
      assert.equal(await row.getAttribute('data-fusion-wins'), '0', `${recipe.id} received an unearned win`);
    }
  }
  assert.match(ledgerText, /1 \+ 0 \/ 2/);
  assert.match(ledgerText, /2 \+ 0 \/ 2/);
  assert.match(ledgerText, /装备中的材料也会消耗/);

  await inspect(page, fixture.rl06Inputs[0].id);
  const use = page.locator('.item-dialog .fusion-usage');
  assert.ok((await use.innerText()).includes(fixture.rl06Name));
  assert.match(await use.innerText(), /1 \+ 0 \/ 2/);
  await page.locator('.item-dialog .dialog-actions [data-action="modal-close"]').click();
}

async function assertFusionHistory(page, viewport, fixture) {
  await page.locator('.game-page [data-action="tab"][data-id="karma"]:visible').first().click();
  await assertNoViewportOverflow(page, viewport, 'journey history');
  const history = page.locator('.view-karma [data-details="journey-history"]');
  await history.locator(':scope > summary').click();
  const fusionEntry = history.locator('.timeline-item[data-history-kind="fusion"]');
  await fusionEntry.waitFor({ state: 'visible' });
  const text = await fusionEntry.innerText();
  assert.ok(text.includes(fixture.rl07Name));
  assert.ok(text.includes(fixture.completionText));
  assert.match(text, /融合完成/);
  const savedName = await page.evaluate(async () => {
    const [{ loadContent }, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    return persistence.loadRun(content)?.state.name;
  });
  assert.equal(savedName, fixture.fixtureName,
    'the fusion entry must belong to a clearly labeled browser fixture, not a player journey');
}

async function installEventFixture(page, eventId) {
  return page.evaluate(async ({ eventId, seed, fixtureName }) => {
    const [{ loadContent }, run, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, validateRunState } = run;
    const { saveRun } = persistence;
    const game = ShanhaiGame.create(content, { seed, name: fixtureName, method: 'RKF01' });
    let targetId;
    let maxStacks;
    let battle;

    const resolveTalents = () => {
      while (game.state.phase === 'talent') {
        const talent = game.availableTalents()[0];
        if (!talent) throw new Error('Event fixture reached an empty talent draft');
        game.dispatch({ type: 'talent', id: talent.id });
      }
    };
    const routePath = (routeMap, target) => {
      const path = [target];
      while (path[0].depth > 0) {
        const parent = routeMap.nodes.find(node => node.next.includes(path[0].key));
        if (!parent) throw new Error(`No route parent for event node ${path[0].key}`);
        path.unshift(parent);
      }
      return path;
    };
    const enterFixtureEvent = (act) => {
      const routeMap = game.state.routeMap;
      const eventNode = routeMap.nodes.find(node => node.type === 'E' && node.depth > 0);
      if (!eventNode) throw new Error(`Act ${act} fixture route has no event node`);
      eventNode.id = eventId;
      const path = routePath(routeMap, eventNode);
      routeMap.path = path.map(node => node.key);
      path.forEach((node, index) => { node.completed = index < path.length - 1; });
      game.state.nodes = path.map((node, index) => ({
        type: node.type,
        id: node.id,
        completed: index < path.length - 1,
      }));
      game.state.step = path.length - 1;
      game.state.phase = 'map';
      game.state.nodeEntry = undefined;
      game.state._nodeEntry = undefined;
      game.state._previewKind = undefined;
      game.state._battleKind = undefined;
      game.state._battleSettled = false;
      game.state._rewardSettled = false;
      game.state._eventSettled = false;
      game.state._eventOutcome = undefined;
      game.state._pendingEvent = undefined;
      game.state.eventOption = undefined;
      game.dispatch({ type: 'enter', id: eventNode.key });
      if (game.state.phase !== 'event' || game.state.nodes[game.state.step].id !== eventId) {
        throw new Error(`Expected browser fixture to enter ${eventId}`);
      }
    };

    if (eventId === 'RE012') {
      game.state.artifacts = ['RC14', 'RC15'].map(id => ({ id, stacks: 1 }));
      game.state.coins = 500;
      game.dispatch({ type: 'equip', id: 'RC14' });
      const node = game.availableNodes().find(candidate => ['C', 'L', 'B'].includes(candidate.type));
      if (!node) throw new Error('RE012 fixture has no opening battle');
      game.dispatch({ type: 'enter', id: node.key });
      game.dispatch({ type: 'fight' });
      if (game.state.battle?.outcome !== 'player') {
        throw new Error(`RE012 prerequisite real battle was not won: ${game.state.battle?.outcome}`);
      }
      battle = {
        outcome: game.state.battle.outcome,
        enemyId: game.state.battleInput.enemy.id,
        enemy: game.state.battleInput.enemy.name,
      };
      game.dispatch({ type: 'battle_done' });
      if (game.state.phase !== 'reward') throw new Error('RE012 real victory did not reach rewards');
      game.dispatch({ type: 'reward', id: null });
      resolveTalents();
      if (game.state.fusionProgress.find(record => record.id === 'RL06')?.wins.length !== 1) {
        throw new Error('RE012 fixture must earn RL06 progress from its actual victory');
      }
      game.startAct(2);
      enterFixtureEvent(2);
      targetId = 'RL06';
    } else if (eventId === 'RE022') {
      game.startAct(3);
      const growthArtifact = content.byId.RC03;
      if (!growthArtifact || growthArtifact.rarity !== 'common' || growthArtifact.max_stacks <= 1) {
        throw new Error('RE022 fixture requires an authored stackable common artifact');
      }
      targetId = growthArtifact.id;
      maxStacks = growthArtifact.max_stacks;
      game.state.artifacts = [{ id: targetId, stacks: 1 }];
      game.state.coins = 500;
      game.dispatch({ type: 'equip', id: targetId });
      enterFixtureEvent(3);
    } else {
      throw new Error(`Unsupported event fixture ${eventId}`);
    }

    validateRunState(content, game.state);
    saveRun(game);
    const saved = persistence.loadRun(content);
    if (!saved || saved.state.name !== fixtureName || saved.state.phase !== 'event') {
      throw new Error(`${eventId} fixture event was not accepted by save validation`);
    }
    return {
      eventId,
      targetId,
      maxStacks,
      seed,
      fixtureName,
      battle,
      initialWins: saved.state.fusionProgress.map(record => ({ id: record.id, wins: record.wins.length })),
    };
  }, {
    eventId,
    seed: eventId === 'RE012' ? 'v2-fusion-re012-real-win' : 'v2-fusion-re022-growth',
    fixtureName: `融合事件浏览器验收夹具 ${eventId}（非玩家旅程）`,
  });
}

async function readSavedRun(page) {
  return page.evaluate(async () => {
    const [{ loadContent }, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = persistence.loadRun(content);
    if (!game) throw new Error('Expected a validated browser fixture save');
    return {
      name: game.state.name,
      phase: game.state.phase,
      act: game.state.act,
      resultText: game.state.resultText,
      coins: game.state.coins,
      artifacts: game.state.artifacts.map(stack => ({ id: stack.id, stacks: stack.stacks })),
      equipment: [...game.state.equipment.slots],
      fusionProgress: game.state.fusionProgress.map(record => ({ id: record.id, wins: record.wins.length })),
      fusionHistory: game.state.fusionHistory.map(record => ({ id: record.id, title: record.title, text: record.text })),
      catalyses: game.state.catalyses.map(record => ({ ...record })),
    };
  });
}

async function assertEventCatalysisFlow(page, viewport, eventId) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.landing-page').waitFor({ state: 'visible' });
  await page.evaluate(() => localStorage.clear());
  const fixture = await installEventFixture(page, eventId);
  assert.match(fixture.fixtureName, /非玩家旅程/);
  if (eventId === 'RE012') {
    assert.deepEqual(fixture.battle && [fixture.battle.outcome], ['player'],
      'RE012 catalysis must follow a real, recorded fusion win');
    assert.equal(fixture.initialWins.find(record => record.id === 'RL06')?.wins, 1);
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-event').waitFor({ state: 'visible' });
  assert.match(await page.locator('.header-run-summary .run-identity').innerText(), /非玩家旅程/);
  assert.match(await page.locator('.event-page h2').innerText(), eventId === 'RE012' ? /锈锁双匣/ : /断炉商筹/);
  await assertNoViewportOverflow(page, viewport, `${eventId} event prompt`);

  const optionId = eventId === 'RE012' ? 'RE012-C' : 'RE022-C';
  const target = page.locator(`.event-page [data-action="event"][data-id="${optionId}"][data-target="${fixture.targetId}"]`);
  await target.waitFor({ state: 'visible' });
  assert.equal(await target.isEnabled(), true, `${eventId} should expose an available catalysis target`);
  const before = await readSavedRun(page);
  assert.equal(before.phase, 'event');
  if (eventId === 'RE012') {
    assert.equal(before.fusionHistory.length, 0, 'an eligible win alone must not forge a fusion product');
    assert.ok(before.coins >= 1, 'the fixture carries enough marked test currency for catalysis');
  } else {
    assert.equal(before.artifacts.find(stack => stack.id === fixture.targetId)?.stacks, 1);
    assert.ok(before.equipment.includes(fixture.targetId), 'RE022 target must be genuinely equipped');
  }

  await target.click();
  await page.locator('.game-page.phase-event_result').waitFor({ state: 'visible' });
  const prompt = await page.locator('.event-page .event-result').innerText();
  assert.match(prompt, /催化记录|点化记录/);
  if (eventId === 'RE012') assert.ok(prompt.includes('RL06') || prompt.includes('合炼'));
  else assert.ok(prompt.includes('RC03') || prompt.includes('点化'));
  await assertNoViewportOverflow(page, viewport, `${eventId} result prompt`);

  const afterCommand = await readSavedRun(page);
  assert.equal(afterCommand.phase, 'event_result');
  assert.equal(afterCommand.name, fixture.fixtureName);
  if (eventId === 'RE012') {
    assert.equal(afterCommand.catalyses.length, 1);
    assert.equal(afterCommand.catalyses[0].kind, 'fusion_step');
    assert.equal(afterCommand.catalyses[0].source, 'event');
    assert.equal(afterCommand.catalyses[0].targetId, 'RL06');
    assert.equal(afterCommand.catalyses[0].eventId, 'RE012');
    assert.equal(afterCommand.catalyses[0].optionId, 'RE012-C');
    assert.equal(afterCommand.fusionProgress.find(record => record.id === 'RL06')?.wins, 1,
      'event catalysis must remain separate from its one real victory');
    assert.deepEqual(afterCommand.fusionHistory.map(record => record.id), ['RL06']);
    assert.ok(afterCommand.artifacts.some(stack => stack.id === 'RL06'));
    assert.equal(afterCommand.artifacts.some(stack => ['RC14', 'RC15'].includes(stack.id)), false,
      'the completed event fusion must consume both held materials');
  } else {
    const record = afterCommand.catalyses[0];
    assert.equal(afterCommand.catalyses.length, 1);
    assert.equal(record.kind, 'artifact_growth');
    assert.equal(record.source, 'event');
    assert.equal(record.targetId, fixture.targetId);
    assert.equal(record.eventId, 'RE022');
    assert.equal(record.optionId, 'RE022-C');
    assert.equal(record.beforeStacks, 1);
    assert.equal(record.afterStacks, fixture.maxStacks);
    assert.equal(afterCommand.artifacts.find(stack => stack.id === fixture.targetId)?.stacks, fixture.maxStacks);
    assert.deepEqual(afterCommand.fusionHistory, [], 'equipment pointification must not create fusion history');
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-event_result').waitFor({ state: 'visible' });
  assert.match(await page.locator('.event-page .event-result').innerText(), /催化记录|点化记录/,
    `${eventId} result prompt was lost after refresh`);
  const restored = await readSavedRun(page);
  assert.deepEqual(restored.catalyses, afterCommand.catalyses,
    `${eventId} catalysis evidence was lost after refresh`);
  assert.deepEqual(restored.fusionHistory, afterCommand.fusionHistory,
    `${eventId} fusion history changed after refresh`);
  assert.equal(restored.resultText, afterCommand.resultText);
}

async function run() {
  const { chromium } = playwrightModule();
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
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
      page.on('console', message => {
        if (message.type() === 'error') pageErrors.push(`${viewport.width}px console: ${message.text()}`);
      });
      const fixture = await openApp(page, viewport);
      assert.equal(fixture.winningBattles.length, 2, 'the fixture must use two real player victories');
      await assertFusionDetail(page, viewport, fixture);
      if (viewport.width === 390) await assertFusionHistory(page, viewport, fixture);
      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
      await context.close();
    }

    for (const [eventId, viewport] of [
      ['RE012', { width: 390, height: 844 }],
      ['RE022', { width: 430, height: 932 }],
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => pageErrors.push(`${eventId} ${viewport.width}px: ${error.message}`));
      page.on('console', message => {
        if (message.type() === 'error') pageErrors.push(`${eventId} ${viewport.width}px console: ${message.text()}`);
      });
      await assertEventCatalysisFlow(page, viewport, eventId);
      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
      await context.close();
    }

    console.log('ok - six-recipe fusion compendium, two real RL07 victories, saved fusion progress, RE012/RE022 browser catalysis, and responsive five-slot board at 360/390/430/1440px');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
