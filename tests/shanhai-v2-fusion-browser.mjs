import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
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
    const { ShanhaiGame } = run;
    const { saveRun } = persistence;
    const game = ShanhaiGame.create(content, {
      seed: 'v2-fusion-browser-fixture',
      name: '融合行迹验收行者',
      method: 'RKF01',
    });
    const recipe = id => {
      const artifact = content.byId[id];
      if (!artifact || !Array.isArray(artifact.fusion_recipe?.inputs)) {
        throw new Error(`Missing authored fusion recipe ${id}`);
      }
      return { artifact, inputs: artifact.fusion_recipe.inputs };
    };
    const rl06 = recipe('RL06');
    const rl07 = recipe('RL07');
    const recordFor = id => game.state.fusionProgress.find(record => record.id === id);
    if (!recordFor('RL06') || !recordFor('RL07')) {
      throw new Error('The run does not initialize both content-authored fusion records');
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
        throw new Error(`Fixture battle at step ${game.state.step} was not a player victory: ${battle?.outcome}`);
      }
      const result = {
        act: game.state.act,
        step: game.state.step,
        enemy: game.state.battleInput.enemy.name,
      };
      game.dispatch({ type: 'battle_done' });
      if (game.state.phase !== 'reward') throw new Error(`Victory at step ${result.step} did not enter reward settlement`);
      game.dispatch({ type: 'reward', id: null });
      resolveTalents();
      return result;
    };

    // Let actual battles and the normal settlement flow create progress and history.
    game.state.artifacts = [...new Set([...rl06.inputs, ...rl07.inputs])]
      .map(id => ({ id, stacks: 1 }));
    game.dispatch({ type: 'equip', id: rl06.inputs[0] });
    const firstBattle = winNextBattle();
    if (recordFor('RL06').wins.length !== 1 || recordFor('RL07').wins.length !== 1) {
      throw new Error('The first real victory did not qualify both authored fusion recipes');
    }
    resolveNextEvent();

    // Temporarily leave one RL06 input behind so the next real victory completes RL07 only.
    game.dispatch({ type: 'unequip', id: rl06.inputs[0] });
    game.state.artifacts = game.state.artifacts.filter(stack => stack.id !== rl06.inputs[0]);
    const secondBattle = winNextBattle();
    if (recordFor('RL06').wins.length !== 1 || recordFor('RL07').wins.length !== 2) {
      throw new Error('The second real victory did not complete only RL07');
    }
    if (game.state.fusionHistory.length !== 1 || game.state.fusionHistory[0].id !== 'RL07') {
      throw new Error('The normal battle settlement did not create RL07 fusion history');
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
    saveRun(game);
    return {
      rl06Name: rl06.artifact.name,
      rl07Name: rl07.artifact.name,
      rl06Inputs: rl06.inputs.map(id => ({ id, name: content.byId[id].name })),
      rl07Inputs: rl07.inputs.map(id => ({ id, name: content.byId[id].name })),
      rl06Summary: rl06.artifact.summary,
      rl07Effect: rl07.artifact.description,
      completionText: completedText,
      winningBattles: [firstBattle, secondBattle],
    };
  });
}

async function readFusionCatalog(page) {
  return page.evaluate(async () => {
    const { loadContent } = await import('/shanhai/content.js');
    const content = await loadContent('/content/');
    return ['RL06', 'RL07'].map(id => {
      const artifact = content.byId[id];
      if (!artifact || !Array.isArray(artifact.fusion_recipe?.inputs)) {
        throw new Error(`Missing authored fusion recipe ${id}`);
      }
      return {
        id,
        name: artifact.name,
        inputs: artifact.fusion_recipe.inputs.map(inputId => ({
          id: inputId,
          name: content.byId[inputId]?.name,
        })),
      };
    });
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
    };
  });
  assert.deepEqual(initialState.artifacts, [], 'a fresh UI-created run unexpectedly owns fusion ingredients');
  for (const id of ['RL06', 'RL07']) {
    const record = initialState.progress.find(item => item.id === id);
    assert.ok(record, `fresh run is missing initialized fusion progress for ${id}`);
    assert.equal(record.wins, 0, `fresh run already has qualifying wins for ${id}`);
  }
  assert.deepEqual(initialState.history, [], 'a fresh UI-created run unexpectedly has fusion history');

  const recipes = await readFusionCatalog(page);
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

async function assertFusionDetail(page, viewport, fixture) {
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
  assert.match(recipeText, /1 \/ 2/);
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
  assert.match(await acquired.innerText(), /2 \/ 2/);
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
  for (const input of fixture.rl06Inputs) assert.ok(ledgerText.includes(input.name));
  for (const input of fixture.rl07Inputs) assert.ok(ledgerText.includes(input.name));
  assert.match(ledgerText, /1 \/ 2/);
  assert.match(ledgerText, /2 \/ 2/);
  assert.match(ledgerText, /装备中的材料也会消耗/);

  await inspect(page, fixture.rl06Inputs[0].id);
  const use = page.locator('.item-dialog .fusion-usage');
  assert.ok((await use.innerText()).includes(fixture.rl06Name));
  assert.match(await use.innerText(), /1 \/ 2/);
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
    console.log('ok - fresh-run fusion secrecy, qualified recipes, progress, equipment costs, acquisition state, and journey history at 360/390/430/1440px');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
