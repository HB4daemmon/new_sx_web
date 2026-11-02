import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const replayKey = 'suishi-shanhai-replay-v2-overhaul';
const viewports = [360, 390, 430, 1440];
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
      // Keep looking through the configured local browser harness caches.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

const { chromium } = playwrightModule();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';

async function installRealBattleFixture(page) {
  return page.evaluate(async ({ saveKey, replayKey }) => {
    const [contentApi, run, combat, persistence, playback, impact] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
      import('/shanhai/battle-playback.js'),
      import('/shanhai/battle-impact.js'),
    ]);
    const content = await contentApi.loadContent('/content/');
    const rules = content.entities.find(entity => entity.id === 'RULES');
    const thunder = content.entities.find(entity => entity.id === 'RKF07');
    if (!rules || !thunder) throw new Error('真实战斗 fixture 缺少共用规则或奔雷诀');

    // Use the real engine with a controlled authored input: three non-random
    // rage segments meet a real RC11 opening shield, producing snapshot deltas.
    rules.rage.opening = 100;
    thunder.actions.rage.effects.find(effect => effect.id === 'RKF07-RAGE-DAMAGE')
      .params.segments = 3;
    thunder.actions.rage.effects.find(effect => effect.id === 'RKF07-RAGE-CHAIN')
      .params.chance = 0;
    run.registerCombatWorker({
      calculateStats: combat.calculateStats,
      simulateBattle: combat.simulateBattle,
    });

    const equipmentIds = ['RL08', 'RC05', 'RC01', 'RC02', 'RC04'];
    let game;
    let node;
    for (let seedIndex = 0; seedIndex < 100; seedIndex += 1) {
      const candidate = run.ShanhaiGame.create(content, {
        seed: `v2-impact-browser-real-engine-${seedIndex}`,
        name: '战斗演出验收行者',
        method: 'RKF01',
      });
      const candidateNode = candidate.availableNodes().find(item =>
        item.type === 'C' && item.id === 'EN-A1-C4');
      if (!candidateNode) continue;
      game = candidate;
      node = candidateNode;
      break;
    }
    if (!game || !node) throw new Error('没有生成带真实铁壁符的普通敌人节点');
    // Model a legal later-run method acquisition: RKF07 is a valid owned
    // method but intentionally is not one of the five new-run choices.
    game.state.method = 'RKF07';
    game.state.ownedMethods = ['RKF07'];
    game.state.talents = { RKF07: [] };
    game.state.artifacts = [
      { id: 'RL08', stacks: 1 },
      { id: 'RC05', stacks: 5 },
      { id: 'RC01', stacks: 5 },
      { id: 'RC02', stacks: 1 },
      { id: 'RC04', stacks: 1 },
    ];
    game.state.equipment.slots = [...equipmentIds];

    game.dispatch({ type: 'enter', id: node.key });
    if (game.state.phase !== 'preview') throw new Error('真实战斗 fixture 没有进入战前预览');
    game.dispatch({ type: 'fight' });
    if (game.state.phase !== 'battle' || !game.state.battle || !game.state.battleInput) {
      throw new Error('真实战斗 fixture 没有生成真实战斗结果');
    }

    const frames = game.state.battle.frames;
    const frozenEquipment = game.state.battleInput.player.artifacts.map(stack => stack.id);
    if (JSON.stringify(frozenEquipment) !== JSON.stringify(equipmentIds)) {
      throw new Error(`真实开战装备顺序不符：${JSON.stringify(frozenEquipment)}`);
    }

    let selected;
    for (let cursor = 0; cursor < frames.length; cursor += 1) {
      const group = playback.combatPresentationGroup(frames, cursor);
      if (!group) continue;
      const rageDamageFrames = [];
      const snapshotHits = [];
      for (let index = group.startIndex; index <= cursor; index += 1) {
        const frame = frames[index];
        if (frame.kind === 'damage' && frame.actor === 'player' && frame.target === 'enemy' &&
            frame.source === 'RKF07-RAGE-DAMAGE') rageDamageFrames.push(index);
        if (!['damage', 'dot'].includes(frame.kind) || frame.actor !== 'player' ||
            frame.target !== 'enemy' || index === 0) continue;
        const previous = frames[index - 1];
        const hpDamage = Math.max(0, previous.enemy.hp - frame.enemy.hp);
        const shieldAbsorbed = Math.max(0, previous.enemy.shield - frame.enemy.shield);
        if (hpDamage > 0 || shieldAbsorbed > 0) {
          snapshotHits.push({ frameIndex: index, hpDamage, shieldAbsorbed, source: frame.source || '' });
        }
      }
      const triggers = impact.battleBeatEquipmentTriggers(frames, cursor, equipmentIds, group);
      const triggerIds = triggers.map(trigger => trigger.id);
      if (rageDamageFrames.length === 3 && triggerIds.includes('RC05') && triggerIds.includes('RL08') &&
          snapshotHits.some(hit => hit.shieldAbsorbed > 0 && hit.hpDamage === 0) &&
          snapshotHits.some(hit => hit.shieldAbsorbed > 0 && hit.hpDamage > 0) &&
          snapshotHits.some(hit => hit.hpDamage > 0)) {
        selected = { cursor, group, rageDamageFrames, snapshotHits, triggers };
        break;
      }
    }
    if (!selected) {
      throw new Error('真实引擎未产生三段奔雷伤害、铁壁符吸收及养气玉邻镜觉醒来源同拍的验收帧');
    }

    const record = persistence.saveRun(game);
    record.state.battle.frames = frames;
    delete record.replay;
    persistence.parseRunSave(content, JSON.stringify(record));
    localStorage.setItem(saveKey, JSON.stringify(record));
    const battleKey = [game.state.id, game.state.act, game.state.step, frames.length].join(':');
    localStorage.setItem(replayKey, JSON.stringify({ key: battleKey, cursor: selected.cursor }));

    return {
      cursor: selected.cursor,
      groupStart: selected.group.startIndex,
      frameCount: frames.length,
      equipmentIds,
      battleInputEquipmentIds: frozenEquipment,
      rageDamageFrames: selected.rageDamageFrames,
      snapshotHits: selected.snapshotHits,
      triggers: selected.triggers.map(({ id, frameIndex, source }) => ({ id, frameIndex, source })),
    };
  }, { saveKey, replayKey });
}

