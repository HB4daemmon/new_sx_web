import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';

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
      // Keep looking through the configured local browser caches.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

const { chromium } = playwrightModule();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const errors = [];

async function installBattleFixture(page) {
  return page.evaluate(async () => {
    const [{ loadContent }, { ShanhaiGame, registerCombatWorker }, { calculateStats }, { saveRun, parseRunSave, loadRun }] =
      await Promise.all([
        import('/shanhai/content.js'),
        import('/shanhai/run.js'),
        import('/shanhai/combat.js'),
        import('/shanhai/persistence.js'),
      ]);
    const content = await loadContent('/content/');
    const frameSet = { frames: [], contributions: [] };

    registerCombatWorker({
      calculateStats,
      simulateBattle(_content, player, enemy) {
        const playerStats = calculateStats(content, player);
        const enemyStats = calculateStats(content, enemy);
        const playerView = {
          name: player.name,
          method: player.method,
          hp: Math.min(80, player.hp ?? playerStats.max_hp),
          maxHp: playerStats.max_hp,
          shield: 5,
          rage: 10,
          rageCap: 100,
          statuses: {},
        };
        const enemyView = {
          name: enemy.name,
          method: enemy.method,
          hp: enemy.hp ?? enemyStats.max_hp,
          maxHp: enemyStats.max_hp,
          shield: 10,
          rage: 20,
          rageCap: 100,
          statuses: {},
        };
        const frames = [
          { round: 1, kind: 'start', text: '交锋开始', player: playerView, enemy: enemyView },
          {
            round: 1,
            kind: 'action',
            actor: 'player',
            target: 'enemy',
            text: '玩家普攻',
            player: playerView,
            enemy: enemyView,
          },
          {
            round: 1,
            kind: 'reaction',
            actor: 'player',
            target: 'enemy',
            source: 'RKF01-RAGE-CHAIN',
            text: '怒技连斩',
            cue: {
              kind: 'rage_chain',
              owner: 'player',
              sourceId: 'RKF01-RAGE-CHAIN',
              count: 2,
            },
            player: playerView,
            enemy: enemyView,
          },
          {
            round: 1,
            kind: 'damage',
            actor: 'player',
            target: 'enemy',
            text: '造成暴击伤害',
            player: { ...playerView, rage: 13 },
            enemy: {
              ...enemyView,
              hp: enemyView.hp - 5,
              shield: 7,
              statuses: { poison: 1 },
            },
          },
          {
            round: 1,
            kind: 'damage',
            actor: 'player',
            target: 'enemy',
            text: '造成伤害',
            player: { ...playerView, rage: 14 },
            enemy: {
              ...enemyView,
              hp: enemyView.hp - 10,
              shield: 5,
              statuses: { poison: 2 },
            },
          },
          {
            round: 1,
            kind: 'heal',
            actor: 'player',
            target: 'player',
            text: '回复气血',
            player: { ...playerView, hp: playerView.hp + 8, rage: 15 },
            enemy: {
              ...enemyView,
              hp: enemyView.hp - 10,
              shield: 5,
              statuses: { poison: 3, burn: 1 },
            },
          },
          {
            round: 1,
            kind: 'shield',
            actor: 'player',
            target: 'player',
            text: '凝成护盾',
            player: { ...playerView, hp: playerView.hp + 8, shield: 9, rage: 14 },
            enemy: {
              ...enemyView,
              hp: enemyView.hp - 10,
              shield: 7,
              statuses: { poison: 4, burn: 2 },
            },
          },
          {
            round: 1,
            kind: 'action',
            actor: 'enemy',
            target: 'player',
            text: '敌手普攻',
            player: { ...playerView, hp: playerView.hp + 8, shield: 9, rage: 14 },
            enemy: {
              ...enemyView,
              hp: enemyView.hp - 10,
              shield: 7,
              statuses: { poison: 4, burn: 2 },
            },
          },
        ];
        frameSet.frames = frames;
        frameSet.contributions = [
          { id: 'TEST-DAMAGE', name: '含吸收伤害', triggers: 2, damage: 25, healing: 0, shield: 100, absorbed: 5, rage: 0 },
          { id: 'TEST-SECOND', name: '次要伤害', triggers: 1, damage: 10, healing: 0, shield: 50, absorbed: 2, rage: 0 },
          { id: 'TEST-THIRD', name: '第三伤害', triggers: 1, damage: 2, healing: 0, shield: 10, absorbed: 0, rage: 0 },
          { id: 'TEST-SUPPORT', name: '纯治疗护盾', triggers: 4, damage: 0, healing: 900, shield: 500, absorbed: 0, rage: 0 },
        ];
        return {
          outcome: 'player',
          rounds: 1,
          playerHp: playerView.hp + 8,
          enemyHp: enemyView.hp - 10,
          frames,
          contributions: frameSet.contributions,
        };
      },
    });

    localStorage.removeItem('suishi-shanhai-run-v2-overhaul');
    localStorage.removeItem('suishi-shanhai-replay-v2-overhaul');
    const game = ShanhaiGame.create(content, {
      seed: 'v2-feedback-mixed-facts',
      name: '反馈验收行者',
      method: 'RKF01',
    });
    const node = game.availableNodes().find(candidate => ['C', 'L', 'B'].includes(candidate.type));
    if (!node) throw new Error('反馈验收没有可进入的战斗节点');
    game.dispatch({ type: 'enter', id: node.key });
    game.dispatch({ type: 'fight' });
    if (game.state.phase !== 'battle' || !game.state.battle) {
      throw new Error('反馈验收没有进入战斗阶段');
    }
    const record = saveRun(game);
    record.state.battle.frames = game.state.battle.frames;
    delete record.replay;
    try {
      parseRunSave(content, JSON.stringify(record));
    } catch (error) {
      throw new Error(`反馈测试存档未通过校验：${error instanceof Error ? error.message : String(error)}`);
    }
    localStorage.setItem('suishi-shanhai-run-v2-overhaul', JSON.stringify(record));
    const battleKey = [game.state.id, game.state.act, game.state.step, frameSet.frames.length].join(':');
    localStorage.setItem('suishi-shanhai-replay-v2-overhaul', JSON.stringify({ key: battleKey, cursor: 6 }));
    try {
      loadRun(content);
    } catch (error) {
      throw new Error(`反馈测试存档无法恢复：${error instanceof Error ? error.message : String(error)}`);
    }
    return { cursor: 6, frameCount: frameSet.frames.length };
  });
}

