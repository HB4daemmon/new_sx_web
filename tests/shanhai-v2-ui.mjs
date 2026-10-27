import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4178/';

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
const saveKey = 'suishi-shanhai-run-v2-resonance';
const buildKey = 'suishi-shanhai-build-v2-resonance';
const replayKey = 'suishi-shanhai-replay-v2-resonance';
const pageErrors = [];

async function installFixture(page, { phase = 'map', equipment = true, sourceLabels = false, hunter = false } = {}) {
  return await page.evaluate(async ({ phase, equipment, sourceLabels, hunter }) => {
    const [{ loadContent }, { ShanhaiGame, registerCombatWorker }, { calculateStats }, { saveRun }] =
      await Promise.all([
        import('/shanhai/content.js'),
        import('/shanhai/run.js'),
        import('/shanhai/combat.js'),
        import('/shanhai/persistence.js'),
      ]);
    const content = await loadContent('/content/');
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
          rage: 0,
          rageCap: 100,
          statuses: {},
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
        const localTalent = content.byId.RKF01.talents[0];
        const sharedTalent = content.rules.insights.find(talent => talent.tier === 1);
        if (sourceLabels && !content.rules.insights.some(talent => talent.id === 'V2-J3-B')) {
          throw new Error('UI fixture has no rage-echo insight');
        }
        const frames = sourceLabels ? [
          { round: 1, kind: 'start', text: '交锋开始', player: playerView, enemy: enemyView },
          {
            round: 1,
            kind: 'action',
            actor: 'player',
            source: `${localTalent.id}-TEST-EFFECT`,
            text: '普攻',
            player: playerView,
            enemy: enemyView,
          },
          {
            round: 1,
            kind: 'action',
            actor: 'player',
            source: `${sharedTalent.id}-TEST-EFFECT`,
            text: '普攻',
            player: playerView,
            enemy: enemyView,
          },
          {
            round: 1,
            kind: 'damage',
            actor: 'player',
            target: 'enemy',
            source: 'RKF01-RAGE-TEST-RAGE-ECHO',
            text: '身外化身回响',
            amount: 6,
            player: playerView,
            enemy: { ...enemyView, hp: Math.max(0, enemyView.hp - 6) },
          },
        ] : [];
        const contributions = sourceLabels ? [
          { id: 'RC09', name: '剑穗', triggers: 2, damage: 20, healing: 10, shield: 30, rage: 40, absorbed: 0 },
          { id: 'RC12', name: '回春瓶', triggers: 1, damage: 0, healing: 10, shield: 4, rage: 0, absorbed: 0 },
          { id: 'RC01', name: '青锋石', triggers: 1, damage: 100, healing: 0, shield: 0, rage: 0, absorbed: 0 },
          { id: 'RC02', name: '静气石', triggers: 0, damage: 0, healing: 0, shield: 0, rage: 0, absorbed: 0 },
          { id: 'RC03', name: '玄铁甲', triggers: 4, damage: 0, healing: 500, shield: 500, rage: 0, absorbed: 0 },
        ] : [];
        return {
          outcome: 'player',
          rounds: 1,
          playerHp: player.hp ?? 1,
          enemyHp: 0,
          frames,
          contributions,
        };
      },
    });

    const game = ShanhaiGame.create(content, {
      seed: `v2-ui-${phase}-${equipment ? 'equipped' : 'empty'}`,
      name: 'UI验收行者',
      method: 'RKF01',
    });
    if (equipment) {
      game.state.artifacts = [
        { id: 'RC09', stacks: 1 },
        { id: 'RC10', stacks: 1 },
        { id: 'RC12', stacks: 1 },
        { id: 'RC14', stacks: 1 },
        { id: 'RC01', stacks: 1 },
        { id: 'RC02', stacks: 1 },
        { id: 'RC03', stacks: 1 },
      ];
      game.state.equipment = {
        slots: sourceLabels
          ? ['RC09', 'RC12', 'RC02', 'RC01']
          : ['RC09', 'RC01', 'RC02', 'RC03'],
      };
    }
    game.state.hp = Math.max(1, game.stats.max_hp - 23);
    game.state.coins = 80;
    game.state.progress = { coinsSpent: 41, eliteWins: 2, bossWins: 1 };
    if (hunter) {
      game.state.n = 1;
      game.state.xp = content.rules.cultivation.cumulative[0];
      game.state.talents[game.state.method] = ['V2-J1-B'];
    }
    const initialHp = game.state.hp;
    localStorage.setItem('suishi-shanhai-run-v2-journey', 'legacy-v2-run-untouched');
    localStorage.setItem('suishi-shanhai-build-v2-journey', 'legacy-v2-build-untouched');
    localStorage.setItem('suishi-shanhai-replay-v2-journey', 'legacy-v2-replay-untouched');
    localStorage.setItem('suishi-shanhai-replay-v1', 'v1-replay-untouched');
    localStorage.setItem('suishi-shanhai-build-v1', 'v1-build-untouched');

    if (phase === 'preview' || phase === 'reward' || phase === 'battle') {
      const node = game.availableNodes().find(candidate => ['C', 'L', 'B'].includes(candidate.type));
      if (!node) throw new Error('UI fixture has no reachable battle node');
      game.dispatch({ type: 'enter', id: node.key });
      if (phase === 'reward') {
        game.dispatch({ type: 'fight' });
        game.dispatch({ type: 'battle_done' });
        if (game.state.phase !== 'reward') throw new Error('UI fixture did not reach reward');
        if (equipment) game.state.rewardCandidates = ['RC10', 'RR01', 'RC12'];
      } else if (phase === 'battle') {
        game.dispatch({ type: 'fight' });
      }
    } else if (phase === 'talent') {
      game.state.phase = 'talent';
      game.state.xp = Math.max(120, content.rules.cultivation.cumulative[0] ?? 120);
      game.state._talentQueue = [{ method: game.state.method, tier: 1, advance: true }];
      const candidates = game.availableTalents();
      if (!candidates.some(talent => talent.id.startsWith('V2-J1-'))) {
        throw new Error('UI fixture has no shared talent candidate');
      }
    }

    const saved = saveRun(game);
    if (phase === 'battle' && sourceLabels && game.state.battle) {
      saved.state.battle.frames = game.state.battle.frames;
      delete saved.replay;
      localStorage.setItem('suishi-shanhai-run-v2-resonance', JSON.stringify(saved));
    }
    const localTalent = content.byId.RKF01.talents[0];
    const sharedTalent = content.rules.insights.find(talent => talent.tier === 1);
    return {
      hp: initialHp,
      localTalentName: localTalent.name,
      sharedTalentName: sharedTalent.name,
      rageActionName: content.byId.RKF01.actions.rage.name,
      pureAttributeName: content.byId.RC02.name,
      sharedTalentId: phase === 'talent'
        ? game.availableTalents().find(talent => talent.id.startsWith('V2-J1-')).id
        : null,
    };
  }, { phase, equipment, sourceLabels, hunter });
}