async function loadFixture(browser, reducedMotion) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  // Hold replay on its actual, deterministic engine snapshot while CSS
  // animation behavior and responsive layouts are inspected.
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
  });
  const fixture = await installRealBattleFixture(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('.game-page, .landing-page'));
  await page.waitForFunction(() => {
    const game = document.querySelector('.game-page');
    return (game && !game.classList.contains('phase-loading')) || document.querySelector('.landing-page');
  });
  const restored = await page.evaluate(() => ({
    gameClass: document.querySelector('.game-page')?.className,
    frameIndex: document.querySelector('.combat-arena')?.getAttribute('data-frame-index'),
    hasBoard: Boolean(document.querySelector('.battle-relic-board')),
    text: document.body.innerText.slice(0, 1_000),
  }));
  if (!restored.hasBoard) {
    throw new Error(`真实战斗存档未恢复为战斗页面：${JSON.stringify({ restored, fixture, pageErrors })}`);
  }
  await page.waitForFunction(cursor =>
    document.querySelector('.combat-arena')?.getAttribute('data-frame-index') === String(cursor),
  fixture.cursor);
  return { context, page, fixture };
}

function displayAmount(value) {
  if (Number.isInteger(value)) return String(value);
  return value > 0 && value < 1 ? value.toFixed(1) : value.toFixed(0);
}

function expectedVisibleHits(fixture) {
  return fixture.snapshotHits.map(hit => {
    const hp = hit.hpDamage > 0 ? `-${displayAmount(hit.hpDamage)}` : '';
    const shield = hit.shieldAbsorbed > 0 ? `盾-${displayAmount(hit.shieldAbsorbed)}` : '';
    return {
      frameIndex: hit.frameIndex,
      primary: hp || shield,
      secondary: hp && shield ? shield : '',
    };
  });
}

