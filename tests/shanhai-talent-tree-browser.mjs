import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { serializeRun } from '../build/shanhai/persistence.js';
import { pauseNextReplay } from './shanhai-replay-fixture.mjs';

const url = process.env.BROWSER_URL || 'http://127.0.0.1:4175/';
const reportDir = process.env.SHANHAI_TALENT_TREE_REPORT_DIR
  ? path.resolve(process.env.SHANHAI_TALENT_TREE_REPORT_DIR)
  : path.join(os.tmpdir(), 'shanhai-talent-tree-browser');
const saveKey = 'suishi-shanhai-run-v1';
const replayKey = 'suishi-shanhai-replay-v1';
const checks = [];
const failures = [];
const pageErrors = [];
const loaded = await loadContent();
const content = {
  version: loaded.manifest.content_version,
  entities: loaded.entities,
  byId: loaded.byId,
  rules: loaded.entities.find(entity => entity.id === 'RULES'),
};

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

function method(methodId) {
  return content.byId.get(methodId);
}

function talentsFor(methodId, n, branches = ['A', 'B', 'C', 'A']) {
  return Array.from({ length: n }, (_value, index) => {
    const tier = index + 1;
    const branch = branches[index % branches.length];
    const talent = method(methodId).talents.find(item =>
      item.tier === tier && item.branch === branch);
    assert.ok(talent, `缺少 ${methodId} 第 ${tier} 层 ${branch} 分支天赋`);
    return talent.id;
  });
}

function installFixtureCombat() {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player) {
      return {
        outcome: 'player',
        rounds: 1,
        playerHp: player.hp ?? 1,
        enemyHp: 0,
        frames: [],
        contributions: [],
      };
    },
  });
}

