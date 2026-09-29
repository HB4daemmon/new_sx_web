import assert from 'node:assert/strict';

export async function assertBattleMainDetailContract(page, label) {
  const surface = await page.evaluate(() => {
    const shell = document.querySelector('.battle-shell');
    return {
      details: shell?.querySelectorAll('details').length ?? 0,
      logs: document.querySelectorAll('.battle-log').length,
      fighters: [...(shell?.querySelectorAll('.combatant') || [])].map(fighter => ({
        side: fighter.getAttribute('data-side'),
        progressbars: fighter.querySelectorAll('[role="progressbar"]').length,
        healthBars: fighter.querySelectorAll('.bar.hp').length,
        rageBars: fighter.querySelectorAll('.bar.rage').length,
      })),
    };
  });
  assert.equal(surface.details, 0, `${label}: 主战斗界面仍包含 inline details`);
  assert.equal(surface.logs, 0, `${label}: 主战斗界面仍渲染战报 DOM`);
  assert.equal(surface.fighters.length, 2, `${label}: 主战斗界面没有双方信息`);
  for (const side of ['player', 'enemy']) {
    const fighter = surface.fighters.find(item => item.side === side);
    assert.ok(fighter, `${label}: 缺少 ${side} 战斗信息`);
    assert.equal(fighter.progressbars, 2, `${label} ${side}: progressbar 数量不是两条`);
    assert.equal(fighter.healthBars, 1, `${label} ${side}: 合并气血护盾条缺失`);
    assert.equal(fighter.rageBars, 1, `${label} ${side}: 怒气条缺失`);
  }
  return surface;
}

export async function assertBattleDetailEntryTargets(page, label, scope = '.battle-shell') {
  for (const tab of ['player', 'enemy']) {
    const entries = page.locator(
      `${scope} [data-action="battle-details"][data-tab="${tab}"]`,
    );
    assert.equal(await entries.count(), 1, `${label}: 缺少唯一的 ${tab} 详情入口`);
    await entries.waitFor({ state: 'visible' });
    const rect = await entries.boundingBox();
    assert.ok(rect && rect.width >= 44 && rect.height >= 44,
      `${label} ${tab}: 详情入口小于 44px ${JSON.stringify(rect)}`);
  }
}

export async function openBattleDetail(page, tab, label = 'battle detail') {
  const entries = page.locator(`[data-action="battle-details"][data-tab="${tab}"]`);
  assert.ok(await entries.count() > 0, `${label}: 缺少 ${tab} 详情入口`);
  const entry = entries.first();
  await entry.waitFor({ state: 'visible' });
  const shell = page.locator('.battle-shell');
  const hasBattleShell = await shell.count() > 0;
  const pausedBefore = hasBattleShell ? await shell.getAttribute('data-paused') : null;
  await entry.click();

  const dialog = page.locator('.modal-backdrop .modal.battle-detail-dialog[role="dialog"]');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.getAttribute('aria-modal'), 'true',
    `${label}: battle detail modal 缺少 aria-modal=true`);
  const selectedTab = dialog.locator(
    `[data-action="battle-detail-tab"][data-tab="${tab}"]`,
  );
  assert.equal(await selectedTab.count(), 1, `${label}: modal 没有 ${tab} tab`);
  assert.equal(await selectedTab.getAttribute('aria-selected'), 'true',
    `${label}: modal 打开时没有选中 ${tab} tab`);
  assert.equal(await selectedTab.getAttribute('role'), 'tab',
    `${label}: ${tab} tab 没有可访问的 tab 角色`);
  assert.ok(await page.evaluate(() => {
    const modal = document.querySelector('.modal.battle-detail-dialog[role="dialog"]');
    return Boolean(modal && modal.contains(document.activeElement));
  }), `${label}: 打开后焦点没有进入详情 modal`);
  if (hasBattleShell) {
    assert.equal(await shell.getAttribute('data-paused'), 'true',
      `${label}: 打开详情时没有暂停斗法`);
  }
  return { dialog, pausedBefore, tab };
}

export async function selectBattleDetailTab(dialog, tab, label = 'battle detail') {
  const button = dialog.locator(
    `[data-action="battle-detail-tab"][data-tab="${tab}"]`,
  );
  assert.equal(await button.count(), 1, `${label}: 缺少唯一的 ${tab} tab`);
  assert.equal(await button.isDisabled(), false, `${label}: ${tab} tab 被禁用`);
  const before = await dialog.innerText();
  await button.click();
  const after = await dialog.innerText();
  const selected = await button.evaluate(element => ({
    selected: element.getAttribute('aria-selected'),
    pressed: element.getAttribute('aria-pressed'),
  }));
  if (selected.selected !== null || selected.pressed !== null) {
    assert.ok(selected.selected === 'true' || selected.pressed === 'true',
      `${label}: ${tab} tab 未标记为当前项 ${JSON.stringify(selected)}`);
  }
  return { before, after };
}