async function loadFixture(page, options) {
  await page.goto(url, { waitUntil: 'networkidle' });
  const fixture = await installFixture(page, options);
  await page.reload({ waitUntil: 'networkidle' });
  try {
    await page.locator('.game-page').waitFor({ state: 'visible' });
  } catch (error) {
    const diagnostic = await page.evaluate(({ key, errors }) => ({
      body: document.body.innerText.slice(0, 1200),
      html: document.body.innerHTML.slice(0, 1600),
      readyState: document.readyState,
      errors,
      save: (() => {
        try {
          const record = JSON.parse(localStorage.getItem(key) || 'null');
          return {
            phase: record?.state?.phase,
            contentVersion: record?.contentVersion,
            replay: record?.replay,
          };
        } catch {
          return 'invalid JSON';
        }
      })(),
    }), { key: saveKey, errors: pageErrors });
    throw new Error(`V2 页面载入失败：${JSON.stringify(diagnostic)}\n${error}`);
  }
  await page.waitForFunction(() => {
    const game = document.querySelector('.game-page');
    return game && !game.classList.contains('phase-loading');
  });
  return fixture;
}

async function readSave(page) {
  const text = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(text, '缺少 V2 命途自动存档');
  return JSON.parse(text);
}

async function openBuild(page) {
  const mobileTab = page.locator('.bottom-nav [data-action="tab"][data-id="build"]');
  const desktopTab = page.locator('.desktop-nav [data-action="tab"][data-id="build"]');
  await (await mobileTab.isVisible() ? mobileTab : desktopTab).click();
  await page.locator('.game-layout.view-build .equipment-section').waitFor({ state: 'visible' });
}