async function readBattlePresentation(page) {
  return page.evaluate(() => {
    const board = document.querySelector('.battle-relic-board');
    const hits = [...document.querySelectorAll('.combat-hit-cascade.target-e .combat-hit-number')];
    const boardRect = board?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      boardWidth: board?.clientWidth ?? 0,
      boardScrollWidth: board?.scrollWidth ?? 0,
      boardLeft: boardRect?.left ?? 0,
      boardRight: boardRect?.right ?? 0,
      slots: [...(board?.querySelectorAll('.battle-relic-slot') ?? [])].map(slot => {
        const rect = slot.getBoundingClientRect();
        return {
          id: slot.getAttribute('data-relic-id'),
          active: slot.getAttribute('data-active') === 'true',
          awakened: slot.getAttribute('data-awakened'),
          mirrorNext: slot.getAttribute('data-mirror-next') === 'true',
          label: slot.getAttribute('aria-label'),
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      }),
      hits: hits.map(element => ({
        frameIndex: Number(element.getAttribute('data-hit-frame')),
        primary: element.querySelector('b')?.textContent?.trim() || '',
        secondary: element.querySelector('small')?.textContent?.trim() || '',
      })),
      hitStyles: hits.map(element => {
        const style = getComputedStyle(element);
        return { animationName: style.animationName, animationPlayState: style.animationPlayState, opacity: style.opacity };
      }),
      frameIndex: document.querySelector('.combat-arena')?.getAttribute('data-frame-index'),
      paused: document.querySelector('.battle-shell')?.getAttribute('data-paused'),
    };
  });
}

async function assertResponsiveImpactPresentation(page, fixture, width, reducedMotion) {
  await page.setViewportSize({ width, height: 900 });
  const layout = await readBattlePresentation(page);
  assert.equal(layout.viewport, width);
  assert.ok(layout.documentWidth <= width + 1 && layout.bodyWidth <= width + 1,
    `${width}px 页面横向溢出：${JSON.stringify(layout)}`);
  assert.ok(layout.boardWidth > 0 && layout.boardScrollWidth <= layout.boardWidth + 1,
    `${width}px 战斗阵盘横向溢出：${JSON.stringify(layout)}`);
  assert.ok(layout.boardLeft >= -1 && layout.boardRight <= width + 1,
    `${width}px 战斗阵盘越出视口：${JSON.stringify(layout)}`);
  assert.equal(layout.slots.length, 5, `${width}px 战斗阵盘应显示五格`);
  assert.deepEqual(layout.slots.map(slot => slot.id), fixture.battleInputEquipmentIds,
    `${width}px 阵盘顺序应与真实开战快照一致`);
  assert.deepEqual(layout.slots.map(slot => slot.mirrorNext), [true, false, false, false, false],
    `${width}px 昆仑镜仅应连接实际紧邻的右侧器物`);
  assert.match(layout.slots[0].label, /镜映右侧养气玉/);
  assert.ok(layout.slots.every(slot => slot.width > 0 && slot.left >= layout.boardLeft - 1 &&
    slot.right <= layout.boardRight + 1), `${width}px 阵盘槽位超出阵盘：${JSON.stringify(layout.slots)}`);

  const expectedActiveIds = fixture.battleInputEquipmentIds.filter(id =>
    fixture.triggers.some(trigger => trigger.id === id));
  const activeIds = layout.slots.filter(slot => slot.active).map(slot => slot.id);
  assert.deepEqual(activeIds, expectedActiveIds,
    `${width}px 只有当前真实来源应在阵盘点亮：${JSON.stringify({ activeIds, expectedActiveIds })}`);
  assert.ok(fixture.triggers.every(trigger => {
    const sourceId = trigger.source.startsWith('RL08-MIRROR-')
      ? 'RL08' : trigger.source.match(/^(RC\d{2}|RR\d{2}|RL\d{2})/)?.[1];
    return fixture.equipmentIds.includes(trigger.id) && sourceId === trigger.id &&
      trigger.frameIndex >= fixture.groupStart && trigger.frameIndex <= fixture.cursor;
  }), '点亮来源必须能追溯到当前拍的真实装备来源帧');
  assert.ok(fixture.rageDamageFrames.length === 3 && fixture.rageDamageFrames.every(index =>
    index >= fixture.groupStart && index <= fixture.cursor), '当前拍应包含真实奔雷三段伤害');

  assert.deepEqual(layout.hits, expectedVisibleHits(fixture),
    `${width}px 飘出的多段数字必须对应相邻真实战斗快照的气血损失与护盾吸收`);
  assert.ok(layout.hits.length >= 3, `${width}px 应显示实际的多段伤害数字`);
  if (reducedMotion) {
    assert.ok(layout.hitStyles.every(style => style.animationName === 'none' && style.opacity === '1'),
      `${width}px 减少动态效果应禁用伤害数字动画并保持数字可见：${JSON.stringify(layout.hitStyles)}`);
  }
}