export async function assertBattleResultUnavailable(page, dialog, label) {
  const entry = page.locator('[data-action="battle-details"][data-tab="result"]');
  if (await entry.count()) {
    assert.equal(await entry.isDisabled(), true,
      `${label}: 播放未结束时战果入口仍可用`);
  }
  const tab = dialog.locator('[data-action="battle-detail-tab"][data-tab="result"]');
  if (await tab.count()) {
    assert.equal(await tab.isDisabled(), true,
      `${label}: 播放未结束时战果 tab 仍可用`);
  }
}

export async function assertBattleDetailFits(page, viewportWidth, label) {
  const geometry = await page.locator('.modal.battle-detail-dialog').evaluate(dialog => {
    const rect = dialog.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      clientWidth: dialog.clientWidth,
      scrollWidth: dialog.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    };
  });
  assert.ok(geometry.left >= -1 && geometry.right <= viewportWidth + 1,
    `${label}: 详情 modal 超出视口 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1,
    `${label}: 详情 modal 内容横向溢出 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.documentWidth <= viewportWidth + 1 &&
    geometry.bodyWidth <= viewportWidth + 1,
  `${label}: 详情 modal 导致页面横向溢出 ${JSON.stringify(geometry)}`);
  return geometry;
}

export async function assertBattleDetailFocusTrap(page, dialog, label) {
  const tabs = dialog.locator('[data-action="battle-detail-tab"]');
  const originalTab = await dialog.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab');
  const tabIds = await tabs.evaluateAll(elements => elements.map(element => element.getAttribute('data-tab')));
  await dialog.locator(`[data-tab="${originalTab}"]`).focus();
  for (const [key, expected] of [
    ['Home', tabIds[0]],
    ['ArrowRight', tabIds[1]],
    ['End', tabIds.at(-1)],
    ['ArrowRight', tabIds[0]],
  ]) {
    await page.keyboard.press(key);
    assert.equal(await dialog.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab'),
      expected, `${label}: ${key} 没有切换到正确页签`);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-tab')),
      expected, `${label}: ${key} 后焦点没有跟随页签`);
  }
  await dialog.locator(`[data-tab="${originalTab}"]`).click();
  const focusableCount = await dialog.locator(
    'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  ).count();
  assert.ok(focusableCount >= 3,
    `${label}: battle detail modal 可聚焦控件不足 ${focusableCount}`);
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < focusableCount + 1; index += 1) {
      await page.keyboard.press(key);
      assert.ok(await page.evaluate(() => {
        const modal = document.querySelector('.battle-detail-dialog[role="dialog"]');
        return Boolean(modal && modal.contains(document.activeElement));
      }), `${label}: ${key} 焦点逃出 battle detail modal`);
    }
  }
}

export async function assertPreviewBattleDetailTabs(dialog, label) {
  const tabs = await dialog.locator('[data-action="battle-detail-tab"]')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-tab')).sort());
  assert.deepEqual(tabs, ['enemy', 'player'], `${label}: 预览详情暴露了非我/敌 tab`);
  assert.equal(await dialog.locator('.battle-log').count(), 0,
    `${label}: 战前详情提前展示了战报`);
}

export async function closeBattleDetail(page, detail, label = 'battle detail') {
  await detail.dialog.locator('[data-action="modal-close"]').first().click();
  await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
  assert.ok(await page.evaluate(({ tab }) => {
    const active = document.activeElement;
    return active?.getAttribute('data-action') === 'battle-details' &&
      active?.getAttribute('data-tab') === tab;
  }, { tab: detail.tab }), `${label}: 关闭后焦点没有返回 ${detail.tab} 入口`);
  if (detail.pausedBefore !== null) {
    assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'),
      detail.pausedBefore, `${label}: 关闭后没有恢复原暂停语义`);
  }
}

export async function assertBattleResultAccessible(page, label) {
  const entry = page.locator('[data-action="battle-details"][data-tab="result"]');
  assert.equal(await entry.count(), 1, `${label}: 播放完成后缺少战果入口`);
  const detail = await openBattleDetail(page, 'result', label);
  await assertBattleDetailFits(
    page, await page.evaluate(() => window.innerWidth), `${label} result`,
  );
  const tab = detail.dialog.locator(
    '[data-action="battle-detail-tab"][data-tab="result"]',
  );
  assert.equal(await tab.count(), 1, `${label}: 详情 modal 缺少战果 tab`);
  assert.equal(await tab.isDisabled(), false, `${label}: 完播后战果 tab 仍不可访问`);
  const text = (await detail.dialog.innerText()).trim();
  assert.ok(text.length > 0 && /\d/.test(text),
    `${label}: 战果 tab 没有可访问的最终统计内容 ${text}`);
  const stats = await detail.dialog.locator(
    '.battle-result-detail .detail-stat-grid > span',
  ).allTextContents();
  assert.equal(stats.length, 4, `${label}: 战果缺少四项最终统计 ${JSON.stringify(stats)}`);
  for (const labelText of ['胜负', '回合', '我方气血', '敌方气血']) {
    assert.ok(stats.some(item => item.includes(labelText)),
      `${label}: 战果统计缺少 ${labelText} ${JSON.stringify(stats)}`);
  }
  await closeBattleDetail(page, detail, label);
  return text;
}