async function assertBuildLayout(page, viewport) {
  await openBuild(page);
  assert.equal(await page.locator('.equipment-note').count(), 0,
    '命盘页保留了常驻装备教学');
  const layout = await page.evaluate(() => {
    const board = document.querySelector('.equipment-section');
    const grid = board?.querySelector('.equipment-slot-grid');
    const boardRect = board?.getBoundingClientRect();
    const gridRect = grid?.getBoundingClientRect();
    const slots = [...(grid?.querySelectorAll('.equipment-slot') ?? [])].map(slot => {
      const rect = slot.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      board: boardRect && {
        left: boardRect.left,
        right: boardRect.right,
        clientWidth: board.clientWidth,
        scrollWidth: board.scrollWidth,
      },
      grid: gridRect && { left: gridRect.left, right: gridRect.right },
      slots,
    };
  });
  assert.ok(layout.documentWidth <= viewport.width + 1 &&
    layout.bodyWidth <= viewport.width + 1,
  `${viewport.width}: 命盘页面横向溢出 ${JSON.stringify(layout)}`);
  assert.equal(layout.slots.length, 4, `${viewport.width}: 命盘应显示四个通用装备位`);
  assert.deepEqual(await page.locator('.equipment-slot-head b').allTextContents(),
    ['装备位 1', '装备位 2', '装备位 3', '装备位 4'],
    `${viewport.width}: 装备位仍按角色划分`);
  assert.ok(layout.board && layout.grid &&
    layout.grid.left >= layout.board.left - 1 &&
    layout.grid.right <= layout.board.right + 1,
  `${viewport.width}: 装备位网格超出命盘区域 ${JSON.stringify(layout)}`);
  assert.ok(layout.slots.every(slot => slot.width > 0 &&
    slot.left >= layout.grid.left - 1 && slot.right <= layout.grid.right + 1),
  `${viewport.width}: 装备位布局异常 ${JSON.stringify(layout)}`);
  await page.screenshot({
    path: `${process.env.UI_SCREENSHOT_DIR || '/tmp'}/shanhai-v2-equipment-${viewport.width}.png`,
    fullPage: true,
  });
}

async function assertAnySlotReplacement(page, expectedHp) {
  await openBuild(page);
  await page.locator('.equipment-section .equipment-slot[data-slot="1"]').waitFor({ state: 'visible' });
  const initial = await readSave(page);
  assert.deepEqual(initial.state.equipment.slots, ['RC09', 'RC01', 'RC02', 'RC03']);
  assert.equal(initial.state.hp, expectedHp);

  await page.locator('.deck-grid [data-action="inspect-artifact"][data-id="RC12"]').click();
  const detail = page.locator('.item-dialog[role="dialog"]');
  await detail.waitFor({ state: 'visible' });
  await detail.locator('[data-action="equipment-equip"][data-id="RC12"]').click();

  const replace = page.locator('.equipment-replace-dialog[role="dialog"]');
  await replace.waitFor({ state: 'visible' });
  assert.match(await replace.innerText(), /回春瓶/);
  assert.match(await replace.innerText(), /剑穗/);
  assert.equal(await replace.locator('[data-action="equipment-confirm"]').count(), 4,
    '替换选项没有包含全部四个已装备法宝');
  assert.match(await replace.innerText(), /装备位 3/);
  assert.match(await replace.innerText(), /离开装备位 · 收入背包/);
  assert.match(await replace.innerText(), /气血上限 \+10/);
  assert.match(await replace.innerText(), /当前气血不回补/);
  assert.doesNotMatch(await replace.innerText(), /刷新节点|重置遭遇/);
  await page.waitForTimeout(350);
  await page.screenshot({
    path: `${process.env.UI_SCREENSHOT_DIR || '/tmp'}/shanhai-v2-replacement-390.png`,
    fullPage: false,
  });
  await replace.locator('[data-action="equipment-confirm"][data-id="RC12"][data-replace="RC02"]').click();

  const saved = await readSave(page);
  assert.deepEqual(saved.state.equipment.slots, ['RC09', 'RC01', 'RC12', 'RC03'],
    '确认后没有替换指定的通用装备位');
  assert.equal(saved.state.hp, initial.state.hp, '装备替换改变了当前气血');
  assert.ok(saved.state.artifacts.some(item => item.id === 'RC02'),
    '离开装备位的法宝没有保留在背包');
  assert.ok(saved.state.artifacts.some(item => item.id === 'RC12'),
    '新装备没有保留在持有物中');
  await page.locator('.inline-notice[role="status"]').filter({ hasText: /已装备至装备位 3/ }).waitFor();
}

async function assertPreviewLock(page) {
  await loadFixture(page, { phase: 'preview' });
  await openBuild(page);
  const lock = page.locator('.equipment-section .equipment-lock[role="status"]');
  await lock.waitFor({ state: 'visible' });
  assert.match(await lock.innerText(), /战前观敌期间不能调整装备/);

  await page.locator('.deck-grid [data-action="inspect-artifact"][data-id="RC09"]').click();
  const action = page.locator('.item-dialog [data-action="equipment-unequip"][data-id="RC09"]');
  await action.waitFor({ state: 'visible' });
  assert.equal(await action.isDisabled(), true, 'preview 阶段仍可点击卸下操作');
  assert.match(await page.locator('.item-dialog .equipment-lock[role="status"]').innerText(),
    /战前观敌期间不能调整装备/);
}

async function assertEliteChallenge(page) {
  await loadFixture(page, { phase: 'preview', hunter: true });
  const before = await readSave(page);
  const invite = page.locator('.phase-preview [data-action="invite-elite"]');
  await invite.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.phase-preview [data-action="invite-elite"]').count(), 1,
    '普通战预览应只有一处邀战入口');
  assert.equal(before.state.phase, 'preview');
  const nodeCount = before.state.nodes.length;
  const routeNodes = before.state.routeMap.nodes.length;
  const routePath = before.state.routeMap.path;
  const talentDrafts = before.state.talentDrafts;

  await invite.click();
  const dialog = page.locator('.elite-challenge-dialog[role="dialog"]');
  await dialog.waitFor({ state: 'visible' });
  assert.match(await dialog.innerText(), /敌手更强/);
  assert.match(await dialog.innerText(), /落败.*结束本次命途/);
  assert.deepEqual(await readSave(page), before, '打开邀战风险确认时不应改写命途存档');
  await dialog.locator('[data-action="modal-close"]').filter({ hasText: '再作准备' }).click();
  assert.equal(await page.locator('.elite-challenge-dialog').count(), 0);

  const beforeConfirmText = await page.evaluate(key => localStorage.getItem(key), saveKey);
  await page.locator('.phase-preview [data-action="invite-elite"]').click();
  await page.locator('.elite-challenge-dialog [data-action="confirm-elite-challenge"]').click();
  await page.waitForFunction(({ key, previous }) => localStorage.getItem(key) !== previous,
    { key: saveKey, previous: beforeConfirmText });
  const challenged = await readSave(page);
  assert.equal(challenged.state.phase, 'preview', '邀战应留在当前战前预览');
  assert.equal(challenged.state.nodes.length, nodeCount, '邀战改动了行迹节点数');
  assert.equal(challenged.state.routeMap.nodes.length, routeNodes, '邀战重建了路线候选');
  assert.deepEqual(challenged.state.routeMap.path, routePath, '邀战改动了已选路线');
  assert.deepEqual(challenged.state.talentDrafts, talentDrafts, '邀战重抽或清除了既定天赋候选');
  assert.equal(await page.locator('.phase-preview [data-action="invite-elite"]').count(), 0,
    '本幕邀战后仍允许重复邀战');
  assert.match(await page.locator('.phase-preview .stage-heading').innerText(), /精英/,
    '确认邀战后预览没有切换到精英敌手');
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-preview').waitFor({ state: 'visible' });
  assert.deepEqual((await readSave(page)).state.routeMap.path, routePath,
    '邀战状态 reload 后改变路线');
  assert.equal(await page.locator('.phase-preview [data-action="invite-elite"]').count(), 0,
    '邀战状态 reload 后没有保留本幕使用记录');
}