function resolveCurrentNode(game) {
  let guard = 0;
  while (game.state.phase !== 'map' && !['won', 'lost'].includes(game.state.phase) &&
    guard++ < 32) {
    if (game.state.phase === 'preview') game.dispatch({ type: 'fight' });
    else if (game.state.phase === 'battle') game.dispatch({ type: 'battle_done' });
    else if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
    else if (game.state.phase === 'event') {
      const event = content.byId.get(game.node.id);
      const option = event.options.find(candidate =>
        !candidate.encounter && game.optionAvailability(candidate).available) ??
        event.options.find(candidate => game.optionAvailability(candidate).available);
      assert.ok(option, `fixture 事件 ${event.id} 没有可用选项`);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
    else if (game.state.phase === 'shop') game.dispatch({ type: 'leave_shop' });
    else if (game.state.phase === 'rest') game.dispatch({ type: 'rest', choice: 'heal' });
    else if (game.state.phase === 'talent') {
      const choice = game.availableTalents()[0];
      assert.ok(choice, 'fixture 突破阶段没有天赋可选');
      game.dispatch({ type: 'talent', id: choice.id });
    } else if (game.state.phase === 'transition') game.dispatch({ type: 'continue' });
    else throw new Error(`fixture 无法处理阶段 ${game.state.phase}`);
  }
  assert.ok(guard < 32, 'fixture 节点未能结算');
}

function openShop(game) {
  const route = game.state.routeMap;
  const byKey = new Map(route.nodes.map(node => [node.key, node]));
  const queue = game.availableNodes().map(node => [node.key]);
  const seen = new Set();
  let path;
  while (queue.length && !path) {
    const current = queue.shift();
    const key = current.at(-1);
    if (seen.has(key)) continue;
    seen.add(key);
    const node = byKey.get(key);
    if (node?.type === 'S') path = current;
    else for (const next of node?.next ?? []) queue.push([...current, next]);
  }
  assert.ok(path, 'fixture 路线中没有可达坊市');
  for (const key of path) {
    if (game.state.phase !== 'map') resolveCurrentNode(game);
    const target = game.availableNodes().find(node => node.key === key);
    assert.ok(target, `fixture 路线节点 ${key} 当前不可达`);
    game.dispatch({ type: 'enter', id: key });
    if (target.type === 'S') return target;
    resolveCurrentNode(game);
  }
  throw new Error('fixture 未能抵达坊市');
}

function makeShopFixture({ seed, n, methodId = 'RKF03' }) {
  installFixtureCombat();
  const game = ShanhaiGame.create(content, { seed, name: '天赋树浏览器行者', method: methodId });
  openShop(game);
  const otherMethodId = methodId === 'RKF02' ? 'RKF03' : 'RKF02';
  if (!game.state.ownedMethods.includes(otherMethodId)) game.state.ownedMethods.push(otherMethodId);
  game.state.n = n;
  game.state.xp = content.rules.cultivation.cumulative[n - 1];
  game.state.talents[methodId] = talentsFor(methodId, n);
  game.state.talents[otherMethodId] = talentsFor(otherMethodId, n, ['C', 'A', 'B', 'C']);
  game.state.coins = 200;
  game.state.hp = 1;
  game.state.preparation = 55;
  game.state.firstStrike = 7;
  game.state._talentQueue = [];
  game.state._returnPhase = undefined;
  game.state.returnPhase = undefined;
  const state = structuredClone(game.state);
  return {
    save: serializeRun(game),
    methodId,
    otherMethodId,
    nodeKey: game.node?.key,
    initial: {
      n: state.n,
      xp: state.xp,
      hp: state.hp,
      preparation: state.preparation,
      firstStrike: state.firstStrike,
      coins: state.coins,
      talents: state.talents,
      history: state.history,
      nodeEntry: state.nodeEntry,
      node: game.node,
      phase: state.phase,
    },
    artifactId: state.shop.find(item => item.kind === 'artifact')?.id,
    fixtureKind: 'seeded ShanhaiGame shop fixture; not a claimed end-to-end player journey',
  };
}

function pathToCostEvent(game) {
  const byKey = new Map(game.state.routeMap.nodes.map(node => [node.key, node]));
  const queue = game.availableNodes().map(node => [node.key]);
  const seen = new Set();
  while (queue.length) {
    const path = queue.shift();
    const node = byKey.get(path.at(-1));
    if (!node || seen.has(node.key)) continue;
    seen.add(node.key);
    const event = content.byId.get(node.id);
    const option = event?.kind === 'event'
      ? event.options?.find(candidate => candidate.costs?.some(effect =>
        effect.type === 'resource' && Number.isFinite(effect.amount)))
      : undefined;
    if (option) return { path, eventId: event.id, optionId: option.id };
    for (const next of node.next ?? []) queue.push([...path, next]);
  }
  return undefined;
}

function makeCostEventFixture() {
  installFixtureCombat();
  const game = ShanhaiGame.create(content, {
    seed: 'talent-event-probe-0',
    name: '事件花费浏览器行者',
    method: 'RKF03',
  });
  game.state.coins = 200;
  const target = pathToCostEvent(game);
  assert.ok(target, 'fixture 路线中没有可达的数字资源花费事件');
  for (const key of target.path) {
    if (game.state.phase !== 'map') resolveCurrentNode(game);
    const node = game.availableNodes().find(candidate => candidate.key === key);
    assert.ok(node, `事件 fixture 路线节点 ${key} 当前不可达`);
    game.dispatch({ type: 'enter', id: key });
    if (key === target.path.at(-1)) {
      assert.equal(game.state.phase, 'event');
      return {
        save: serializeRun(game),
        eventId: target.eventId,
        optionId: target.optionId,
        fixtureKind: 'seeded ShanhaiGame event fixture; not a claimed end-to-end player journey',
      };
    }
    resolveCurrentNode(game);
  }
  throw new Error('事件 fixture 未能停在目标事件');
}

function advanceBattleFixture(game) {
  let guard = 0;
  while (game.state.phase !== 'battle' && !['won', 'lost'].includes(game.state.phase) &&
    guard++ < 100) {
    if (game.state.phase === 'map') {
      const node = game.availableNodes().find(candidate =>
        ['C', 'L', 'B', 'F'].includes(candidate.type)) || game.availableNodes()[0];
      assert.ok(node, '战斗 fixture 当前没有可前往节点');
      game.dispatch({ type: 'enter', id: node.key });
    } else if (game.state.phase === 'preview') game.dispatch({ type: 'fight' });
    else if (game.state.phase === 'battle') break;
    else if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
    else if (game.state.phase === 'event') {
      const event = content.byId.get(game.node.id);
      const option = event.options.find(candidate =>
        game.optionAvailability(candidate).available);
      assert.ok(option, '战斗 fixture 事件没有可用选项');
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
    else if (game.state.phase === 'shop') game.dispatch({ type: 'leave_shop' });
    else if (game.state.phase === 'rest') game.dispatch({ type: 'rest', choice: 'heal' });
    else if (game.state.phase === 'talent') {
      game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
    } else if (game.state.phase === 'transition') game.dispatch({ type: 'continue' });
    else throw new Error(`战斗 fixture 无法从 ${game.state.phase} 推进`);
  }
  assert.equal(game.state.phase, 'battle', '没有构建有效的进行中战斗 fixture');
}

function makeBattleFixture() {
  registerCombatWorker({ calculateStats, simulateBattle });
  const game = ShanhaiGame.create(content, {
    seed: 'talent-tree-active-battle-fixture',
    name: '斗法天赋树行者',
    method: 'RKF03',
  });
  game.state.n = 4;
  game.state.xp = content.rules.cultivation.cumulative[3];
  game.state.talents.RKF03 = talentsFor('RKF03', 4);
  game.state.hp = game.stats.max_hp;
  advanceBattleFixture(game);
  return {
    save: serializeRun(game),
    fixtureKind: 'seeded ShanhaiGame active-battle fixture with deterministic replay input; not a claimed end-to-end player journey',
  };
}

async function check(name, run) {
  try {
    const result = await run();
    checks.push({ name, ok: true, ...(result ?? {}) });
    console.log(`ok - ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    checks.push({ name, ok: false, error: detail });
    throw error;
  }
}

async function clickAction(page, action, selector = `[data-action="${action}"]`) {
  const candidates = page.locator(selector);
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible()) || await candidate.isDisabled()) continue;
    await candidate.click();
    return candidate;
  }
  throw new Error(`找不到可见操作 ${selector}`);
}

async function waitForPhase(page, phase) {
  await page.locator(`.game-page.phase-${phase}`).waitFor({ state: 'visible' });
}

async function storageSnapshot(page) {
  return page.evaluate(() => Object.fromEntries(
    Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]),
  ));
}

async function savedRun(page) {
  const text = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(text, '缺少浏览器自动存档');
  const record = JSON.parse(text);
  assert.equal(record.key, saveKey);
  return { text, record, state: record.state };
}

async function noOverflow(page, width, scope = 'document') {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(metrics.document <= metrics.viewport + 1,
    `${width}px 页面横向溢出 ${JSON.stringify(metrics)} (${scope})`);
  assert.ok(metrics.body <= metrics.viewport + 1,
    `${width}px body 横向溢出 ${JSON.stringify(metrics)} (${scope})`);
}

async function installFixture(page, fixture) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(({ saveKey, save }) => {
    localStorage.clear();
    localStorage.setItem(saveKey, save);
  }, { saveKey, save: fixture.save });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, 'shop');
  const run = await savedRun(page);
  assert.equal(run.state.phase, 'shop');
  assert.equal(run.state.n, fixture.initial.n);
  return run;
}

async function installMarkupFixture(page, fixture, { contentKind, entityId, mutate, phase }) {
  const maliciousMarkup = '<img src=x onerror="window.__shanhaiXss=1">';
  let intercepted = false;
  await page.addInitScript(() => { window.__shanhaiXss = 0; });
  await page.route(`**/content/${contentKind}/**/*.json`, async route => {
    const response = await route.fetch();
    if (new URL(route.request().url()).pathname.endsWith(`/${entityId}.json`)) {
      const entity = await response.json();
      mutate(entity, maliciousMarkup);
      intercepted = true;
      await route.fulfill({ response, body: JSON.stringify(entity) });
      return;
    }
    await route.fulfill({ response });
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(({ saveKey, save }) => {
    localStorage.clear();
    localStorage.setItem(saveKey, save);
  }, { saveKey, save: fixture.save });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, phase);
  assert.ok(intercepted, `没有拦截到 ${contentKind}/${entityId}.json`);
  return maliciousMarkup;
}

async function openTalentTree(page) {
  const trigger = page.locator('.topbar [data-action="talent-tree"]');
  const box = await trigger.boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44,
    `天赋树顶部入口触控区域不足 44px ${JSON.stringify(box)}`);
  await trigger.click();
  const dialog = page.locator('.talent-tree-dialog');
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

async function assertReadOnlyTree(page, fixture, {
  selectedCount,
  candidateTier,
  expectedSelectedIds,
} = {}) {
  const dialog = page.locator('.talent-tree-dialog');
  const tree = dialog.locator('.talent-tree-readonly');
  await tree.waitFor({ state: 'visible' });
  assert.equal(await tree.getAttribute('data-method'), fixture.methodId);
  assert.equal(await tree.locator('.talent-tier-row').count(), 4,
    '只读天赋树必须显示完整四层');
  assert.equal(await tree.locator('.talent-tier-row').evaluateAll(rows =>
    rows.map(row => row.querySelectorAll('.talent-tree-node[data-talent-id]').length).join(',')),
  '3,3,3,3', '每层应包含 A/B/C 三个实体天赋节点');
  assert.equal(await tree.locator('.talent-tree-node[data-action="inspect-talent"]').count(), 12,
    '12 个树节点都应可查看详录');
  assert.equal(await tree.locator('[data-action="talent"]').count(), 0,
    '只读树不得暴露悟得/选择操作');

  const nodes = await tree.locator('.talent-tree-node[data-talent-id]').evaluateAll(elements =>
    elements.map(element => {
      const row = element.closest('.talent-tier-row');
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        id: element.getAttribute('data-talent-id'),
        name: element.querySelector('strong')?.textContent?.trim() || '',
        quick: element.querySelector('small')?.textContent?.trim() || '',
        tier: Number(row?.getAttribute('data-tier')),
        selected: element.getAttribute('data-selected') === 'true',
        future: element.getAttribute('data-future') === 'true',
        choice: element.getAttribute('data-choice') === 'current',
        width: rect.width,
        height: rect.height,
        fontSize: Number.parseFloat(style.fontSize),
        opacity: Number.parseFloat(style.opacity),
      };
    }));
  assert.equal(nodes.length, 12);
  assert.ok(nodes.every(node => node.name && node.quick && node.width > 0 &&
    node.height >= 44 && node.fontSize >= 12 && node.opacity >= 0.5),
  `树节点文字/触控区不可读 ${JSON.stringify(nodes)}`);
  assert.equal(nodes.filter(node => node.selected).length, selectedCount,
    `应有 ${selectedCount} 个已悟节点`);
  const unlockedTier = fixture.initial?.n ?? selectedCount;
  for (const node of nodes) {
    assert.equal(node.future, node.tier > unlockedTier,
      `${node.id} 的 data-future 状态与解锁层数不符`);
  }
  const actualSelectedIds = nodes.filter(node => node.selected).map(node => node.id);
  const expectedIds = expectedSelectedIds ??
    fixture.initial?.talents?.[fixture.methodId];
  if (expectedIds) {
    assert.deepEqual(actualSelectedIds, expectedIds,
      'data-selected 应准确标记当前已悟节点');
  }
  if (selectedCount > 1 && expectedIds) {
    const branches = expectedIds.map(id =>
      method(fixture.methodId).talents.find(talent => talent.id === id)?.branch);
    assert.ok(branches.some((branch, index) => index > 0 && branch !== branches[index - 1]),
      `fixture 应覆盖跨分支的已悟路径 ${JSON.stringify(branches)}`);
  }
  if (candidateTier) {
    assert.equal(nodes.filter(node => node.choice && node.tier === candidateTier).length, 3,
      `第 ${candidateTier} 层应有三个当前可选节点`);
    const selectedBranch = method(fixture.methodId).talents.find(talent =>
      talent.id === actualSelectedIds.at(-1))?.branch;
    const candidateBranches = nodes.filter(node => node.choice && node.tier === candidateTier)
      .map(node => method(fixture.methodId).talents.find(talent => talent.id === node.id)?.branch);
    assert.deepEqual(candidateBranches.sort(), ['A', 'B', 'C'],
      `当前候选应完整展示三个分支 ${JSON.stringify(candidateBranches)}`);
    assert.ok(candidateBranches.some(branch => branch !== selectedBranch),
      '当前候选必须能跨越上一层分支');
  }
  assert.equal(await tree.locator('.talent-tree-empty').count(), 0,
    '本功法的树结构应完整包含十二个天赋');

  const dialogGeometry = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  assert.ok(dialogGeometry.scrollWidth <= dialogGeometry.clientWidth + 1,
    `只读树弹窗横向溢出 ${JSON.stringify(dialogGeometry)}`);

  for (let tier = 1; tier <= 4; tier += 1) {
    const row = tree.locator(`.talent-tier-row[data-tier="${tier}"]`);
    await row.scrollIntoViewIfNeeded();
    const rowGeometry = await row.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const dialogRect = element.closest('.talent-tree-dialog').getBoundingClientRect();
      return {
        row: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
        dialog: { x: dialogRect.x, y: dialogRect.y, right: dialogRect.right, bottom: dialogRect.bottom },
      };
    });
    assert.ok(rowGeometry.row.x >= rowGeometry.dialog.x - 1 &&
      rowGeometry.row.right <= rowGeometry.dialog.right + 1 &&
      rowGeometry.row.y >= rowGeometry.dialog.y - 1 &&
      rowGeometry.row.bottom <= rowGeometry.dialog.bottom + 1,
    `${tier} 层未能在弹窗可视区完整浏览 ${JSON.stringify(rowGeometry)}`);
    assert.equal(await row.locator('.talent-tree-node[data-talent-id]').count(), 3,
      `${tier} 层节点缺失`);
  }

  const futureCount = nodes.filter(node => node.future).length;
  assert.equal(futureCount, (4 - selectedCount) * 3 -
    (candidateTier ? 3 : 0),
  `未解锁节点状态不正确，future=${futureCount} n=${selectedCount} candidateTier=${candidateTier}`);

  const connectorData = await tree.locator('.talent-tree-connectors').evaluate(svg => {
    const treeRect = svg.parentElement.getBoundingClientRect();
    const positions = [...svg.parentElement.querySelectorAll('.talent-tree-node[data-talent-id]')]
      .map(node => {
        const rect = node.getBoundingClientRect();
        return {
          tier: Number(node.closest('.talent-tier-row')?.getAttribute('data-tier')),
          selected: node.getAttribute('data-selected') === 'true',
          choice: node.getAttribute('data-choice') === 'current',
          centerX: rect.left + rect.width / 2 - treeRect.left,
          topY: rect.top - treeRect.top,
          bottomY: rect.bottom - treeRect.top,
        };
      });
    return [...svg.querySelectorAll('path')].map(path => {
      const earned = path.getAttribute('data-earned') === 'true';
      const next = path.getAttribute('data-next') === 'true';
      const match = path.getAttribute('d')?.match(
        /^M\s*(-?[\d.]+)\s+(-?[\d.]+)\s+C\s*(-?[\d.]+)\s+(-?[\d.]+),\s*(-?[\d.]+)\s+(-?[\d.]+),\s*(-?[\d.]+)\s+(-?[\d.]+)/,
      );
      const viewBox = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
      const scaleX = treeRect.width / viewBox[2];
      const scaleY = treeRect.height / viewBox[3];
      return {
        earned,
        next,
        start: match ? [Number(match[1]) * scaleX, Number(match[2]) * scaleY] : null,
        end: match ? [Number(match[7]) * scaleX, Number(match[8]) * scaleY] : null,
        viewBox: svg.getAttribute('viewBox'),
        treeWidth: treeRect.width,
        treeHeight: treeRect.height,
        positions,
      };
    });
  });
  const earned = connectorData.filter(path => path.earned);
  const next = connectorData.filter(path => path.next);
  assert.equal(earned.length, Math.max(0, selectedCount - 1),
    `已悟路径连接数量错误 ${JSON.stringify(connectorData)}`);
  if (candidateTier) assert.equal(next.length, 3,
    `当前选择层应有三条分支连接 ${JSON.stringify(connectorData)}`);
  for (const connection of [...earned, ...next]) {
    assert.ok(connection.start && connection.end,
      `连接线没有有效路径坐标 ${JSON.stringify(connection)}`);
    const [start, end] = [connection.start, connection.end];
    assert.ok(start[0] >= 0 && start[0] <= connection.treeWidth &&
      end[0] >= 0 && end[0] <= connection.treeWidth &&
      start[1] >= 0 && start[1] <= connection.treeHeight &&
      end[1] >= 0 && end[1] <= connection.treeHeight,
    `路径端点未落在天赋树范围内 ${JSON.stringify(connection)}`);
    const expected = connection.earned
      ? connection.positions
        .filter(node => node.selected)
        .sort((left, right) => left.tier - right.tier)
        .slice(0, -1)
        .map((node, index, rows) => {
          const nextNode = connection.positions.find(candidate =>
            candidate.selected && candidate.tier === node.tier + 1);
          return nextNode && rows[index].tier + 1 === nextNode.tier
            ? {
              start: [node.centerX, node.bottomY],
              end: [nextNode.centerX, nextNode.topY],
            }
            : null;
        })
        .filter(Boolean)
      : connection.positions
        .filter(node => node.selected && node.tier === candidateTier - 1)
        .flatMap(node => connection.positions
          .filter(choice => choice.choice && choice.tier === candidateTier)
          .map(choice => ({
            start: [node.centerX, node.bottomY],
            end: [choice.centerX, choice.topY],
          })));
    assert.ok(expected.some(path =>
      Math.abs(path.start[0] - start[0]) <= 1 &&
      Math.abs(path.start[1] - start[1]) <= 1 &&
      Math.abs(path.end[0] - end[0]) <= 1 &&
      Math.abs(path.end[1] - end[1]) <= 1),
    `连接线没有连接实际节点边界 ${JSON.stringify({ connection, expected })}`);
  }
  return { nodeCount: nodes.length, selectedCount, futureCount, connectors: connectorData.length, dialogGeometry };
}

async function inspectEveryTalent(page, fixture) {
  const tree = page.locator('.talent-tree-dialog .talent-tree-readonly');
  const items = await tree.locator('.talent-tree-node[data-talent-id]').evaluateAll(elements =>
    elements.map(element => ({
      id: element.getAttribute('data-talent-id'),
      name: element.querySelector('strong')?.textContent?.trim(),
    })));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const node = tree.locator(`.talent-tree-node[data-talent-id="${item.id}"]`);
    await node.scrollIntoViewIfNeeded();
    await node.click();
    const detail = page.locator('.talent-dialog');
    await detail.waitFor({ state: 'visible' });
    assert.equal((await detail.locator('#dialog-title').textContent())?.trim(), item.name,
      `详录标题没有对应 ${item.id}`);
    assert.equal(await detail.locator('.effect-list').count(), 1,
      `天赋 ${item.id} 缺少效果详录`);
    if (index === items.length - 1) await page.keyboard.press('Escape');
    else await clickAction(page, 'modal-close', '.talent-dialog [data-action="modal-close"]');
    await page.locator('.talent-tree-dialog').waitFor({ state: 'visible' });
    const focusedId = await page.evaluate(() => document.activeElement?.getAttribute('data-talent-id'));
    assert.equal(focusedId, item.id, `关闭 ${item.id} 详录后焦点未回到原树节点`);
  }
  assert.equal((await savedRun(page)).state.phase, 'shop',
    `${fixture.methodId} 天赋详录不能推进命途`);
}

async function assertCurrentChoices(page, { tier, expectedN }) {
  await waitForPhase(page, 'talent');
  const choices = page.locator('.game-page.phase-talent [data-action="talent"]');
  assert.equal(await choices.count(), 3,
    '当前突破选择必须是独立的三个 data-action=talent 按钮');
  const currentTier = page.locator(`.game-page.phase-talent .talent-tier-row[data-tier="${tier}"]`);
  assert.equal(await currentTier.locator('.talent-tree-node[data-choice="current"]').count(), 3);
  const boxes = await choices.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }));
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(boxes.every(box => box.width >= 44 && box.height >= 44 &&
    box.x >= 0 && box.right <= viewport.width + 1 &&
    box.y >= 0 && box.bottom <= viewport.height + 1),
  `当前可选天赋触控区/首屏布局不合格 ${JSON.stringify({ boxes, viewport, tier })}`);
  const run = await savedRun(page);
  assert.equal(run.state.n, expectedN, '重选阶段不应减少已达境界');
  assert.equal(run.state.phase, 'talent');
}

async function installBattleFixture(page, fixture) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await pauseNextReplay(page);
  await page.evaluate(({ saveKey, save }) => {
    localStorage.clear();
    localStorage.setItem(saveKey, save);
    localStorage.removeItem('suishi-shanhai-replay-v1');
  }, { saveKey, save: fixture.save });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, 'battle');
  await page.locator('.battle-shell[data-paused="true"]').waitFor();
  await page.evaluate(replayKey => {
    const key = document.querySelector('.battle-shell')?.getAttribute('data-battle-key');
    const cursor = Number(document.querySelector('.combat-arena')?.getAttribute('data-frame-index') || 0);
    localStorage.setItem(replayKey, JSON.stringify({ key, cursor }));
  }, replayKey);
}

async function writeReport() {
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
    url,
    reportDir,
    generatedAt: new Date().toISOString(),
    fixtureKind: 'seeded ShanhaiGame/serializeRun fixtures; not a claimed true journey',
    viewports: [
      { width: 320, height: 760 },
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ],
    checks,
    failures,
    pageErrors,
  }, null, 2) + '\n');
}

async function run() {
  const shopFixtures = [
    makeShopFixture({ seed: 'talent-tree-ui-n2', n: 2 }),
    makeShopFixture({ seed: 'talent-tree-ui-n4', n: 4 }),
    makeShopFixture({ seed: 'talent-tree-ui-n1', n: 1 }),
  ];
  const battleFixture = makeBattleFixture();
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  try {
    const cases = [
      { width: 320, height: 760, fixture: shopFixtures[0] },
      { width: 390, height: 844, fixture: shopFixtures[1] },
      { width: 1440, height: 900, fixture: shopFixtures[2] },
    ];
    for (const item of cases) {
      const context = await browser.newContext({
        viewport: { width: item.width, height: item.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => pageErrors.push({
        viewport: `${item.width}x${item.height}`,
        type: 'pageerror',
        error: error.message,
      }));
      page.on('console', message => {
        if (message.type() === 'error') pageErrors.push({
          viewport: `${item.width}x${item.height}`,
          type: 'console',
          error: message.text(),
        });
      });
      await installFixture(page, item.fixture);
      await check(`${item.width}x${item.height} 坊市入口、全树浏览与无状态副作用`, async () => {
        const initialStorage = await storageSnapshot(page);
        const shopItem = page.locator('.shop-item.service-talent_reset');
        await shopItem.waitFor({ state: 'visible' });
        assert.equal((await shopItem.locator('h2').textContent())?.trim(), '洗髓丹');
        const buy = shopItem.locator('[data-action="buy"][data-id="talent_reset"]');
        assert.equal((await buy.textContent())?.replace(/\s+/g, ''), '40');
        assert.equal((await buy.locator('.text-number').textContent())?.trim(), '40',
          '坊市价格数字应通过安全文本格式化高亮');
        assert.equal(await buy.locator('img,script').count(), 0,
          '坊市数字文本不能生成 HTML 元素');
        assert.equal(await buy.isEnabled(), true, 'n>=1 且已有天赋时洗髓丹应可购买');
        const shopBuyBox = await buy.boundingBox();
        assert.ok(shopBuyBox && shopBuyBox.width >= 44 && shopBuyBox.height >= 44,
          `洗髓丹购买触控区不足 44px ${JSON.stringify(shopBuyBox)}`);

        await openTalentTree(page);
        const treeSummary = await assertReadOnlyTree(page, item.fixture, {
          selectedCount: item.fixture.initial.n,
        });
        assert.deepEqual(await storageSnapshot(page), initialStorage,
          '未触发天赋树交互之前/打开只读树后不应改写存档');
        await inspectEveryTalent(page, item.fixture);
        await page.keyboard.press('Escape');
        await page.locator('.talent-tree-dialog').waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')),
          'talent-tree', '关闭总树后焦点应回到顶部天赋树入口');
        assert.deepEqual(await storageSnapshot(page), initialStorage,
          '只读树浏览不能改变任何本地存档');
        await noOverflow(page, item.width, 'shop/global-tree');
        return { ...treeSummary, viewport: `${item.width}x${item.height}` };
      });

      if (item.width === 320) {
        await check('取消洗髓丹的按钮、Escape、遮罩均保持存档不变', async () => {
          for (const mode of ['button', 'escape', 'backdrop']) {
            const before = await storageSnapshot(page);
            await clickAction(page, 'buy',
              '.shop-item.service-talent_reset [data-action="buy"][data-id="talent_reset"]');
            const dialog = page.locator('.talent-reset-dialog');
            await dialog.waitFor({ state: 'visible' });
            assert.match(await dialog.innerText(), /洗髓丹|重选已悟天赋|40\s*灵石/);
            assert.equal((await dialog.locator('.talent-reset-summary .text-number').textContent())?.trim(), '40',
              '确认摘要中的 40 灵石应保持数字强调');
            assert.equal((await savedRun(page)).state.coins, item.fixture.initial.coins,
              `${mode}取消前不应提前扣款`);
            if (mode === 'button') await clickAction(page, 'talent-reset-cancel');
            else if (mode === 'escape') await page.keyboard.press('Escape');
            else await page.locator('.modal-backdrop').dispatchEvent('click');
            await dialog.waitFor({ state: 'detached' });
            assert.deepEqual(await storageSnapshot(page), before,
              `${mode}取消购买改变了本地存档`);
          }

          const beforeRecovery = (await savedRun(page)).state;
          const recovery = page.locator('.shop-item.service-recovery [data-action="buy"][data-id="recovery"]');
          await recovery.click();
          const afterRecovery = (await savedRun(page)).state;
          assert.deepEqual(afterRecovery.talents, beforeRecovery.talents,
            '坊市恢复服务不能改变任何功法的天赋树');
          assert.equal(afterRecovery.n, beforeRecovery.n);
          assert.equal(afterRecovery.xp, beforeRecovery.xp);
          assert.equal(afterRecovery.shop.find(entry => entry.id === 'talent_reset')?.sold, false);

          const beforeConfirm = (await savedRun(page)).state;
          const coinsBefore = beforeConfirm.coins;
          await clickAction(page, 'buy',
            '.shop-item.service-talent_reset [data-action="buy"][data-id="talent_reset"]');
          await clickAction(page, 'confirm-talent-reset',
            '.talent-reset-dialog [data-action="confirm-talent-reset"]');
          await waitForPhase(page, 'talent');
          const reset = (await savedRun(page)).state;
          assert.equal(reset.coins, coinsBefore - 40, '确认购买应且仅应扣除 40 灵石');
          assert.equal(reset.shop.find(entry => entry.id === 'talent_reset')?.sold, true);
          assert.deepEqual(reset.talents[item.fixture.methodId], [],
            '确认后只清空当前功法天赋');
          assert.deepEqual(reset.talents[item.fixture.otherMethodId],
            beforeConfirm.talents[item.fixture.otherMethodId],
            '洗髓不能清除其他功法的天赋');
          for (const field of ['n', 'xp', 'hp', 'preparation', 'firstStrike', 'history', 'nodeEntry']) {
            assert.deepEqual(reset[field], beforeConfirm[field],
              `洗髓前后 ${field} 不应改变`);
          }
          assert.deepEqual(reset._talentQueue.map(entry => [entry.method, entry.tier, entry.advance]),
            Array.from({ length: beforeConfirm.n }, (_value, index) =>
              [beforeConfirm.method, index + 1, false]),
            '确认后应按 1..n 层顺序重新选择');
          assert.equal(reset._returnPhase, 'shop');
          await assertCurrentChoices(page, { tier: 1, expectedN: beforeConfirm.n });

          const firstChoice = page.locator('.game-page.phase-talent [data-action="talent"]').last();
          const firstChoiceId = await firstChoice.getAttribute('data-id');
          await firstChoice.click();
          await waitForPhase(page, 'talent');
          let partial = (await savedRun(page)).state;
          assert.deepEqual(partial.talents[item.fixture.methodId], [firstChoiceId]);
          assert.equal(partial.coins, coinsBefore - 40, '重选阶段再次存档不能重复扣款');
          assert.equal(partial.n, beforeConfirm.n);
          assert.equal(partial.xp, beforeConfirm.xp);
          assert.equal(partial._talentQueue.length, beforeConfirm.n - 1);
          await assertCurrentChoices(page, { tier: 2, expectedN: beforeConfirm.n });

          const treeBefore = await storageSnapshot(page);
          await openTalentTree(page);
          const partialTree = await assertReadOnlyTree(page, item.fixture, {
            selectedCount: 1,
            candidateTier: 2,
            expectedSelectedIds: [firstChoiceId],
          });
          assert.deepEqual(await storageSnapshot(page), treeBefore,
            '重选中的只读树不能推进当前候选或写存档');
          await page.locator('.talent-tree-dialog .talent-tree-node[data-choice="current"]').first().click();
          await page.locator('.talent-dialog').waitFor({ state: 'visible' });
          await page.keyboard.press('Escape');
          await page.locator('.talent-tree-dialog').waitFor({ state: 'visible' });
          await page.keyboard.press('Escape');
          await page.locator('.talent-tree-dialog').waitFor({ state: 'detached' });
          assert.deepEqual(await storageSnapshot(page), treeBefore);

          await page.reload({ waitUntil: 'networkidle' });
          await waitForPhase(page, 'talent');
          partial = (await savedRun(page)).state;
          assert.deepEqual(partial.talents[item.fixture.methodId], [firstChoiceId],
            '中途重载应保留已经重选的第一层');
          assert.equal(partial.coins, coinsBefore - 40,
            '中途重载不能重复扣除洗髓丹费用');
          assert.equal(partial._talentQueue.length, beforeConfirm.n - 1);
          await assertCurrentChoices(page, { tier: 2, expectedN: beforeConfirm.n });
          while ((await savedRun(page)).state.phase === 'talent') {
            await clickAction(page, 'talent',
              '.game-page.phase-talent [data-action="talent"]');
          }
          await waitForPhase(page, 'shop');
          const finished = (await savedRun(page)).state;
          assert.equal(finished.coins, coinsBefore - 40,
            '完成重选仍只能扣除一次费用');
          assert.equal(finished.shop.find(entry => entry.id === 'talent_reset')?.sold, true);
          assert.equal(finished.n, beforeConfirm.n);
          assert.equal(finished.xp, beforeConfirm.xp);
          assert.equal(finished.hp, beforeConfirm.hp);
          assert.equal(finished.preparation, beforeConfirm.preparation);
          assert.equal(finished.firstStrike, beforeConfirm.firstStrike);
          assert.deepEqual(finished.history, beforeConfirm.history);
          assert.deepEqual(finished.nodeEntry, beforeConfirm.nodeEntry);
          assert.deepEqual(finished.talents[item.fixture.otherMethodId],
            beforeConfirm.talents[item.fixture.otherMethodId]);
          assert.deepEqual(finished.talents[item.fixture.methodId].map(id =>
            method(item.fixture.methodId).talents.find(talent => talent.id === id).tier).sort(),
          Array.from({ length: beforeConfirm.n }, (_value, index) => index + 1));
          assert.equal(finished._talentQueue.length, 0);
          assert.equal(finished._returnPhase, undefined);
          assert.equal(finished.nodes[finished.step].type, 'S');
          assert.equal(finished.nodes[finished.step].completed, false,
            '完成重选不能结算或离开原坊市节点');
          await noOverflow(page, item.width, 'respec-choice-flow');
          return { selectedAfterReload: partial.talents[item.fixture.methodId], partialTree };
        });
      } else if (item.width === 390) {
        await check('四层洗髓顺序、候选状态和原坊市返回', async () => {
          const coinsBefore = (await savedRun(page)).state.coins;
          await clickAction(page, 'buy',
            '.shop-item.service-talent_reset [data-action="buy"][data-id="talent_reset"]');
          await clickAction(page, 'confirm-talent-reset',
            '.talent-reset-dialog [data-action="confirm-talent-reset"]');
          await waitForPhase(page, 'talent');
          const before = (await savedRun(page)).state;
          assert.equal(before.coins, coinsBefore - 40);
          await assertCurrentChoices(page, { tier: 1, expectedN: 4 });
          for (let tier = 1; tier <= 4; tier += 1) {
            const choice = page.locator('.game-page.phase-talent [data-action="talent"]').nth(tier % 3);
            await choice.click();
            const current = await savedRun(page);
            assert.equal(current.state.n, 4);
            assert.equal(current.state.coins, coinsBefore - 40);
            if (tier < 4) {
              await assertCurrentChoices(page, { tier: tier + 1, expectedN: 4 });
            }
          }
          await waitForPhase(page, 'shop');
          const finished = (await savedRun(page)).state;
          assert.equal(finished.coins, coinsBefore - 40);
          assert.equal(finished.shop.find(entry => entry.id === 'talent_reset')?.sold, true);
          assert.equal(finished.n, 4);
          assert.equal(finished.nodes[finished.step].type, 'S');
          assert.equal(finished.nodes[finished.step].completed, false);
          return { chosenTiers: finished.talents[item.fixture.methodId].map(id =>
            method(item.fixture.methodId).talents.find(talent => talent.id === id).tier).sort() };
        });
      } else {
        await check('一层洗髓可确认并立即返回原坊市', async () => {
          const coinsBefore = (await savedRun(page)).state.coins;
          await clickAction(page, 'buy',
            '.shop-item.service-talent_reset [data-action="buy"][data-id="talent_reset"]');
          await clickAction(page, 'confirm-talent-reset',
            '.talent-reset-dialog [data-action="confirm-talent-reset"]');
          await waitForPhase(page, 'talent');
          await assertCurrentChoices(page, { tier: 1, expectedN: 1 });
          await clickAction(page, 'talent',
            '.game-page.phase-talent [data-action="talent"]');
          await waitForPhase(page, 'shop');
          const finished = (await savedRun(page)).state;
          assert.equal(finished.coins, coinsBefore - 40);
          assert.equal(finished.talents[item.fixture.methodId].length, 1);
          assert.equal(finished.n, 1);
          assert.equal(finished.shop.find(entry => entry.id === 'talent_reset')?.sold, true);
          assert.equal(finished.nodes[finished.step].type, 'S');
          assert.equal(finished.nodes[finished.step].completed, false);
          await noOverflow(page, item.width, 'one-tier-return');
          return { selected: finished.talents[item.fixture.methodId] };
        });
      }
      await context.close();
    }

    const markupContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    const artifactPage = await markupContext.newPage();
    artifactPage.setDefaultTimeout(15000);
    artifactPage.on('pageerror', error => pageErrors.push({
      viewport: '390x844-artifact-text',
      type: 'pageerror',
      error: error.message,
    }));
    const artifactFixture = shopFixtures[0];
    const maliciousMarkup = await installMarkupFixture(artifactPage, artifactFixture, {
      contentKind: 'artifacts',
      entityId: artifactFixture.artifactId,
      phase: 'shop',
      mutate(entity, payload) {
        entity.summary = `${payload} 攻击 +123`;
      },
    });
    await check('法宝说明中的恶意标签按文本显示且数值仍被强调', async () => {
      const storageBefore = await storageSnapshot(artifactPage);
      await clickAction(artifactPage, 'inspect-artifact',
        `.shop-item [data-action="inspect-artifact"][data-id="${artifactFixture.artifactId}"]`);
      const detail = artifactPage.locator('.item-dialog');
      await detail.waitFor({ state: 'visible' });
      const summary = detail.locator('.item-dialog-summary');
      assert.equal((await summary.textContent())?.trim(), `${maliciousMarkup} 攻击 +123`);
      assert.ok((await summary.locator('.text-number').allTextContents())
        .some(value => value.trim() === '+123'),
      '法宝说明中的真实数值应作为独立强调文本');
      assert.equal(await summary.locator('img,script').count(), 0,
        '法宝说明中的标签不能执行或进入 DOM');
      assert.equal(await artifactPage.evaluate(() => window.__shanhaiXss), 0);
      await artifactPage.keyboard.press('Escape');
      await detail.waitFor({ state: 'detached' });
      assert.deepEqual(await storageSnapshot(artifactPage), storageBefore,
        '查看法宝详录不应写入命途存档');
      return { artifactId: artifactFixture.artifactId };
    });

    const eventPage = await markupContext.newPage();
    eventPage.setDefaultTimeout(15000);
    eventPage.on('pageerror', error => pageErrors.push({
      viewport: '390x844-event-cost',
      type: 'pageerror',
      error: error.message,
    }));
    const eventFixture = makeCostEventFixture();
    const eventMarkup = await installMarkupFixture(eventPage, eventFixture, {
      contentKind: 'events',
      entityId: eventFixture.eventId,
      phase: 'event',
      mutate(entity, payload) {
        const option = entity.options.find(candidate => candidate.id === eventFixture.optionId);
        assert.ok(option);
        option.label = `${payload} 灵石 36`;
      },
    });
    await check('事件花费中的恶意标签按文本显示且数字强调保留', async () => {
      const option = eventPage.locator(
        `.game-page.phase-event [data-action="event"][data-id="${eventFixture.optionId}"]`,
      );
      await option.waitFor({ state: 'visible' });
      assert.ok((await option.locator('.event-costs .text-number').count()) > 0,
        '事件资源花费应将数值单独强调');
      assert.ok((await option.locator('.event-option-main b').textContent())?.includes(eventMarkup));
      assert.equal(await option.locator('img,script').count(), 0,
        '事件标签不能执行或进入 DOM');
      assert.equal(await eventPage.evaluate(() => window.__shanhaiXss), 0);
      await noOverflow(eventPage, 390, 'event-cost-markup');
      return { eventId: eventFixture.eventId, optionId: eventFixture.optionId };
    });
    await markupContext.close();

    const battleContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    const battlePage = await battleContext.newPage();
    battlePage.setDefaultTimeout(15000);
    battlePage.on('pageerror', error => pageErrors.push({
      viewport: '390x844-active-battle',
      type: 'pageerror',
      error: error.message,
    }));
    await installBattleFixture(battlePage, battleFixture);
    await check('战斗中只读天赋树不推进回放且保留原暂停/播放状态', async () => {
      const arena = battlePage.locator('.combat-arena');
      const pauseButton = battlePage.locator('.battle-shell [data-action="battle-pause"]');
      assert.equal(await pauseButton.getAttribute('aria-pressed'), 'true',
        '战斗 fixture 首次加载应由真实暂停控制暂停');
      const pausedCursor = await arena.getAttribute('data-frame-index');
      await openTalentTree(battlePage);
      await assertReadOnlyTree(battlePage, { methodId: 'RKF03' }, { selectedCount: 4 });
      await battlePage.waitForTimeout(300);
      assert.equal(await arena.getAttribute('data-frame-index'), pausedCursor,
        '暂停战斗打开树期间回放游标发生变化');
      const pausedTreeNode = battlePage.locator('.talent-tree-dialog .talent-tree-node').nth(4);
      await pausedTreeNode.click();
      await battlePage.locator('.talent-dialog').waitFor({ state: 'visible' });
      await battlePage.keyboard.press('Escape');
      await battlePage.locator('.talent-tree-dialog').waitFor({ state: 'visible' });
      assert.equal(await battlePage.evaluate(() => document.activeElement?.getAttribute('data-talent-id')),
        await pausedTreeNode.getAttribute('data-talent-id'),
        '战斗中的天赋详录返回树后焦点应复原');
      await battlePage.keyboard.press('Escape');
      await battlePage.locator('.talent-tree-dialog').waitFor({ state: 'detached' });
      assert.equal(await pauseButton.getAttribute('aria-pressed'), 'true',
        '关闭只读树不能取消玩家原本的暂停状态');
      assert.equal(await battlePage.locator('.battle-shell').getAttribute('data-paused'), 'true');

      await pauseButton.click();
      await battlePage.locator('.battle-shell[data-paused="false"]').waitFor();
      assert.equal(await pauseButton.getAttribute('aria-pressed'), 'false');
      await openTalentTree(battlePage);
      const playingCursor = await arena.getAttribute('data-frame-index');
      assert.equal(await battlePage.locator('.battle-shell').getAttribute('data-paused'), 'true',
        '打开弹窗时应冻结正在播放的战斗');
      assert.equal(await pauseButton.getAttribute('aria-pressed'), 'false',
        '弹窗冻结不能伪造玩家暂停开关状态');
      await battlePage.waitForTimeout(300);
      assert.equal(await arena.getAttribute('data-frame-index'), playingCursor,
        '弹窗打开时正在播放的回放游标仍在前进');
      const playingTreeNode = battlePage.locator('.talent-tree-dialog .talent-tree-node').nth(7);
      await playingTreeNode.click();
      await battlePage.locator('.talent-dialog').waitFor({ state: 'visible' });
      await clickAction(battlePage, 'modal-close',
        '.talent-dialog [data-action="modal-close"]');
      await battlePage.locator('.talent-tree-dialog').waitFor({ state: 'visible' });
      assert.equal(await battlePage.evaluate(() => document.activeElement?.getAttribute('data-talent-id')),
        await playingTreeNode.getAttribute('data-talent-id'));
      await clickAction(battlePage, 'modal-close',
        '.talent-tree-dialog [data-action="modal-close"][data-autofocus]');
      await battlePage.locator('.talent-tree-dialog').waitFor({ state: 'detached' });
      assert.equal(await pauseButton.getAttribute('aria-pressed'), 'false',
        '关闭只读树后应恢复此前的播放状态');
      assert.equal(await battlePage.locator('.battle-shell').getAttribute('data-paused'), 'false');
      await noOverflow(battlePage, 390, 'active-battle-tree');
      return { pausedCursor, playingCursor };
    });
    await battleContext.close();
    await check('浏览器页面无新增运行时错误', async () => {
      assert.deepEqual(pageErrors, [], JSON.stringify(pageErrors));
      return { pageErrors: pageErrors.length };
    });
  } finally {
    await browser.close();
  }
}

try {
  await run();
} catch (error) {
  failures.push(error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { message: String(error) });
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeReport();
}