async function assertPauseFreezesImpactMotion(page) {
  const before = await readBattlePresentation(page);
  assert.equal(before.paused, 'false', '战斗 fixture 初始应处于播放态');
  assert.ok(before.slots.some(slot => slot.active), '暂停前应有真实法宝来源点亮');
  const running = await page.evaluate(() => {
    const slot = document.querySelector('.battle-relic-slot[data-active="true"]');
    const hit = document.querySelector('.combat-hit-number');
    return {
      slotAnimation: slot ? getComputedStyle(slot).animationName : 'none',
      slotPlayState: slot ? getComputedStyle(slot).animationPlayState : 'none',
      hitAnimation: hit ? getComputedStyle(hit).animationName : 'none',
      hitPlayState: hit ? getComputedStyle(hit).animationPlayState : 'none',
    };
  });
  assert.notEqual(running.slotAnimation, 'none', '点亮法宝应有对应脉冲动画');
  assert.equal(running.slotPlayState, 'running');
  assert.notEqual(running.hitAnimation, 'none', '多段伤害数字应有对应动画');
  assert.equal(running.hitPlayState, 'running');

  await page.locator('[data-action="battle-pause"]').click();
  const paused = await page.evaluate(() => {
    const slot = document.querySelector('.battle-relic-slot[data-active="true"]');
    const hit = document.querySelector('.combat-hit-number');
    return {
      frameIndex: document.querySelector('.combat-arena')?.getAttribute('data-frame-index'),
      shellPaused: document.querySelector('.battle-shell')?.getAttribute('data-paused'),
      slotPlayState: slot ? getComputedStyle(slot).animationPlayState : 'none',
      hitPlayState: hit ? getComputedStyle(hit).animationPlayState : 'none',
      slotTime: slot?.getAnimations()[0]?.currentTime ?? null,
      hitTime: hit?.getAnimations()[0]?.currentTime ?? null,
    };
  });
  assert.equal(paused.shellPaused, 'true', '暂停按钮应切换真实战斗暂停状态');
  assert.equal(paused.slotPlayState, 'paused', '暂停后法宝点亮动画应停住');
  assert.equal(paused.hitPlayState, 'paused', '暂停后多段伤害数字动画应停住');
  await new Promise(resolve => setTimeout(resolve, 120));
  const stillPaused = await page.evaluate(() => ({
    frameIndex: document.querySelector('.combat-arena')?.getAttribute('data-frame-index'),
    slotTime: document.querySelector('.battle-relic-slot[data-active="true"]')
      ?.getAnimations()[0]?.currentTime ?? null,
    hitTime: document.querySelector('.combat-hit-number')?.getAnimations()[0]?.currentTime ?? null,
  }));
  assert.equal(stillPaused.frameIndex, paused.frameIndex, '暂停期间战斗帧不得推进');
  assert.equal(stillPaused.slotTime, paused.slotTime, '暂停期间法宝动画时间不得推进');
  assert.equal(stillPaused.hitTime, paused.hitTime, '暂停期间伤害数字动画时间不得推进');
}