async function assertRewardEquipmentCopy(page) {
  await loadFixture(page, { phase: 'reward' });
  const rewardCard = page.locator('.reward-card[data-id="RC10"]');
  await rewardCard.waitFor({ state: 'visible' });
  await page.screenshot({
    path: `${process.env.UI_SCREENSHOT_DIR || '/tmp'}/shanhai-v2-reward-390.png`,
    fullPage: true,
  });
  assert.equal(await rewardCard.locator('.reward-equipment-role').count(), 0,
    '奖励页仍显示误导性的核心/辅器槽位分类');
  assert.match(await rewardCard.locator('.reward-mechanic').innerText(), /怒技完成返怒 20/);
  assert.match(await rewardCard.locator('.reward-mechanic').innerText(), /承受直接伤害提高 12%/);
  const supportCard = page.locator('.reward-card[data-id="RR01"]');
  assert.equal(await supportCard.locator('.reward-equipment-role').count(), 0);
  if (page.viewportSize().width <= 600) {
    const firstBox = await rewardCard.boundingBox();
    const secondBox = await supportCard.boundingBox();
    assert.ok(secondBox.y >= firstBox.y + firstBox.height, '手机奖励仍挤在同一行');
    const mechanic = await rewardCard.locator('.reward-mechanic').evaluate(element =>
      ({ client: element.clientHeight, scroll: element.scrollHeight }));
    assert.ok(mechanic.scroll <= mechanic.client + 1, '法宝机制或代价被截断');
  }
  assert.equal(await page.locator('.reward-equipment-note').count(), 0,
    '奖励页保留了常驻装备教学');
  assert.match(await rewardCard.locator('.reward-equipment-status').innerText(),
    /收入背包 · 未装备不生效/);
  await rewardCard.locator('[data-action="reward"][data-id="RC10"]').click();
  await page.locator('.inline-notice[role="status"]').filter({ hasText: /收入背包；未装备，不计入斗法/ }).waitFor();
  const saved = await readSave(page);
  assert.deepEqual(saved.state.equipment.slots, ['RC09', 'RC01', 'RC02', 'RC03'],
    '满装备位时奖励错误地替换了现有装备');
  assert.ok(saved.state.artifacts.some(item => item.id === 'RC10'),
    '满核心位时奖励没有进入背包');
}

