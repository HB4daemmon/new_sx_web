import assert from 'node:assert/strict';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.BROWSER_URL || 'http://localhost:4176/';
const reportDir = path.resolve(
  process.env.BROWSER_REPORT_DIR || path.join(root, 'verification/shanhai/roguelite-browser'),
);
const saveKey = 'suishi-shanhai-run-v1';
const viewports = [
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '1440x1000', width: 1440, height: 1000 },
];
const checks = [];
const screenshots = [];
const browserErrors = [];
const textObstructions = [];

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
      // Try the next preinstalled browser harness module.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

const { chromium } = playwrightModule();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';

async function screenshot(page, name) {
  const filename = `${name}.png`;
  const target = path.join(reportDir, 'screenshots', filename);
  try {
    await page.screenshot({ path: target, fullPage: true, animations: 'disabled' });
    screenshots.push(path.relative(reportDir, target));
    return path.relative(reportDir, target);
  } catch (error) {
    screenshots.push({ path: path.relative(reportDir, target), error: String(error) });
    return null;
  }
}

async function check(name, page, fn) {
  try {
    const details = await fn();
    checks.push({ name, ok: true, ...(details || {}) });
  } catch (error) {
    const screenshotPath = page ? await screenshot(page, `failure-${slug(name)}`) : null;
    checks.push({
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      screenshot: screenshotPath,
      ...(name.includes('boss pressure') ? { fileRef: 'src/shanhai/app.ts:2121' } : {}),
    });
  }
}