async function assertReducedMotion(page) {
  const motion = await page.evaluate(() => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    slots: [...document.querySelectorAll('.battle-relic-slot[data-active="true"]')].map(element => {
      const style = getComputedStyle(element);
      return { animationName: style.animationName, animationPlayState: style.animationPlayState };
    }),
    hits: [...document.querySelectorAll('.combat-hit-number')].map(element => {
      const style = getComputedStyle(element);
      return { animationName: style.animationName, opacity: style.opacity };
    }),
  }));
  assert.equal(motion.matches, true, '浏览器减少动态效果偏好应生效');
  assert.ok(motion.slots.length > 0 && motion.slots.every(style => style.animationName === 'none'),
    `减少动态效果应禁用法宝点亮动画：${JSON.stringify(motion.slots)}`);
  assert.ok(motion.hits.length >= 3 && motion.hits.every(style =>
    style.animationName === 'none' && style.opacity === '1'),
  `减少动态效果应禁用多段伤害动画并显示全部数字：${JSON.stringify(motion.hits)}`);
}

async function assertFirstContributionSeal(page) {
  const initial = await page.evaluate(({ saveKey, replayKey }) => ({
    save: localStorage.getItem(saveKey),
    replay: localStorage.getItem(replayKey),
  }), { saveKey, replayKey });
  assert.ok(initial.save && initial.replay);

  async function showRanking(entries) {
    await page.evaluate(({ saveKey, replayKey, initial, entries }) => {
      const save = JSON.parse(initial.save);
      // Exercise the ranking independently of this battle's particular build.
      // The synthetic ledger changes no engine or persisted game rules.
      save.state.battle.contributions = entries.map(([id, damage]) => ({
        id, name: id, damage, triggers: 1, healing: 0, shield: 0, absorbed: 0, rage: 0,
      }));
      localStorage.setItem(saveKey, JSON.stringify(save));
      localStorage.setItem(replayKey, initial.replay);
    }, { saveKey, replayKey, initial, entries });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-action="battle-skip"]').click();
    await page.locator('.battle-damage-ranking').waitFor({ state: 'visible' });
  }

  await showRanking([['RC01', 45], ['RC02', 42], ['RKF07', 13]]);
  const seals = page.locator('.battle-first-contribution-seal');
  assert.equal(await seals.count(), 1, '两件法宝均超过 40% 时首功只能盖给第一名');
  assert.match(await seals.first().getAttribute('aria-label'), /青锋石/, '首功应属于实际伤害第一的法宝');

  await showRanking([['RKF07', 50], ['RC01', 45], ['RC02', 5]]);
  assert.equal(await seals.count(), 0, '功法是第一名时不得把次名法宝误标为首功');
}