async function assertRewardAutoEquip(page) {
  await loadFixture(page, { phase: 'reward', equipment: false });
  const reward = page.locator('.reward-card').first();
  await reward.waitFor({ state: 'visible' });
  assert.equal(await reward.locator('.reward-equipment-role').count(), 0);
  assert.match(await reward.locator('.reward-equipment-status').innerText(),
    /取得后自动装备至空位/);
  const id = await reward.getAttribute('data-id');
  await reward.locator('[data-action="reward"]').click();
  await page.locator('.inline-notice[role="status"]').filter({ hasText: /自动装备至装备位 1/ }).waitFor();
  const saved = await readSave(page);
  assert.deepEqual(saved.state.equipment.slots, [id], '有通用装备空位时奖励没有自动装备');
}

async function assertCoreRuleCopy(page) {
  await loadFixture(page, { phase: 'map' });
  await openBuild(page);
  await page.locator('.deck-grid [data-action="inspect-artifact"][data-id="RC12"]').click();
  const healing = page.locator('.item-dialog .core-rule-detail');
  await healing.waitFor({ state: 'visible' });
  assert.doesNotMatch(await healing.innerText(), /healing_guard/);
  assert.match(await healing.innerText(), /所有有效自疗额外转 60% 护盾/);
  assert.match(await healing.innerText(), /不含溢出/);
  await page.locator('.item-dialog button[aria-label="关闭"]').click();

  await page.locator('.deck-grid [data-action="inspect-artifact"][data-id="RC14"]').click();
  const poison = page.locator('.item-dialog .core-rule-detail');
  await poison.waitFor({ state: 'visible' });
  assert.match(await poison.innerText(), /预存的全部中毒/);
}