function slug(value) {
  return value.replace(/[^\p{Letter}\p{Number}-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

async function cleanPage(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#shanhai-app').waitFor();
}

async function pagePhase(page) {
  const className = await page.locator('.game-page').getAttribute('class');
  return className?.match(/phase-([a-z_]+)/)?.[1] || null;
}

async function assertLayout(page, label) {
  const geometry = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
  }));
  assert.ok(geometry.documentWidth <= geometry.width + 1,
    `${label}: document horizontal overflow ${JSON.stringify(geometry)}`);
  assert.ok(geometry.bodyWidth <= geometry.width + 1,
    `${label}: body horizontal overflow ${JSON.stringify(geometry)}`);

  const overlaps = await page.evaluate(() => {
    const root = document.querySelector('#shanhai-app');
    const selector = [
      '.main-stage .boss-map-hint',
      '.main-stage .story-text',
      '.main-stage .event-option b',
      '.main-stage .event-option small',
      '.main-stage .event-costs i',
      '.main-stage .reforge-sacrifice',
      '.main-stage .reforge-option > div > *',
      '.main-stage .reforge-option > button',
      '.main-stage .rest-temper > summary b',
      '.main-stage .rest-temper > summary small',
      '.main-stage .rest-temper-panel > label',
      '.main-stage .rest-temper-panel > select',
      '.main-stage .rest-temper-panel > p',
      '.main-stage .rest-temper-panel > button',
      '.main-stage .battle-settlement > p',
      '.main-stage .battle-settlement .battle-insights h3',
      '.main-stage .battle-settlement .battle-insights li',
    ].join(',');
    if (!root) return [{ text: 'missing #shanhai-app' }];
    const elements = [...root.querySelectorAll(selector)];
    const describe = element => {
      const className = [...element.classList].slice(0, 2).join('.');
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${className ? `.${className}` : ''}`;
    };
    const rows = elements.flatMap(element => {
      const text = element.innerText?.replace(/\s+/g, ' ').trim() || '';
      const style = getComputedStyle(element);
      if (!text || style.display === 'none' || style.visibility === 'hidden' ||
        Number.parseFloat(style.opacity) < 0.05 || !element.getClientRects().length) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 ||
        rect.bottom <= 0 || rect.top >= window.innerHeight) return [];
      const visible = {
        left: Math.max(0, rect.left), top: Math.max(0, rect.top),
        right: Math.min(window.innerWidth, rect.right), bottom: Math.min(window.innerHeight, rect.bottom),
      };
      // Scroll containers clip their descendants before hit testing. Testing
      // the untrimmed DOM rect would report hidden content beneath the nav.
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(ancestorStyle.overflowX)) {
          visible.left = Math.max(visible.left, ancestorRect.left);
          visible.right = Math.min(visible.right, ancestorRect.right);
        }
        if (/(auto|scroll|hidden|clip)/.test(ancestorStyle.overflowY)) {
          visible.top = Math.max(visible.top, ancestorRect.top);
          visible.bottom = Math.min(visible.bottom, ancestorRect.bottom);
        }
      }
      if (visible.right <= visible.left || visible.bottom <= visible.top) return [];
      return [{
        text: text.slice(0, 64),
        element,
        selector: describe(element),
        rect: visible,
      }];
    });
    const found = [];
    for (let left = 0; left < rows.length; left += 1) {
      for (let right = left + 1; right < rows.length; right += 1) {
        const a = rows[left];
        const b = rows[right];
        if (a.element === b.element || a.element.contains(b.element) ||
          b.element.contains(a.element)) continue;
        const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (width > 2 && height > 2) {
          found.push({
            first: a.text,
            second: b.text,
            firstSelector: a.selector,
            secondSelector: b.selector,
            firstRect: a.rect,
            secondRect: b.rect,
            overlap: { width: Math.round(width), height: Math.round(height) },
          });
          if (found.length >= 20) return found;
        }
      }
    }
    const nav = root.querySelector('.bottom-nav');
    if (nav && getComputedStyle(nav).display !== 'none') {
      const navRect = nav.getBoundingClientRect();
      for (const row of rows) {
        const width = Math.min(row.rect.right, navRect.right) - Math.max(row.rect.left, navRect.left);
        const height = Math.min(row.rect.bottom, navRect.bottom) - Math.max(row.rect.top, navRect.top);
        if (width > 2 && height > 2) {
          found.push({
            first: row.text,
            second: '固定底部导航',
            firstSelector: row.selector,
            secondSelector: '.bottom-nav',
            firstRect: row.rect,
            secondRect: {
              left: navRect.left,
              top: navRect.top,
              right: navRect.right,
              bottom: navRect.bottom,
            },
            overlap: { width: Math.round(width), height: Math.round(height) },
          });
        }
      }
    }
    return found;
  });
  if (overlaps.length) {
    const screenshotPath = await screenshot(page, `overlap-${slug(label)}`);
    textObstructions.push({ label, viewport: geometry.width, overlaps, screenshot: screenshotPath });
  }
  return { geometry, textOverlapCount: overlaps.length };
}

async function restTemperSummaryGeometry(page) {
  return page.evaluate(() => {
    const details = document.querySelector('details[data-details="rest-temper"]');
    const summary = details?.querySelector(':scope > summary');
    return {
      detailsWidth: details?.getBoundingClientRect().width || 0,
      summaryWidth: summary?.getBoundingClientRect().width || 0,
    };
  });
}

async function seedGame(page, target, seed) {
  return page.evaluate(async ({ target, seed, saveKey }) => {
    const [{ loadContent }, { ShanhaiGame }, { saveRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');

    function distanceTo(game, predicate) {
      const byKey = new Map(game.state.routeMap.nodes.map(node => [node.key, node]));
      const memo = new Map();
      const distance = node => {
        if (predicate(node)) return 0;
        if (memo.has(node.key)) return memo.get(node.key);
        const children = node.next.map(key => byKey.get(key)).filter(Boolean);
        const result = children.length ? 1 + Math.min(...children.map(distance)) : Infinity;
        memo.set(node.key, result);
        return result;
      };
      return game.availableNodes()
        .map(node => ({ node, distance: distance(byKey.get(node.key) ?? node) }))
        .filter(item => Number.isFinite(item.distance))
        .sort((left, right) =>
          left.distance - right.distance ||
          left.node.depth - right.node.depth ||
          left.node.lane - right.node.lane ||
          left.node.key.localeCompare(right.node.key),
        )[0]?.node;
    }

    function prepare(game) {
      if (target === 'shop') {
        game.state.artifacts = [
          { id: 'RC11', stacks: 2 },
          { id: 'RC12', stacks: 1 },
          { id: 'RC20', stacks: 1 },
        ];
      } else if (target === 'rest' || target === 'artifact') {
        game.state.artifacts = [
          { id: 'RC11', stacks: 2 },
          { id: 'RC12', stacks: 1 },
          { id: 'RC20', stacks: 1 },
        ];
      } else if (target === 'battle') {
        game.state.artifacts = [{ id: 'RC20', stacks: 1 }];
      }
      game.state.coins = 500;
      game.state.hp = game.stats.max_hp;
    }

    function resolveEvent(game) {
      const event = content.byId[game.node.id];
      const option = event.options.find(candidate =>
        game.optionAvailability(candidate).available &&
        !candidate.encounter &&
        !candidate.commitment &&
        !candidate.rewards?.some(reward =>
          ['swap_method', 'method'].includes(reward.type),
        ),
      );
      if (!option) throw new Error(`No safe event choice for ${event.id}`);
      game.dispatch({ type: 'event', id: option.id });
    }

    function advance(game) {
      if (game.state.phase === 'map') {
        const desired = target === 'shop' ? node => node.type === 'S'
          : target === 'rest' ? node => node.type === 'R'
            : target === 'event' ? node => node.type === 'E' && node.depth === 1
              : target === 'battle' ? node => node.type === 'C' && node.depth === 0
                : () => false;
        const node = distanceTo(game, desired) ?? game.availableNodes()[0];
        if (!node) throw new Error(`No route node available for ${target}`);
        if (target === 'event' && node.type === 'E') {
          node.id = 'RE001';
          const actual = game.state.routeMap.nodes.find(candidate => candidate.key === node.key);
          if (!actual) throw new Error('Selected event route node disappeared');
          actual.id = 'RE001';
          actual.description = content.byId.RE001.name;
        }
        game.dispatch({ type: 'enter', id: node.key });
      } else if (game.state.phase === 'preview') {
        game.dispatch({ type: 'fight' });
      } else if (game.state.phase === 'battle') {
        let guard = 0;
        while (game.state.battle?.outcome === 'draw' && guard++ < 5) {
          game.dispatch({ type: 'continue_battle' });
        }
        if (game.state.battle?.outcome !== 'player') {
          throw new Error(`Fixture battle ended ${game.state.battle?.outcome}`);
        }
        game.dispatch({ type: 'battle_done' });
      } else if (game.state.phase === 'reward') {
        game.dispatch({ type: 'reward', id: null });
      } else if (game.state.phase === 'event') {
        resolveEvent(game);
      } else if (game.state.phase === 'event_result') {
        game.dispatch({ type: 'continue' });
      } else if (game.state.phase === 'shop') {
        game.dispatch({ type: 'leave_shop' });
      } else if (game.state.phase === 'rest') {
        game.dispatch({ type: 'rest', choice: 'heal' });
      } else if (game.state.phase === 'talent') {
        const talent = game.availableTalents()[0];
        if (!talent) throw new Error('Talent fixture has no available choice');
        game.dispatch({ type: 'talent', id: talent.id });
      } else if (game.state.phase === 'transition') {
        game.dispatch({ type: 'continue' });
      } else {
        throw new Error(`Cannot advance ${target} fixture from ${game.state.phase}`);
      }
    }

    const expectedPhase = ({
      map: 'map',
      event: 'event',
      shop: 'shop',
      rest: 'rest',
      artifact: 'map',
      battle: 'battle',
    })[target];

    if (target === 'battle') {
      const game = ShanhaiGame.create(content, { seed, name: '结算验收', method: 'RKF01' });
      prepare(game);
      const node = game.availableNodes().find(candidate => candidate.type === 'C');
      if (!node) throw new Error('Battle fixture has no opening common node');
      game.dispatch({ type: 'enter', id: node.key });
      game.dispatch({ type: 'fight' });
      let drawGuard = 0;
      while (game.state.battle?.outcome === 'draw' && drawGuard++ < 5) {
        game.dispatch({ type: 'continue_battle' });
      }
      if (game.state.battle?.outcome === 'draw') {
        throw new Error('Battle fixture remained a draw after five extensions');
      }
      saveRun(game);
      return {
        phase: game.state.phase,
        seed,
        outcome: game.state.battle?.outcome,
        frames: game.state.battle?.frames.length,
      };
    }

    if (target === 'map' || target === 'artifact') {
      const game = ShanhaiGame.create(content, { seed, name: '地图验收', method: 'RKF01' });
      if (target === 'artifact') prepare(game);
      saveRun(game);
      return { phase: game.state.phase, seed };
    }

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const currentSeed = `${seed}:${attempt}`;
      const game = ShanhaiGame.create(content, { seed: currentSeed, name: '路线验收', method: 'RKF01' });
      prepare(game);
      let guard = 0;
      try {
        while (game.state.phase !== expectedPhase && !['lost', 'won'].includes(game.state.phase) &&
          guard++ < 180) {
          advance(game);
        }
      } catch {
        continue;
      }
      if (game.state.phase !== expectedPhase) continue;
      if (target === 'shop') {
        const sources = ['RC11', 'RC12'];
        const usableSources = sources.filter(id => game.reforgeOptions(id).length > 0);
        if (usableSources.length < 2) continue;
      }
      if (target === 'rest' && !game.warmableArtifacts().length) continue;
      saveRun(game);
      return {
        phase: game.state.phase,
        seed: currentSeed,
        step: game.state.step,
        nodeType: game.node?.type,
        artifacts: game.state.artifacts,
      };
    }
    throw new Error(`Could not create a legal ${target} fixture after 50 seeds`);
  }, { target, seed, saveKey });
}

async function createEventFixture(page, desiredSuccess, seedPrefix) {
  return page.evaluate(async ({ desiredSuccess, seedPrefix }) => {
    const [{ loadContent }, { ShanhaiGame }, { saveRun }, { resolveEventCheck }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
      import('/shanhai/event-checks.js'),
    ]);
    const content = await loadContent('/content/');
    const event = content.byId.RE001;
    const option = event?.options?.find(candidate => candidate.id === 'RE001-C');
    if (!option?.check) throw new Error('RE001-C is not a checked event option');

    function distanceTo(game, predicate) {
      const byKey = new Map(game.state.routeMap.nodes.map(node => [node.key, node]));
      const memo = new Map();
      const distance = node => {
        if (predicate(node)) return 0;
        if (memo.has(node.key)) return memo.get(node.key);
        const children = node.next.map(key => byKey.get(key)).filter(Boolean);
        const result = children.length ? 1 + Math.min(...children.map(distance)) : Infinity;
        memo.set(node.key, result);
        return result;
      };
      return game.availableNodes()
        .map(node => ({ node, distance: distance(byKey.get(node.key) ?? node) }))
        .filter(item => Number.isFinite(item.distance))
        .sort((left, right) =>
          left.distance - right.distance ||
          left.node.lane - right.node.lane ||
          left.node.key.localeCompare(right.node.key),
        )[0]?.node;
    }

    function toEvent(game) {
      for (let guard = 0; guard < 16 && game.state.phase !== 'event'; guard += 1) {
        if (game.state.phase === 'map') {
          const node = distanceTo(game, candidate =>
            candidate.type === 'E' && candidate.depth === 1,
          );
          if (!node) throw new Error('No reachable act-one ordinary event at depth one');
          if (node.type === 'E') {
            const routeNode = game.state.routeMap.nodes.find(candidate => candidate.key === node.key);
            if (!routeNode) throw new Error('Event route node not found');
            routeNode.id = 'RE001';
            routeNode.description = event.name;
          }
          game.dispatch({ type: 'enter', id: node.key });
        } else if (game.state.phase === 'preview') {
          game.dispatch({ type: 'fight' });
        } else if (game.state.phase === 'battle') {
          let drawGuard = 0;
          while (game.state.battle?.outcome === 'draw' && drawGuard++ < 5) {
            game.dispatch({ type: 'continue_battle' });
          }
          if (game.state.battle?.outcome !== 'player') throw new Error('Opening fixture battle was not won');
          game.dispatch({ type: 'battle_done' });
        } else if (game.state.phase === 'reward') {
          game.dispatch({ type: 'reward', id: null });
        } else if (game.state.phase === 'talent') {
          const talent = game.availableTalents()[0];
          if (!talent) throw new Error('No talent available before event fixture');
          game.dispatch({ type: 'talent', id: talent.id });
        } else {
          throw new Error(`Cannot route event fixture from ${game.state.phase}`);
        }
      }
      if (game.state.phase !== 'event' || game.node?.id !== 'RE001') {
        throw new Error('Fixture did not arrive at RE001');
      }
    }

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const seed = `${seedPrefix}:${attempt}`;
      const game = ShanhaiGame.create(content, { seed, name: '机缘检验', method: 'RKF01' });
      game.state.coins = 500;
      try {
        toEvent(game);
        const availability = game.optionAvailability(option);
        if (!availability.available) continue;
        const check = resolveEventCheck(option.check, {
          seed,
          act: game.state.act,
          step: game.state.step + 1,
          eventId: event.id,
          optionId: option.id,
          stats: game.stats,
          hp: game.state.hp,
          ownedMethods: game.state.ownedMethods,
          artifacts: game.state.artifacts,
        });
        if (check.success !== desiredSuccess) continue;
        saveRun(game);
        return { phase: game.state.phase, seed, check };
      } catch {
        continue;
      }
    }
    throw new Error(`Could not find a RE001-C ${desiredSuccess ? 'success' : 'failure'} seed`);
  }, { desiredSuccess, seedPrefix });
}

async function stateSnapshot(page) {
  return page.evaluate(async saveKey => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    if (!game) throw new Error('Saved run was not restored');
    return {
      phase: game.state.phase,
      step: game.state.step,
      coins: game.state.coins,
      hp: game.state.hp,
      artifacts: game.state.artifacts.map(stack => ({ ...stack })),
      historyLength: game.state.history.length,
      eventCheck: game.state.eventCheck,
      eventOption: game.state.eventOption,
      resultText: game.state.resultText,
      resultOutcome: game.state._eventOutcome,
      shopReforged: game.state._shopReforged,
      nodeType: game.node?.type,
    };
  }, saveKey);
}

async function inspectEvent(page, viewportName, desiredSuccess) {
  await cleanPage(page);
  const fixture = await createEventFixture(page, desiredSuccess, `${viewportName}-event-${desiredSuccess}`);
  assert.equal(fixture.phase, 'event');
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.phase-event .event-option-hint').waitFor();
  const option = page.locator('.phase-event [data-action="event"][data-id="RE001-C"]');
  assert.equal(await option.count(), 1);
  const text = await option.innerText();
  assert.match(text, /空手而归/);
  assert.match(text, /灵石/);
  assert.match(text, /-\s*灵石\s*12/);
  assert.doesNotMatch(text, /RC17|行医囊|获得法宝|具体所得/);
  assert.equal(await option.locator('.event-rewards').count(), 0,
    'A hint-reveal option must not expose its exact success reward');
  const result = await assertLayout(page, `${viewportName} event hint`);
  await screenshot(page, `${viewportName}-event-hint`);

  const before = await stateSnapshot(page);
  assert.equal(before.phase, 'event');
  assert.equal(before.eventOption, undefined);
  await option.click();
  await page.locator('.phase-event_result .event-check-result').waitFor();
  const checkLabel = page.locator('.event-check-result');
  assert.equal(await checkLabel.textContent(), desiredSuccess ? '检验成功' : '检验未成');
  const outcomeText = (await page.locator('.event-result').innerText()).replace(/\s+/g, ' ').trim();
  assert.ok(outcomeText.length > 10, 'The event result must provide player-facing feedback');
  assert.equal(await page.locator('.phase-event_result [data-action="event"]').count(), 0);
  await assertLayout(page, `${viewportName} event result ${desiredSuccess}`);
  await screenshot(page, `${viewportName}-event-${desiredSuccess ? 'success' : 'failure'}`);
  const settled = await stateSnapshot(page);
  assert.equal(settled.phase, 'event_result');
  assert.equal(settled.eventCheck?.success, desiredSuccess);
  assert.equal(settled.resultOutcome, desiredSuccess ? 'success' : 'failure');
  assert.equal(settled.historyLength, before.historyLength,
    'Event results are not appended to travel history until the node is continued');

  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.event-check-result').textContent(), desiredSuccess ? '检验成功' : '检验未成');
  assert.equal((await page.locator('.event-result').innerText()).replace(/\s+/g, ' ').trim(), outcomeText,
    'Reload must preserve the exact settled event feedback');
  const reloaded = await stateSnapshot(page);
  assert.equal(reloaded.coins, settled.coins, 'Reload must not settle the event a second time');
  assert.deepEqual(reloaded.artifacts, settled.artifacts);
  assert.equal(reloaded.historyLength, settled.historyLength);
  const repeat = await page.evaluate(async () => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    try {
      game.dispatch({ type: 'event', id: 'RE001-C' });
      return { rejected: false, phase: game.state.phase, coins: game.state.coins };
    } catch (error) {
      return { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
  });
  assert.equal(repeat.rejected, true, 'The settled check cannot be dispatched a second time');
  assert.equal((await stateSnapshot(page)).coins, settled.coins);
  return { fixture, text, result, check: settled.eventCheck, outcomeText };
}

async function inspectShop(page, viewportName) {
  await cleanPage(page);
  const fixture = await seedGame(page, 'shop', `${viewportName}-shop`);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await pagePhase(page), 'shop');
  const disclosure = page.locator('details[data-details="shop-reforge"]');
  assert.equal(await disclosure.evaluate(element => element.open), false);
  await disclosure.locator('summary').click();
  const source = page.locator('[data-reforge-source]');
  await source.waitFor();
  const sourceIds = await source.locator('option').evaluateAll(options =>
    options.map(option => option.value),
  );
  assert.ok(sourceIds.includes('RC11') && sourceIds.includes('RC12'));
  await source.selectOption('RC12');
  const runtimeOptions = await page.evaluate(async () => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    return {
      ids: game.reforgeOptions('RC12'),
      availability: game.reforgeOptions('RC12').map(id =>
        game.reforgeAvailability('RC12', id),
      ),
      price: game.reforgePrice(),
      coins: game.state.coins,
    };
  });
  assert.ok(runtimeOptions.ids.length > 0, 'Runtime must offer at least one legal reforge target');
  assert.ok(runtimeOptions.availability.every(item => item.available),
    'The selected source candidates should be confirmed by runtime availability');
  const firstCandidates = await page.locator('.reforge-option [data-action="reforge"]')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-target')));
  assert.deepEqual(firstCandidates, runtimeOptions.ids);
  await source.selectOption('RC11');
  const otherSourceCandidates = await page.locator('.reforge-option [data-action="reforge"]')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-target')));
  const expectedOtherCandidates = await page.evaluate(async () => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    return loadRun(content).reforgeOptions('RC11');
  });
  assert.deepEqual(otherSourceCandidates, expectedOtherCandidates);
  await source.selectOption('RC12');
  const stableCandidates = await page.locator('.reforge-option [data-action="reforge"]')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-target')));
  assert.deepEqual(stableCandidates, firstCandidates,
    'Returning to the selected source must restore the same deterministic candidates');
  const targetId = runtimeOptions.ids[0];
  const target = page.locator(
    `.reforge-option [data-action="reforge"][data-source="RC12"][data-target="${targetId}"]`,
  );
  await target.waitFor();
  const before = await stateSnapshot(page);
  const optionText = await target.locator('xpath=..').innerText();
  assert.match(optionText, /叠层/);
  const result = await assertLayout(page, `${viewportName} shop reforge choices`);
  await screenshot(page, `${viewportName}-shop-reforge`);
  await target.click();
  await page.locator('.reforge-unavailable').filter({ hasText: '本店已重铸过一次' }).waitFor();
  const after = await stateSnapshot(page);
  assert.equal(after.phase, 'shop');
  assert.equal(after.coins, before.coins - runtimeOptions.price,
    'A reforge must deduct its listed price once');
  assert.equal(after.shopReforged, true);
  const beforeSource = before.artifacts.find(item => item.id === 'RC12')?.stacks || 0;
  const afterSource = after.artifacts.find(item => item.id === 'RC12')?.stacks || 0;
  assert.equal(afterSource, beforeSource - 1, 'A reforge must sacrifice exactly one source stack');
  const beforeTarget = before.artifacts.find(item => item.id === targetId)?.stacks || 0;
  const afterTarget = after.artifacts.find(item => item.id === targetId)?.stacks || 0;
  assert.equal(afterTarget, beforeTarget + 1, 'A reforge must add exactly one candidate stack');
  assert.equal(await page.locator('[data-action="reforge"]:not([disabled])').count(), 0,
    'No second candidate may remain enabled after the once-per-shop reforge');
  await assertLayout(page, `${viewportName} shop after reforge`);
  await screenshot(page, `${viewportName}-shop-reforged`);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await pagePhase(page), 'shop');
  const persisted = await stateSnapshot(page);
  assert.equal(persisted.coins, after.coins);
  assert.deepEqual(persisted.artifacts, after.artifacts);
  assert.equal(persisted.shopReforged, true);
  const persistedDisclosure = page.locator('details[data-details="shop-reforge"]');
  await persistedDisclosure.locator('summary').click();
  assert.equal(await page.locator('[data-action="reforge"]:not([disabled])').count(), 0,
    'Reload must retain the once-per-shop disable state');
  assert.match(await page.locator('.reforge-tool').innerText(), /本店已重铸过一次/);
  await assertLayout(page, `${viewportName} shop after reload`);
  return { fixture, runtimeOptions, sourceIds, targetId, result };
}

async function inspectRest(page, viewportName) {
  await cleanPage(page);
  const fixture = await seedGame(page, 'rest', `${viewportName}-rest`);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await pagePhase(page), 'rest');
  const temper = page.locator('details[data-details="rest-temper"]');
  assert.equal(await temper.evaluate(element => element.open), false);
  await temper.locator('summary').click();
  const select = page.locator('[data-temper-artifact]');
  await select.waitFor();
  const summaryGeometry = await restTemperSummaryGeometry(page);
  const options = await select.locator('option').evaluateAll(elements =>
    elements.map(element => element.value),
  );
  assert.ok(options.length > 0, 'Rest fixture must have a warmable artifact');
  const artifactId = options[0];
  await select.selectOption(artifactId);
  const runtime = await page.evaluate(async artifactId => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    const artifact = content.byId[artifactId];
    return {
      cost: game.warmCost(),
      warmable: game.warmableArtifacts(),
      current: game.state.artifacts.find(stack => stack.id === artifactId)?.stacks || 0,
      max: artifact.max_stacks,
      coins: game.state.coins,
    };
  }, artifactId);
  assert.ok(runtime.warmable.includes(artifactId));
  assert.ok(runtime.current < runtime.max);
  assert.ok(runtime.coins >= runtime.cost);
  assert.match(await page.locator('.rest-temper-result').innerText(), /叠层\s+\d+\s+→\s+\d+\s+\/\s+\d+/);
  assert.match(await page.locator('.rest-temper-panel').innerText(), new RegExp(`${runtime.cost}\\s*灵石`));
  const before = await stateSnapshot(page);
  const result = await assertLayout(page, `${viewportName} rest temper`);
  await screenshot(page, `${viewportName}-rest-temper`);
  await page.locator('[data-action="rest"][data-choice="temper"]').click();
  const after = await stateSnapshot(page);
  assert.equal(after.phase, 'map', 'Tempering consumes this rest node');
  assert.equal(after.step, before.step + 1, 'Tempering advances the route exactly once');
  assert.equal(after.coins, before.coins - runtime.cost, 'Tempering deducts its price once');
  assert.equal(after.artifacts.find(item => item.id === artifactId)?.stacks, runtime.current + 1);
  await page.reload({ waitUntil: 'networkidle' });
  const persisted = await stateSnapshot(page);
  assert.equal(persisted.phase, 'map');
  assert.equal(persisted.step, after.step);
  assert.equal(persisted.coins, after.coins);
  assert.deepEqual(persisted.artifacts, after.artifacts);
  await assertLayout(page, `${viewportName} rest after reload`);
  await screenshot(page, `${viewportName}-rest-tempered`);
  return {
    fixture,
    runtime,
    artifactId,
    result,
    summaryGeometry,
  };
}

async function inspectAwakening(page, viewportName) {
  await cleanPage(page);
  const fixture = await seedGame(page, 'artifact', `${viewportName}-artifact`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-action="tab"][data-id="build"]:visible').click();
  const artifact = page.locator('.ability-card[data-action="inspect-artifact"][data-id="RC11"]');
  await artifact.scrollIntoViewIfNeeded();
  await artifact.click();
  const detail = page.locator('.item-dialog');
  await detail.waitFor();
  const awakening = detail.locator('.artifact-awakening');
  assert.equal(await awakening.count(), 1);
  assert.match(await awakening.innerText(), /觉醒/);
  assert.match(await awakening.innerText(), /距觉醒还差\s*1\s*层/);
  const result = await assertLayout(page, `${viewportName} artifact awakening detail`);
  await screenshot(page, `${viewportName}-artifact-awakening`);
  return { fixture, text: await awakening.innerText(), result };
}

async function inspectMapPressure(page, viewportName) {
  await cleanPage(page);
  const fixture = await seedGame(page, 'map', `${viewportName}-map`);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await pagePhase(page), 'map');
  const hint = page.locator('.boss-map-hint');
  assert.equal(await hint.count(), 1, 'The current act map should show its boss pressure');
  assert.equal(await hint.evaluate(element => element.open), false,
    'Boss counterplay should stay folded on the route map');
  const text = await hint.innerText();
  assert.match(text, /的主要压力/);
  assert.doesNotMatch(text, /。。/, 'Boss pressure copy should not add a duplicate full stop');
  assert.ok(text.length > 12);
  const result = await assertLayout(page, `${viewportName} boss map pressure`);
  await screenshot(page, `${viewportName}-map-boss-pressure`);
  await hint.locator('summary').click();
  assert.equal(await hint.evaluate(element => element.open), true);
  assert.ok((await hint.locator('p').innerText()).length > 5,
    'The frozen boss counterplay must remain available on demand');
  await assertLayout(page, `${viewportName} expanded boss map pressure`);
  await screenshot(page, `${viewportName}-map-boss-counterplay`);
  return { fixture, text, result };
}

async function inspectBattle(page, viewportName) {
  await cleanPage(page);
  const fixture = await seedGame(page, 'battle', `${viewportName}-battle`);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await pagePhase(page), 'battle');
  assert.equal(await page.locator('.battle-settlement').count(), 0,
    'The unfinished playback must not expose settlement highlights');
  assert.equal(await page.locator('.battle-insights').count(), 0);
  assert.equal(await page.locator('[data-action="battle-details"][data-tab="result"]').count(), 0,
    'The result detail must not be available before playback finishes');
  assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'), 'false');
  const activeResult = await assertLayout(page, `${viewportName} unfinished battle`);
  await screenshot(page, `${viewportName}-battle-unfinished`);

  await page.locator('[data-action="battle-skip"]').click();
  const settlement = page.locator('.battle-settlement');
  await settlement.waitFor();
  const insights = settlement.locator('.battle-insights');
  await insights.waitFor();
  const highlightRows = insights.locator('ul > li');
  assert.ok(await highlightRows.count() > 0, 'Compact settlement should show measured build highlights');
  assert.ok(await highlightRows.count() <= 2, 'Compact settlement should cap highlights at two rows');
  const settlementText = await settlement.innerText();
  assert.doesNotMatch(settlementText, /RC20|RC11|RC12|contribution|contributions|frames/i);
  await insights.scrollIntoViewIfNeeded();
  const insightsReachable = await insights.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const nav = document.querySelector('.bottom-nav');
    const navTop = nav && getComputedStyle(nav).display !== 'none'
      ? nav.getBoundingClientRect().top : innerHeight;
    return rect.top >= 0 && rect.bottom <= navTop + 1;
  });
  assert.equal(insightsReachable, true, 'Battle highlights must scroll fully clear of the bottom navigation');
  await assertLayout(page, `${viewportName} compact battle settlement`);
  await screenshot(page, `${viewportName}-battle-settlement`);

  await page.locator('[data-action="battle-details"][data-tab="result"]').click();
  const detail = page.locator('.battle-detail-dialog');
  await detail.waitFor();
  await detail.locator('[data-action="battle-detail-tab"][data-tab="result"]').click();
  const resultPanel = detail.locator('.battle-result-detail');
  await resultPanel.waitFor();
  assert.ok(await resultPanel.locator('.battle-insights ul > li').count() > 0);
  assert.match(await resultPanel.innerText(), /最终结果/);
  assert.match(await resultPanel.innerText(), /我方取胜|我方落败/);
  assert.doesNotMatch(await resultPanel.innerText(), /RC20|RC11|RC12|contribution|contributions/i);
  await assertLayout(page, `${viewportName} battle result detail`);
  await screenshot(page, `${viewportName}-battle-result-detail`);
  return { fixture, settlementText, result: await assertLayout(page, `${viewportName} final battle layout`), activeResult };
}

async function run() {
  const screenshotDir = path.join(reportDir, 'screenshots');
  await mkdir(screenshotDir, { recursive: true });
  for (const file of await readdir(screenshotDir)) {
    if (file.endsWith('.png')) await unlink(path.join(screenshotDir, file));
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });

  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      page.setDefaultTimeout(8000);
      page.on('pageerror', error => browserErrors.push({
        viewport: viewport.name,
        type: 'pageerror',
        message: error.message,
      }));
      page.on('console', message => {
        if (message.type() === 'error') browserErrors.push({
          viewport: viewport.name,
          type: 'console.error',
          message: message.text(),
        });
      });

      await check(`${viewport.name} boss pressure map`, page, () => inspectMapPressure(page, viewport.name));
      await check(`${viewport.name} artifact awakening detail`, page, () => inspectAwakening(page, viewport.name));
      await check(`${viewport.name} event hint and success settlement`, page, () => inspectEvent(page, viewport.name, true));
      await check(`${viewport.name} event hint and failure settlement`, page, () => inspectEvent(page, viewport.name, false));
      await check(`${viewport.name} shop reforge stability and persistence`, page, () => inspectShop(page, viewport.name));
      await check(`${viewport.name} rest temper and once-only consumption`, page, async () => {
        const result = await inspectRest(page, viewport.name);
        assert.ok(
          result.summaryGeometry.summaryWidth >= result.summaryGeometry.detailsWidth * 0.75,
          `Rest temper disclosure summary is too narrow: ${JSON.stringify(result.summaryGeometry)}`,
        );
        return result;
      });
      await check(`${viewport.name} compact battle result disclosure`, page, () => inspectBattle(page, viewport.name));
      await page.close();
    }

    checks.push({
      name: 'browser console and uncaught page errors',
      ok: browserErrors.length === 0,
      errors: browserErrors,
    });
    for (const obstruction of textObstructions) {
      checks.push({
        name: `${obstruction.label} visible text obstruction`,
        ok: false,
        viewport: obstruction.viewport,
        overlaps: obstruction.overlaps,
        screenshot: obstruction.screenshot,
        fileRef: obstruction.label.includes('rest temper')
          ? 'src/shanhai/cartoon.css:3452; src/shanhai/style.css:6733'
          : 'src/shanhai/style.css:5709; src/shanhai/cartoon.css:2931',
        error: `${obstruction.overlaps.length} intersecting visible text pairs`,
      });
    }
  } finally {
    await browser.close();
    const report = {
      url,
      generatedAt: new Date().toISOString(),
      viewports,
      checks,
      browserErrors,
      textObstructions,
      screenshots,
    };
    await writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const failed = checks.filter(item => !item.ok);
    const lines = [
      '# Roguelite Browser Verification',
      '',
      `- URL: ${url}`,
      `- Generated: ${report.generatedAt}`,
      `- Viewports: ${viewports.map(item => `${item.width}x${item.height}`).join(', ')}`,
      `- Result: ${checks.length - failed.length}/${checks.length} checks passed`,
      '',
      '## Checks',
      '',
      ...checks.map(item =>
        `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `: ${item.error}` : ''}`,
      ),
      '',
      '## Screenshots',
      '',
      ...screenshots.map(item => `- ${typeof item === 'string' ? `[${item}](./${item})` : `${item.path}: ${item.error}`}`),
      '',
      '## Failures',
      '',
      ...(failed.length
        ? failed.map(item =>
          `- ${item.name}: ${item.error}${item.fileRef ? ` (${item.fileRef})` : ''}${item.screenshot ? ` (screenshot: ${item.screenshot})` : ''}`,
        )
        : ['No failed checks.']),
      '',
      '## Text Obstruction References',
      '',
      ...(textObstructions.length
        ? textObstructions.map(item =>
          `- ${item.label}: ${item.overlaps.length} intersecting text pairs; likely CSS area: ${item.label.includes('rest temper') ? 'src/shanhai/cartoon.css:3452 and src/shanhai/style.css:6733' : 'src/shanhai/style.css:5709 and src/shanhai/cartoon.css:2931'}.${item.screenshot ? ` [Screenshot](./${item.screenshot})` : ''}`,
        )
        : ['No visible text intersections detected.']),
    ];
    await writeFile(path.join(reportDir, 'report.md'), `${lines.join('\n')}\n`);
  }

  const failed = checks.filter(item => !item.ok);
  if (failed.length) {
    console.error(`${failed.length}/${checks.length} browser checks failed. See ${path.join(reportDir, 'report.md')}`);
    process.exitCode = 1;
  } else {
    console.log(`${checks.length} browser checks passed. Report: ${path.join(reportDir, 'report.md')}`);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