async function assertAwakeningMarkers(page) {
  for (const [frontId, frontStacks, expectedFront] of [
    ['RC09', 2, null],
    ['RC05', 4, 'front'],
  ]) {
    await page.evaluate(async ({ saveKey, replayKey, frontId, frontStacks }) => {
      const [{ loadContent }, run, combat, persistence] = await Promise.all([
        import('/shanhai/content.js'), import('/shanhai/run.js'),
        import('/shanhai/combat.js'), import('/shanhai/persistence.js'),
      ]);
      const content = await loadContent('/content/');
      run.registerCombatWorker({ calculateStats: combat.calculateStats, simulateBattle: combat.simulateBattle });
      const game = run.ShanhaiGame.create(content, {
        seed: 'v2-awakening-marker', name: '醒印验收', method: 'RKF01',
      });
      game.state.artifacts = [
        { id: frontId, stacks: frontStacks }, { id: 'RC11', stacks: 3 }, { id: 'RC01', stacks: 5 },
        { id: 'RC14', stacks: 1 },
      ];
      game.state.equipment.slots = [frontId, 'RC11'];
      const node = game.availableNodes().find(item => ['C', 'L', 'B'].includes(item.type));
      if (!node) throw new Error('醒印验收没有战斗节点');
      game.dispatch({ type: 'enter', id: node.key });
      game.dispatch({ type: 'fight' });
      const record = persistence.saveRun(game);
      persistence.parseRunSave(content, JSON.stringify(record));
      localStorage.setItem(saveKey, JSON.stringify(record));
      localStorage.removeItem(replayKey);
    }, { saveKey, replayKey, frontId, frontStacks });
    await page.reload({ waitUntil: 'networkidle' });
    const slots = page.locator('.battle-relic-slot');
    await slots.first().waitFor({ state: 'visible' });
    assert.equal(await slots.nth(0).getAttribute('data-awakened'), expectedFront,
      '阵首提前醒印须遵循该觉醒的真实判定规则');
    assert.equal(await slots.nth(1).getAttribute('data-awakened'), 'full',
      '以满层门槛效果实现觉醒的铁壁符，也应显示真实满层醒印');
    if (frontId === 'RC05') {
      await page.locator('.bottom-nav [data-action="tab"][data-id="build"]').click();
      const unequipped = page.locator('.ability-card[data-id="RC01"]');
      assert.equal(await unequipped.getAttribute('data-awakened'), 'full',
        '满层器物即使未装备，背包中也应标明真实满层');
      assert.equal(await unequipped.getAttribute('data-core'), 'true');
      assert.match(await unequipped.innerText(), /未装备不生效/,
        '未装备满层法宝不能暗示已在战斗中生效');
      await page.locator('[data-action="build-filter"][data-filter="all"]').click();
      const fusion = page.locator('.ability-card[data-id="RL06"]');
      assert.equal(await fusion.getAttribute('data-fusion'), 'true');
      const style = await fusion.evaluate(element => ({
        background: getComputedStyle(element).backgroundImage,
        borderStyle: getComputedStyle(element).borderTopStyle,
      }));
      assert.match(style.background, /gradient/, '合炼器物在命盘中也应使用独立卡面');
      assert.equal(style.borderStyle, 'solid');
    }
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  try {
    const normal = await loadFixture(browser, 'no-preference');
    try {
      assert.equal(normal.fixture.battleInputEquipmentIds.length, 5);
      assert.equal(normal.fixture.rageDamageFrames.length, 3,
        '真实引擎应按验收输入产生三段奔雷怒技');
      assert.ok(normal.fixture.snapshotHits.some(hit => hit.shieldAbsorbed > 0 && hit.hpDamage === 0));
      assert.ok(normal.fixture.snapshotHits.some(hit => hit.shieldAbsorbed > 0 && hit.hpDamage > 0));
      assert.ok(normal.fixture.triggers.some(trigger => trigger.id === 'RC05') &&
        normal.fixture.triggers.some(trigger => trigger.id === 'RL08'),
      '真实怒技应触发养气玉觉醒及昆仑镜镜映来源');
      await assertPauseFreezesImpactMotion(normal.page);
      await assertFirstContributionSeal(normal.page);
      await assertAwakeningMarkers(normal.page);
    } finally {
      await normal.context.close();
    }

    const reduced = await loadFixture(browser, 'reduce');
    try {
      await assertReducedMotion(reduced.page);
      for (const width of viewports) {
        await assertResponsiveImpactPresentation(reduced.page, reduced.fixture, width, true);
      }
      assert.equal(reduced.fixture.cursor >= 0 && reduced.fixture.cursor < reduced.fixture.frameCount, true);
    } finally {
      await reduced.context.close();
    }
    assert.deepEqual(pageErrors, [], `浏览器运行时报错：${pageErrors.join(' | ')}`);
    console.log('ok - V2 真实多段伤害与护盾吸收、五格装备来源、暂停及减少动态效果响应式检查');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