async function assertSharedTalentDetail(page) {
  const fixture = await loadFixture(page, { phase: 'talent', equipment: false });
  assert.doesNotMatch(await page.locator('.stage-heading').innerText(), /本次候选已定/,
    '悟道页保留了常驻教程说明');
  const shared = page.locator(`.talent-candidate-inspect[data-id="${fixture.sharedTalentId}"]`);
  await shared.waitFor({ state: 'visible' });
  assert.ok(await page.locator(`.talent-candidate.is-shared[data-id="${fixture.sharedTalentId}"]`).count(),
    '共享洞见没有醒目的金色候选样式');
  await shared.click();
  const detail = page.locator('.talent-dialog[role="dialog"]');
  await detail.waitFor({ state: 'visible' });
  assert.match(await detail.locator('.eyebrow').last().innerText(), /山海共悟.*共通洞见/);
  const id = await shared.getAttribute('data-id');
  assert.ok(id.startsWith('V2-J1-'), `详录候选不是 rules.insights 共通天赋：${id}`);
  const detailValue = (await detail.locator('.talent-build-current').innerText()).trim();
  assert.match(detailValue, /当前快照/);
  assert.doesNotMatch(detailValue, /净收益|因本项增加/);
  assert.ok((await detail.locator('.effect-list').innerText()).trim().length > 0,
    '共通天赋详录没有显示效果');
  await page.keyboard.press('Escape');
  await detail.waitFor({ state: 'detached' });
  const previewValue = (await page.locator(`.talent-candidate[data-id="${id}"] .talent-build-current`).innerText()).trim();
  assert.equal(previewValue, detailValue, '未选规则的详录与候选预览没有使用同一当前值');
  await page.locator(`.talent-candidate-select[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.querySelector('.game-page')?.dataset.phase !== 'talent');
  const saved = await readSave(page);
  assert.ok(saved.state.talents.RKF01.includes(id), '选择共享洞见后没有写入存档');
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page').waitFor({ state: 'visible' });
  await openBuild(page);
  const currentValue = page.locator(`.talent-ledger article.is-shared .talent-build-current`);
  await currentValue.waitFor({ state: 'visible' });
  assert.equal((await currentValue.innerText()).trim(), previewValue,
    '选择并 reload 后的当前构筑值与选择预览不一致');
}

async function captureTalentScreenshots(page, viewport) {
  const fixture = await loadFixture(page, { phase: 'talent', equipment: false });
  const shared = page.locator(`.talent-candidate-inspect[data-id="${fixture.sharedTalentId}"]`);
  await shared.waitFor({ state: 'visible' });
  const layout = await page.evaluate(() => {
    const summary = document.querySelector('.talent-candidate .talent-build-current');
    const badge = document.querySelector('.talent-candidate.is-shared .talent-candidate-head > span');
    const description = document.querySelector('.talent-candidate.is-shared > p');
    const inspect = document.querySelector('.talent-candidate.is-shared .talent-candidate-inspect');
    const select = document.querySelector('.talent-candidate.is-shared .talent-candidate-select');
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      summaryWidth: summary?.clientWidth ?? 0,
      summaryScrollWidth: summary?.scrollWidth ?? 0,
      summaryFontSize: summary ? Number.parseFloat(getComputedStyle(summary).fontSize) : 0,
      badgeFontSize: badge ? Number.parseFloat(getComputedStyle(badge).fontSize) : 0,
      descriptionFontSize: description ? Number.parseFloat(getComputedStyle(description).fontSize) : 0,
      inspectFontSize: inspect ? Number.parseFloat(getComputedStyle(inspect).fontSize) : 0,
      selectFontSize: select ? Number.parseFloat(getComputedStyle(select).fontSize) : 0,
    };
  });
  assert.ok(layout.documentWidth <= viewport.width + 1 &&
    layout.bodyWidth <= viewport.width + 1,
  `${viewport.width}: 悟道候选横向溢出 ${JSON.stringify(layout)}`);
  assert.ok(layout.summaryWidth > 0 && layout.summaryScrollWidth <= layout.summaryWidth + 1,
    `${viewport.width}: 当前快照超出候选 ${JSON.stringify(layout)}`);
  assert.ok([
    layout.summaryFontSize,
    layout.badgeFontSize,
    layout.descriptionFontSize,
    layout.inspectFontSize,
    layout.selectFontSize,
  ].every(fontSize => fontSize >= 14),
    `${viewport.width}: 新增洞见文案小于 14px ${JSON.stringify(layout)}`);
  await page.screenshot({
    path: `${process.env.UI_SCREENSHOT_DIR || '/tmp'}/shanhai-v2-talents-${viewport.width}.png`,
    fullPage: true,
  });
  await shared.click();
  const detail = page.locator('.talent-dialog[role="dialog"]');
  await detail.waitFor({ state: 'visible' });
  const detailFontSizes = await detail.evaluate(dialog => [
    ...dialog.querySelectorAll('p:not(.eyebrow), .effect-list p, .dialog-actions .button'),
  ].map(element => Number.parseFloat(getComputedStyle(element).fontSize)));
  assert.ok(detailFontSizes.every(fontSize => fontSize >= 14),
    `${viewport.width}: 天赋详录新增文案小于 14px ${JSON.stringify(detailFontSizes)}`);
  await page.waitForTimeout(350);
  await page.screenshot({
    path: `${process.env.UI_SCREENSHOT_DIR || '/tmp'}/shanhai-v2-talent-detail-${viewport.width}.png`,
    fullPage: true,
  });
}

async function assertV2ReplayAndTalentEffectSources(page) {
  const fixture = await loadFixture(page, { phase: 'battle', sourceLabels: true });
  const references = await page.evaluate(async () => {
    const { talentSourceReference } = await import('/shanhai/localization.js');
    return [
      talentSourceReference('RKF01-J1-A-TEST-EFFECT'),
      talentSourceReference('V2-J1-A-TEST-EFFECT'),
    ];
  });
  assert.deepEqual(references, [
    { methodId: 'RKF01', talentId: 'RKF01-J1-A' },
    { methodId: '', talentId: 'V2-J1-A' },
  ]);

  await page.locator('[data-action="battle-skip"]').click();
  const legacyValues = await page.evaluate(({ saveKey, buildKey, replayKey }) => ({
    replay: localStorage.getItem('suishi-shanhai-replay-v1'),
    build: localStorage.getItem('suishi-shanhai-build-v1'),
    runV2: localStorage.getItem('suishi-shanhai-run-v2-journey'),
    buildV2: localStorage.getItem('suishi-shanhai-build-v2-journey'),
    replayV2: localStorage.getItem('suishi-shanhai-replay-v2-journey'),
    runJourney: localStorage.getItem(saveKey),
    replayJourney: localStorage.getItem(replayKey),
    buildJourney: localStorage.getItem(buildKey),
  }), { saveKey, buildKey, replayKey });
  assert.equal(legacyValues.replay, 'v1-replay-untouched');
  assert.equal(legacyValues.build, 'v1-build-untouched');
  assert.equal(legacyValues.runV2, 'legacy-v2-run-untouched');
  assert.equal(legacyValues.buildV2, 'legacy-v2-build-untouched');
  assert.equal(legacyValues.replayV2, 'legacy-v2-replay-untouched');
  assert.ok(legacyValues.runJourney, 'V2 Journey 自动存档没有写入隔离键');
  assert.ok(legacyValues.replayJourney, 'V2 Journey 回放进度没有写入隔离键');
  assert.equal(legacyValues.buildJourney, null);

  await page.locator('.battle-detail-actions [data-action="battle-details"][data-tab="log"]').click();
  const log = await page.locator('.battle-log').innerText();
  assert.ok(log.includes(fixture.localTalentName), '本门天赋效果来源未解析为本门天赋名称');
  assert.ok(log.includes(fixture.sharedTalentName), '共通天赋效果来源未解析为共通天赋名称');
  assert.ok(log.includes(`身外化身 · ${fixture.rageActionName}效果`),
    '-RAGE-ECHO 战痕来源没有归属到身外化身');

  await page.locator('.battle-detail-dialog [data-action="battle-detail-tab"][data-tab="result"]').click();
  const summary = page.locator('.battle-result-detail .battle-insights');
  assert.match(await summary.innerText(), /身外化身/,
    '关键伤害简报没有把回响伤害归属到身外化身');
  assert.equal(await summary.locator('.battle-core-insight').count(), 2,
    '多个已装备核心规则法宝都应独立高亮');
  assert.equal(await summary.locator('li').count(), 1,
    '斗法简报应只显示一条核心记录和一条其他效果');
  assert.match(await summary.innerText(), /造成伤害 100/,
    '不同资源指标被混加排序，未按单项伤害展示效果');
  const diagnostics = page.locator('.battle-result-detail .diagnostics');
  assert.doesNotMatch(await diagnostics.innerText(), new RegExp(fixture.pureAttributeName),
    '纯属性法宝不应列入尚未显效');
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  try {
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        isMobile: viewport.width < 700,
        hasTouch: viewport.width < 700,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => pageErrors.push(`${viewport.width}: ${error.message}`));
      const fixture = await loadFixture(page, { phase: 'map' });
      await assertBuildLayout(page, viewport);
      const layoutCopy = await loadFixture(page, { phase: 'preview', hunter: true });
      assert.equal(layoutCopy.hp, fixture.hp);
      const widths = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        buttons: [...document.querySelectorAll('.phase-preview .stage-actions .button')].map(button => {
          const rect = button.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }),
      }));
      assert.ok(widths.document <= viewport.width + 1 && widths.body <= viewport.width + 1,
        `${viewport.width}: 战前预览横向溢出 ${JSON.stringify(widths)}`);
      assert.ok(widths.buttons.every(button => button.left >= 0 && button.right <= viewport.width + 1),
        `${viewport.width}: 战前动作超出视口 ${JSON.stringify(widths)}`);
      assert.ok(widths.buttons.every((button, index, all) => all.slice(index + 1).every(other =>
        button.right <= other.left + 1 || other.right <= button.left + 1 ||
        button.bottom <= other.top + 1 || other.bottom <= button.top + 1)),
      `${viewport.width}: 战前动作互相重叠 ${JSON.stringify(widths.buttons)}`);
      await page.screenshot({
        path: `${process.env.UI_SCREENSHOT_DIR || '/tmp'}/shanhai-v2-ui-${viewport.width}.png`,
        fullPage: true,
      });
      await page.locator('.phase-preview [data-action="invite-elite"]').click();
      const challenge = page.locator('.elite-challenge-dialog[role="dialog"]');
      await challenge.waitFor({ state: 'visible' });
      const challengeFontSizes = await challenge.evaluate(dialog => [
        ...dialog.querySelectorAll('p:not(.eyebrow), .button'),
      ].map(element => Number.parseFloat(getComputedStyle(element).fontSize)));
      assert.ok(challengeFontSizes.every(fontSize => fontSize >= 14),
        `${viewport.width}: 邀战确认文案小于 14px ${JSON.stringify(challengeFontSizes)}`);
      await page.waitForTimeout(350);
      await page.screenshot({
        path: `${process.env.UI_SCREENSHOT_DIR || '/tmp'}/shanhai-v2-elite-confirm-${viewport.width}.png`,
        fullPage: true,
      });
      await page.locator('.elite-challenge-dialog [data-action="confirm-elite-challenge"]').click();
      await page.waitForFunction(() =>
        /精英/.test(document.querySelector('.phase-preview .stage-heading')?.innerText || ''));
      await page.waitForTimeout(350);
      await page.screenshot({
        path: `${process.env.UI_SCREENSHOT_DIR || '/tmp'}/shanhai-v2-elite-preview-${viewport.width}.png`,
        fullPage: true,
      });
      await captureTalentScreenshots(page, viewport);
      if (viewport.width === 390) {
        const replacementFixture = await loadFixture(page, { phase: 'map' });
        await assertAnySlotReplacement(page, replacementFixture.hp);
      }
      await context.close();
    }

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => pageErrors.push(`workflow: ${error.message}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await assertPreviewLock(page);
    await assertEliteChallenge(page);
    await assertRewardEquipmentCopy(page);
    await assertRewardAutoEquip(page);
    await assertCoreRuleCopy(page);
    await assertSharedTalentDetail(page);
    await assertV2ReplayAndTalentEffectSources(page);
    assert.deepEqual(pageErrors, [], `页面运行时报错：${pageErrors.join(' | ')}`);
    await context.close();
    console.log('ok - V2 Journey 装备、邀战、奖励与共通天赋 UI');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