async function assertFeedbackAtWidth(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const result = await page.evaluate(() => {
    const arena = document.querySelector('.combat-arena');
    const feedback = [...document.querySelectorAll('.combat-feedback-group')];
    const floats = [...document.querySelectorAll('.combat-float')];
    const details = [...document.querySelectorAll('.combat-float.detail, .combat-float.status-change')];
    const arenaRect = arena?.getBoundingClientRect();
    const layer = document.querySelector('.combat-feedback-layer');
    const layerRect = layer?.getBoundingClientRect();
    const layerStyle = layer ? getComputedStyle(layer) : null;
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      layer: layerRect && layerStyle ? {
        top: layerRect.top,
        height: layerRect.height,
        position: layerStyle.position,
        inset: layerStyle.inset,
        gridRow: layerStyle.gridRow,
        display: layerStyle.display,
      } : null,
      groups: feedback.map(group => {
        const rect = group.getBoundingClientRect();
        const side = group.getAttribute('data-side') === 'player' ? 'player' : 'enemy';
        const headValue = getComputedStyle(arena).getPropertyValue(`--${side}-head-y`);
        const headY = Number.parseFloat(headValue) || 112;
        const groupStyle = getComputedStyle(group);
        return {
          side,
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          arenaLeft: arenaRect?.left ?? 0,
          arenaRight: arenaRect?.right ?? window.innerWidth,
          arenaTop: arenaRect?.top ?? 0,
          headY: (arenaRect?.top ?? 0) + headY,
          headValue,
          groupTop: groupStyle.top,
          groupTransform: groupStyle.transform,
          height: rect.height,
          text: group.innerText,
        };
      }),
      floatCount: floats.length,
      details: details.map(element => ({
        text: element.innerText,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        height: element.getBoundingClientRect().height,
        animationName: getComputedStyle(element).animationName,
        transform: getComputedStyle(element).transform,
        opacity: getComputedStyle(element).opacity,
      })),
    };
  });

  assert.equal(result.width, width);
  assert.ok(result.documentWidth <= width + 1, `${width}px 页面发生横向溢出：${result.documentWidth}`);
  assert.ok(result.bodyWidth <= width + 1, `${width}px 页面内容发生横向溢出：${result.bodyWidth}`);
  assert.equal(result.floatCount, 4, `${width}px 应按双方各最多三条信息聚合显示`);
  assert.equal(result.groups.length, 2);
  for (const group of result.groups) {
    assert.ok(group.left >= group.arenaLeft - 1, `${width}px ${group.side}反馈越过战场左缘`);
    assert.ok(group.right <= group.arenaRight + 1, `${width}px ${group.side}反馈越过战场右缘`);
    assert.ok(group.bottom <= group.headY,
      `${width}px ${group.side}反馈压住了角色头部：${JSON.stringify({ group, layer: result.layer })}`);
  }
  assert.ok(result.details.length >= 3);
  for (const detail of result.details) {
    assert.ok(detail.fontSize >= 14, `${width}px ${detail.text} 字号低于 14px`);
    assert.ok(detail.height > 0, `${width}px ${detail.text} 未显示`);
    assert.equal(detail.animationName, 'none', '减少动态效果下应禁用头顶反馈动画');
    assert.equal(detail.transform, 'none', '减少动态效果下反馈文字不应漂移');
    assert.equal(detail.opacity, '1', '减少动态效果下反馈文字应保持完整可见');
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 1;
      window.cancelAnimationFrame = () => {};
    });
    const fixture = await installBattleFixture(page);
    assert.equal(fixture.cursor, 6);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.game-page, .landing-page').first().waitFor({ state: 'visible' });
    const initialState = await page.evaluate(() => ({
      frameIndex: document.querySelector('.combat-arena')?.getAttribute('data-frame-index') || null,
      phase: document.querySelector('.game-page')?.className || 'landing',
      text: document.body.innerText.slice(0, 900),
    }));
    assert.equal(initialState.frameIndex, '6',
      `战斗回放没有停在多帧检查位置：${JSON.stringify(initialState)}；页面错误：${errors.join(' | ')}`);

    const enemyText = await page.locator('.combat-feedback-group[data-side="enemy"]').innerText();
    const playerText = await page.locator('.combat-feedback-group[data-side="player"]').innerText();
    assert.match(enemyText, /暴击/, '多段伤害聚合后仍应保留暴击提示');
    assert.match(enemyText, /-10/, '多段伤害应显示真实合计气血损失');
    assert.match(enemyText, /2段/, '多段伤害提示不得退化');
    assert.match(enemyText, /护盾吸收 5/, '多帧汇总应显示护盾吸收');
    assert.match(enemyText, /中毒 \+4/, '伤害与护盾同时出现时仍应显示中毒变化');
    assert.match(enemyText, /燃烧 \+2/, '伤害与护盾同时出现时仍应显示燃烧变化');
    const reactionText = await page.locator('.combat-semantic-cue[data-combat-semantic-cue="rage_chain"]').innerText();
    assert.match(reactionText.replace(/\s+/g, ''), /绝技连斩×2/, '聚合时应保留已有的连斩反应提示');
    const reactionAnimation = await page.locator('.combat-semantic-cue[data-combat-semantic-cue="rage_chain"]')
      .evaluate(element => getComputedStyle(element).animationName);
    assert.equal(reactionAnimation, 'none', '减少动态效果下反应提示应保持静止');
    assert.match(playerText, /治疗 \+8/, '应显示多帧治疗');
    assert.match(playerText, /护盾 \+4/, '治疗同时出现时仍应显示护盾增加');
    assert.match(playerText, /怒气 \+5/, '应按真实帧显示怒气增加');
    assert.match(playerText, /怒气 -1/, '应按真实帧显示怒气消耗');

    for (const width of [360, 390, 430, 1440]) await assertFeedbackAtWidth(page, width);

    await page.locator('[data-action="battle-skip"]').click();
    const ranking = page.locator('.battle-damage-ranking');
    await ranking.waitFor({ state: 'visible' });
    const rankingText = await ranking.innerText();
    assert.match(await ranking.getAttribute('aria-label'), /含护盾吸收/);
    assert.match(rankingText, /伤害来源 · 含护盾吸收/);
    assert.match(rankingText, /伤害（含吸收） 25/);
    assert.match(rankingText, /伤害（含吸收） 10/);
    assert.match(rankingText, /伤害（含吸收） 2/);
    assert.doesNotMatch(rankingText, /纯治疗护盾/,
      '伤害榜不得把治疗或提供护盾记作伤害');
    const percentValues = await ranking.locator('.battle-damage-meter').evaluateAll(elements =>
      elements.map(element => Number(element.getAttribute('aria-valuenow'))));
    assert.deepEqual(percentValues, [68, 27, 5],
      '伤害份额只按账本伤害计算，不得再加吸收、治疗或护盾');
    const shields = page.locator('.battle-shield-ranking');
    await shields.locator('summary').click();
    const shieldText = await shields.innerText();
    assert.match(shieldText, /纯治疗护盾/);
    assert.match(shieldText, /护盾 500/);
    assert.match(shieldText, /护盾 100/);
    assert.match(shieldText, /护盾 50/);
    assert.doesNotMatch(shieldText, /900|第三伤害/,
      '护盾榜只展示实际生成的前三项，不混入治疗或第四名');
    const shieldPercentages = await shields.locator('.battle-damage-meter').evaluateAll(elements =>
      elements.map(element => Number(element.getAttribute('aria-valuenow'))));
    assert.deepEqual(shieldPercentages, [76, 15, 8]);
    for (const width of [360, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        page: document.documentElement.scrollWidth,
      }));
      assert.ok(layout.page <= layout.viewport + 1, `护盾榜横向溢出：${JSON.stringify(layout)}`);
    }
    assert.deepEqual(errors, [], `浏览器运行时报错：${errors.join(' | ')}`);
    console.log('ok - V2 多帧战斗反馈、伤害榜与 360/390/430/1440 宽度减少动态效果检查');
    await context.close();
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
