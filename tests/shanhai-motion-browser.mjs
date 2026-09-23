import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const saveKey = 'suishi-shanhai-run-v1';
const replayKey = 'suishi-shanhai-replay-v1';
const reportOverride = process.env.SHANHAI_MOTION_REPORT_DIR ||
  process.env.BROWSER_REPORT_DIR ||
  process.env.BROWSER_OUTPUT_DIR;
const reportDir = reportOverride
  ? path.resolve(reportOverride)
  : await mkdtemp(path.join(os.tmpdir(), 'shanhai-motion-'));
const screenshotDir = path.join(reportDir, 'screenshots');

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
const checks = [];
const failures = [];
const browserErrors = [];

async function check(name, fn) {
  try {
    const details = await fn();
    checks.push({ name, ok: true, ...(details ? { details } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name, ok: false, error: message });
    throw error;
  }
}

function installMotionInstrumentation(context) {
  return context.addInitScript(() => {
    const parseDuration = value => String(value || '0s').split(',').map(part => {
      const text = part.trim();
      const number = Number.parseFloat(text);
      return text.endsWith('ms') ? number : number * 1000;
    }).filter(Number.isFinite).reduce((maximum, value) => Math.max(maximum, value), 0);

    window.__shanhaiMotionAudit = { animations: [], transitions: [] };
    document.addEventListener('animationstart', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const arena = target.closest('.combat-arena');
      const combatant = target.closest('.combatant');
      if (!arena || (!combatant && !target.matches('.combat-float'))) return;

      const duration = parseDuration(getComputedStyle(target).animationDuration);
      const record = {
        name: event.animationName,
        frameIndex: Number(arena.dataset.frameIndex),
        frameKind: arena.dataset.frameKind || '',
        actionKind: arena.dataset.actionKind || '',
        side: combatant?.getAttribute('data-side') || '',
        motion: combatant?.getAttribute('data-motion') || '',
        motionTrigger: combatant?.getAttribute('data-motion-trigger') || '',
        targetClass: typeof target.className === 'string'
          ? target.className
          : target.className?.baseVal || '',
        duration,
        samples: [],
      };
      window.__shanhaiMotionAudit.animations.push(record);

      const startedAt = performance.now();
      const sample = () => {
        const rect = target.getBoundingClientRect();
        record.samples.push({
          time: performance.now(),
          connected: target.isConnected,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          transform: getComputedStyle(target).transform,
        });
        if (performance.now() - startedAt < Math.max(220, duration + 60)) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    }, true);

    document.addEventListener('transitionrun', event => {
      const target = event.target;
      if (!(target instanceof Element) || !target.matches('.bar.rage > span')) return;
      const combatant = target.closest('.combatant');
      window.__shanhaiMotionAudit.transitions.push({
        property: event.propertyName,
        side: combatant?.getAttribute('data-side') || '',
        frameIndex: Number(target.closest('.combat-arena')?.getAttribute('data-frame-index')),
        duration: parseDuration(getComputedStyle(target).transitionDuration),
      });
    }, true);
  });
}

async function waitForApp(page) {
  await page.locator('#shanhai-app').waitFor({ state: 'visible' });
  await page.locator('.game-page, .landing-page').first().waitFor({ state: 'visible' });
}

async function waitForPhase(page, expected) {
  await page.waitForFunction(phase =>
    Boolean(document.querySelector(`.game-page.phase-${phase}`)), expected);
}

async function clickAction(page, action, attributes = {}) {
  const candidates = page.locator(`[data-action="${action}"]`);
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible()) || await candidate.isDisabled()) continue;
    let matches = true;
    for (const [key, expected] of Object.entries(attributes)) {
      if ((await candidate.getAttribute(`data-${key}`)) !== String(expected)) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    await candidate.scrollIntoViewIfNeeded();
    await candidate.click();
    return candidate;
  }
  throw new Error(`找不到可见按钮 data-action=${action} ${JSON.stringify(attributes)}`);
}

async function savedText(page) {
  const text = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(text, '浏览器没有自动存档');
  return text;
}

async function battleSnapshot(page) {
  return page.evaluate(async ({ saveKey, replayKey }) => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await (window.__shanhaiMotionContent ||= loadContent('/content/'));
    const rawText = localStorage.getItem(saveKey);
    if (!rawText) throw new Error('缺少命途自动存档');
    const raw = JSON.parse(rawText);
    const game = loadRun(content);
    if (!game?.state.battle?.frames.length) throw new Error('自动存档没有重建战斗帧');
    return {
      raw,
      rawText,
      state: game.state,
      replay: JSON.parse(localStorage.getItem(replayKey) || 'null'),
      key: `${game.state.id}:${game.state.act}:${game.state.step}:${game.state.battle.frames.length}`,
      frames: game.state.battle.frames,
      result: {
        outcome: game.state.battle.outcome,
        rounds: game.state.battle.rounds,
        playerHp: game.state.battle.playerHp,
        enemyHp: game.state.battle.enemyHp,
      },
    };
  }, { saveKey, replayKey });
}

async function setReplayCursor(page, cursor, reload = true) {
  if (await page.locator('.battle-shell').count() &&
      await page.locator('.battle-shell').getAttribute('data-paused') !== 'true' &&
      await page.locator('[data-action="battle-pause"]').count()) {
    await clickAction(page, 'battle-pause');
  }
  const snapshot = await battleSnapshot(page);
  await page.evaluate(({ replayKey, cursor, key, length }) => {
    localStorage.setItem(replayKey, JSON.stringify({
      key,
      cursor: Math.max(0, Math.min(length - 1, Math.floor(cursor))),
    }));
  }, { replayKey, cursor, key: snapshot.key, length: snapshot.frames.length });
  if (reload) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await waitForPhase(page, 'battle');
  }
  return snapshot;
}

async function waitForFrameIndex(page, index) {
  await page.waitForFunction(expected => {
    const arena = document.querySelector('.combat-arena');
    return Number(arena?.getAttribute('data-frame-index')) === expected;
  }, index, { polling: 'raf' });
}

async function waitForFrameChange(page, previous) {
  await page.waitForFunction(index => {
    const arena = document.querySelector('.combat-arena');
    return Number(arena?.getAttribute('data-frame-index')) > index;
  }, previous, { polling: 'raf' });
}

async function assertSteadyFirstBattle(page, width) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.method-choice[data-id="RKF01"]').waitFor({ state: 'visible' });
  await page.locator('[name="player-name"]').fill(`动画验收${width}`);
  await page.locator('details[data-details="seed-options"] summary').click();
  await page.locator('[name="seed"]').fill(`motion-real-opening-${width}`);
  await page.locator('.method-choice[data-id="RKF01"]').click();
  await clickAction(page, 'start');
  await waitForPhase(page, 'map');
  const firstNode = page.locator('.map-node.available:not([disabled])').first();
  const firstNodeKey = await firstNode.getAttribute('data-id');
  assert.ok(firstNodeKey, `${width}: 开局地图首格缺少 route key`);
  await firstNode.scrollIntoViewIfNeeded();
  const saveBeforePreview = await page.evaluate(key => localStorage.getItem(key), saveKey);
  await firstNode.click();
  await page.locator('.node-preview-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.game-page').getAttribute('data-phase'), 'map',
    `${width}: 地图预览不应进入战前阶段`);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), saveBeforePreview,
    `${width}: 地图预览不应改变存档`);
  await page.locator('[data-action="confirm-node"]').click();
  await waitForPhase(page, 'preview');
  await clickAction(page, 'fight');
  await waitForPhase(page, 'battle');
  await page.locator('.battle-shell').waitFor({ state: 'visible' });

  const snapshot = await battleSnapshot(page);
  assert.equal(snapshot.state.method, 'RKF01', `${width}: 非预期开局功法`);
  assert.equal(snapshot.state.phase, 'battle', `${width}: 首次进入的不是战斗阶段`);
  assert.equal(snapshot.state.step, 0, `${width}: 不是 steady 首节点`);
  assert.equal(snapshot.state.routeMap?.path[0], firstNodeKey,
    `${width}: 战斗没有记录刚才实际选择的 route key`);
  assert.equal(snapshot.state.nodes[0]?.id, snapshot.state.routeMap?.nodes
    .find(node => node.key === firstNodeKey)?.id,
  `${width}: 已选历史与地图首格不一致`);
  assert.equal(snapshot.raw.replay, 'deterministic-input-v1',
    `${width}: 自动存档未使用确定性战斗输入`);
  assert.deepEqual(snapshot.raw.state.battle.frames, [],
    `${width}: 存档不应重复保存完整战斗帧`);
  assert.ok(snapshot.frames.length > 8, `${width}: steady 首战帧数不足`);
  assert.deepEqual(snapshot.result, {
    outcome: snapshot.state.battle.outcome,
    rounds: snapshot.state.battle.rounds,
    playerHp: snapshot.state.battle.playerHp,
    enemyHp: snapshot.state.battle.enemyHp,
  });
  assert.equal((await page.locator('.combatant').count()), 2, `${width}: 战斗双方不完整`);
  assert.equal((await page.locator('.combatant .fighter-art .portrait').count()), 2,
    `${width}: 战斗立绘节点不完整`);
  assert.equal((await page.locator('.combatant .bar.hp > span').count()), 2,
    `${width}: 气血条 span 不完整`);
  assert.equal((await page.locator('.combatant .bar.rage > span').count()), 2,
    `${width}: 怒气条 span 不完整`);
  assert.equal((await page.locator('.battle-controls button').count()), 5,
    `${width}: 战斗控制节点不完整`);
  assert.equal((await page.locator('.battle-log').count()), 1,
    `${width}: 战报节点不完整`);

  return snapshot;
}

async function captureStableNodes(page) {
  await page.evaluate(() => {
    const arena = document.querySelector('.combat-arena');
    const combatants = [...document.querySelectorAll('.combatant')];
    window.__shanhaiMotionNodes = {
      shell: document.querySelector('.battle-shell'),
      arena,
      combatants,
      portraits: combatants.map(item => item.querySelector('.fighter-art .portrait')),
      hpBars: combatants.map(item => item.querySelector('.bar.hp')),
      hpFills: combatants.map(item => item.querySelector('.bar.hp > span')),
      rageBars: combatants.map(item => item.querySelector('.bar.rage')),
      rageFills: combatants.map(item => item.querySelector('.bar.rage > span')),
      controls: document.querySelector('.battle-controls'),
      buttons: [...document.querySelectorAll('.battle-controls button')],
      log: document.querySelector('.battle-log'),
    };
  });
}

async function stableNodesRemain(page, label) {
  const stable = await page.evaluate(() => {
    const refs = window.__shanhaiMotionNodes;
    if (!refs) return false;
    const combatants = [...document.querySelectorAll('.combatant')];
    const same = (before, after) => before.length === after.length &&
      before.every((node, index) => node === after[index]);
    return refs.shell === document.querySelector('.battle-shell') &&
      refs.arena === document.querySelector('.combat-arena') &&
      same(refs.combatants, combatants) &&
      same(refs.portraits, combatants.map(item => item.querySelector('.fighter-art .portrait'))) &&
      same(refs.hpBars, combatants.map(item => item.querySelector('.bar.hp'))) &&
      same(refs.hpFills, combatants.map(item => item.querySelector('.bar.hp > span'))) &&
      same(refs.rageBars, combatants.map(item => item.querySelector('.bar.rage'))) &&
      same(refs.rageFills, combatants.map(item => item.querySelector('.bar.rage > span'))) &&
      refs.controls === document.querySelector('.battle-controls') &&
      same(refs.buttons, [...document.querySelectorAll('.battle-controls button')]) &&
      refs.log === document.querySelector('.battle-log');
  });
  assert.ok(stable, `${label}: 帧更新替换了 battle arena/combatant/portrait/bar/control/log 节点`);
}

function expectedActionKind(frame) {
  if (frame.kind !== 'action') return 'none';
  const action = frame.actor ? frame[frame.actor]?.lockedAction : '';
  if (action === 'rage_action' || /怒技/.test(frame.text)) return 'rage';
  if (action === 'basic_action' || /普攻/.test(frame.text)) return 'basic';
  return 'none';
}

function expectedMotion(frame, previous, side) {
  if (!previous) return 'idle';
  const before = previous[side];
  const after = frame[side];
  if (frame.kind === 'action' && frame.actor === side) {
    return expectedActionKind(frame) === 'rage' ? 'rage'
      : expectedActionKind(frame) === 'basic' ? 'strike' : 'idle';
  }
  if (frame.kind === 'dot' && frame.target === side) return 'dot';
  if (frame.kind === 'damage' && frame.target === side) {
    return after.hp < before.hp ? 'hit' : 'block';
  }
  if (frame.kind === 'heal' && after.hp > before.hp) return 'heal';
  if (frame.kind === 'shield' && after.shield > before.shield) return 'shield';
  if (frame.kind === 'status' &&
      Object.keys({ ...before.statuses, ...after.statuses }).some(key =>
        (after.statuses[key] || 0) > (before.statuses[key] || 0))) return 'buff';
  return 'idle';
}

async function assertFrameContract(page, index, frames, label) {
  const frame = frames[index];
  const previous = index > 0 ? frames[index - 1] : undefined;
  assert.ok(frame, `${label}: fixture 缺少 frame ${index}`);
  const actual = await page.evaluate(() => {
    const arena = document.querySelector('.combat-arena');
    const shell = document.querySelector('.battle-shell');
    return {
      shellPaused: shell?.getAttribute('data-paused'),
      beatDuration: shell ? getComputedStyle(shell).getPropertyValue('--beat-duration').trim() : '',
      frameIndex: arena?.getAttribute('data-frame-index'),
      frameKind: arena?.getAttribute('data-frame-kind'),
      actionKind: arena?.getAttribute('data-action-kind'),
      motionTrigger: arena?.getAttribute('data-motion-trigger'),
      combatants: [...document.querySelectorAll('.combatant')].map(item => ({
        side: item.getAttribute('data-side'),
        motion: item.getAttribute('data-motion'),
        motionTrigger: item.getAttribute('data-motion-trigger'),
        frameIndex: item.getAttribute('data-frame-index'),
        lowHealth: item.getAttribute('data-low-health'),
        rageReady: item.getAttribute('data-rage-ready'),
        hp: Number(item.querySelector('.bar.hp')?.getAttribute('aria-valuenow')),
        hpMax: Number(item.querySelector('.bar.hp')?.getAttribute('aria-valuemax')),
        rage: Number(item.querySelector('.bar.rage')?.getAttribute('aria-valuenow')),
        rageMax: Number(item.querySelector('.bar.rage')?.getAttribute('aria-valuemax')),
        rageWidth: Number.parseFloat(item.querySelector('.bar.rage > span')?.style.width || '0'),
      })),
    };
  });
  assert.equal(Number(actual.frameIndex), index, `${label}: arena data-frame-index 不匹配`);
  assert.equal(actual.frameKind, frame.kind, `${label}: arena data-frame-kind 不匹配`);
  assert.equal(actual.actionKind, expectedActionKind(frame),
    `${label}: arena data-action-kind 不匹配`);
  assert.equal(Number(actual.motionTrigger), index % 2,
    `${label}: arena motion trigger 未按 frame key 更新`);
  assert.match(actual.beatDuration, /^\d+(?:\.\d+)?ms$/,
    `${label}: 缺少可测的 --beat-duration ${actual.beatDuration}`);
  assert.ok(Number.parseFloat(actual.beatDuration) > 0,
    `${label}: --beat-duration 必须为正数`);
  assert.deepEqual(actual.combatants.map(item => item.side).sort(), ['enemy', 'player'],
    `${label}: data-side 不完整`);
  for (const side of ['player', 'enemy']) {
    const item = actual.combatants.find(value => value.side === side);
    assert.equal(item.motion, expectedMotion(frame, previous, side),
      `${label}: ${side} data-motion 与帧效果不一致`);
    assert.equal(item.frameIndex, String(index), `${label}: ${side} 帧索引不匹配`);
    assert.equal(Number.isFinite(item.hp) && Number.isFinite(item.hpMax), true,
      `${label}: ${side} 气血 aria 数值无效`);
    assert.equal(Number.isFinite(item.rage) && Number.isFinite(item.rageMax), true,
      `${label}: ${side} 怒气 aria 数值无效`);
    assert.equal(item.rage, frame[side].rage, `${label}: ${side} 怒气数值未更新`);
    assert.equal(item.rageMax, frame[side].rageCap, `${label}: ${side} 怒气上限未更新`);
    assert.ok(Math.abs(item.rageWidth - frame[side].rage / frame[side].rageCap * 100) < 0.01,
      `${label}: ${side} 怒气条目标比例不真实`);
    assert.equal(item.lowHealth, String(frame[side].hp / frame[side].maxHp <= 0.3),
      `${label}: ${side} data-low-health 与气血不一致`);
    assert.equal(item.rageReady, String(frame[side].rage >= frame[side].rageCap),
      `${label}: ${side} data-rage-ready 与怒气不一致`);
    assert.equal(Number(item.motionTrigger), index % 2,
      `${label}: ${side} motion key 未随帧更新`);
  }
  return actual;
}

async function readMotionKey(page, side) {
  return page.locator(`.combatant[data-side="${side}"]`).getAttribute('data-motion-trigger');
}

async function assertNoPageIssues(page, errors, width) {
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(overflow.document <= overflow.viewport + 1,
    `${width}: document 横向溢出 ${JSON.stringify(overflow)}`);
  assert.ok(overflow.body <= overflow.viewport + 1,
    `${width}: body 横向溢出 ${JSON.stringify(overflow)}`);
  assert.equal(await page.locator('[role="alert"]:visible').count(), 0,
    `${width}: 出现可见错误`);
  const assets = await page.evaluate(async () => {
    const images = [...document.images].map(image => ({
      src: image.currentSrc || image.src,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    }));
    const atlas = await fetch('./assets/generated/combat-vfx-atlas.webp');
    return {
      images,
      atlasStatus: atlas.status,
      atlasType: atlas.headers.get('content-type'),
      atlasBytes: (await atlas.arrayBuffer()).byteLength,
    };
  });
  assert.deepEqual(assets.images.filter(item =>
    !item.complete || !item.naturalWidth || !item.naturalHeight), [],
  `${width}: 图片资源未加载 ${JSON.stringify(assets.images)}`);
  assert.equal(assets.atlasStatus, 200, `${width}: atlas 返回 ${assets.atlasStatus}`);
  assert.equal(assets.atlasType, 'image/webp', `${width}: atlas 类型错误`);
  assert.ok(assets.atlasBytes > 0, `${width}: atlas 内容为空`);
  assert.deepEqual(errors, [], `${width}: 浏览器错误 ${JSON.stringify(errors)}`);
}

async function motionSamples(page, { frameIndex, motion, side, float = false }) {
  await page.waitForFunction(({ frameIndex, motion, side, float }) => {
    const audit = window.__shanhaiMotionAudit;
    return audit?.animations.some(record => {
      const matches = record.frameIndex === frameIndex &&
        (float
          ? record.targetClass.split(/\s+/).includes('combat-float')
          : record.motion === motion && record.side === side);
      if (!matches || record.samples.length < 4) return false;
      const samples = record.samples.filter(item => item.connected);
      const span = key => samples.length
        ? Math.max(...samples.map(item => item[key])) -
          Math.min(...samples.map(item => item[key]))
        : 0;
      const elapsed = samples.length
        ? samples.at(-1).time - samples[0].time
        : 0;
      return span('x') > 0.5 || span('y') > 0.5 ||
        elapsed >= Math.min(record.duration, 180);
    });
  }, { frameIndex, motion, side, float }, { polling: 'raf' });
  return page.evaluate(({ frameIndex, motion, side, float }) => {
    const record = window.__shanhaiMotionAudit.animations.find(item =>
      item.frameIndex === frameIndex &&
      (float
        ? item.targetClass.split(/\s+/).includes('combat-float')
        : item.motion === motion && item.side === side) &&
      item.samples.length >= 4);
    const samples = record.samples.filter(item => item.connected);
    const span = key => Math.max(...samples.map(item => item[key])) -
      Math.min(...samples.map(item => item[key]));
    return {
      record: {
        name: record.name,
        frameIndex: record.frameIndex,
        frameKind: record.frameKind,
        actionKind: record.actionKind,
        side: record.side,
        motion: record.motion,
        targetClass: record.targetClass,
        motionTrigger: record.motionTrigger,
        duration: record.duration,
      },
      sampleCount: samples.length,
      xMovement: span('x'),
      yMovement: span('y'),
      samples,
    };
  }, { frameIndex, motion, side, float });
}

async function assertMovingAnimation(page, options, label) {
  const result = await motionSamples(page, options);
  assert.ok(result.xMovement > 0.5 || result.yMovement > 0.5,
    `${label}: 动画没有真实位移 ${JSON.stringify(result.record)}`);
  return result;
}

async function assertRageInterpolation(page, snapshot, width) {
  const frames = snapshot.frames;
  const index = frames.findIndex((frame, cursor) =>
    cursor > 0 && frame.player.rage !== frames[cursor - 1].player.rage);
  assert.ok(index > 0, `${width}: 实战没有怒气变化帧`);
  await setReplayCursor(page, index - 1);
  await waitForFrameIndex(page, index);
  await assertFrameContract(page, index, frames, `${width} rage interpolation`);

  const transition = await page.waitForFunction(expected => {
    const fill = document.querySelector('.combatant[data-side="player"] .bar.rage > span');
    return [...(fill?.getAnimations() || [])].some(animation =>
      animation.playState === 'running' &&
      animation.effect?.getTiming().duration > 0);
  }, index, { polling: 'raf' }).catch(() => null);
  assert.ok(transition, `${width}: 怒气条没有实际 width transition`);
  const movement = await page.evaluate(() => {
    const fill = document.querySelector('.combatant[data-side="player"] .bar.rage > span');
    const shell = document.querySelector('.battle-shell');
    const startWidth = fill?.getBoundingClientRect().width || 0;
    const beat = Number.parseFloat(shell?.style.getPropertyValue('--beat-duration') || '0');
    const sampleFor = Math.max(80, Math.min(220, beat * 0.65));
    return new Promise(resolve => {
      const started = performance.now();
      let min = Infinity;
      let max = -Infinity;
      const sample = () => {
        const current = fill?.getBoundingClientRect().width || 0;
        min = Math.min(min, current);
        max = Math.max(max, current);
        if (performance.now() - started < sampleFor) requestAnimationFrame(sample);
        else resolve({ startWidth, min, max, sampleFor });
      };
      requestAnimationFrame(sample);
    });
  });
  assert.ok(movement.max - movement.min > 0.5,
    `${width}: 怒气条没有在目标数值间插值 ${JSON.stringify(movement)}`);
}

async function createRuntimeBattleFixture(page, method, seed, hpRatio = 1) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);
  await page.evaluate(async ({ method, seed, hpRatio, saveKey, replayKey }) => {
    const [{ loadContent }, { ShanhaiGame }, { saveRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    localStorage.clear();
    const content = await loadContent('/content/');
    const game = ShanhaiGame.create(content, { seed, name: `动画表现${method}`, method });
    const firstNode = game.availableNodes()[0];
    if (!firstNode) throw new Error('Fixture has no available opening node');
    game.dispatch({ type: 'enter', id: firstNode.key });
    if (game.state.phase !== 'preview') throw new Error(`Fixture did not enter preview: ${game.state.phase}`);
    if (hpRatio < 1) {
      game.state.hp = Math.max(1, Math.floor(game.state.hp * hpRatio));
    }
    game.dispatch({ type: 'fight' });
    saveRun(game);
    localStorage.removeItem(replayKey);
    const raw = JSON.parse(localStorage.getItem(saveKey));
    if (raw.state.battle.frames.length !== 0) throw new Error('Fixture save retained battle frames');
  }, { method, seed, hpRatio, saveKey, replayKey });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);
  await waitForPhase(page, 'battle');
  const snapshot = await battleSnapshot(page);
  const selectedKey = snapshot.state.routeMap?.path[0];
  assert.ok(selectedKey, `${method}: route map 没有记录首格 key`);
  assert.equal(snapshot.state.method, method, `${method}: fixture 功法错误`);
  assert.equal(snapshot.state.nodes[0]?.id, snapshot.state.routeMap?.nodes
    .find(node => node.key === selectedKey)?.id,
  `${method}: fixture 已选历史与地图不一致`);
  assert.equal(snapshot.state.step, 0, `${method}: fixture 不是首节点`);
  assert.deepEqual(snapshot.raw.state.battle.frames, [],
    `${method}: serialized fixture 应依靠 replay 重建帧`);
  assert.ok(snapshot.frames.length > 0, `${method}: loadRun 没有重建战斗帧`);
  return snapshot;
}

function findFrame(frames, predicate, label) {
  const index = frames.findIndex(predicate);
  assert.ok(index > 0, `真实 runtime fixture 缺少 ${label} 帧`);
  return index;
}

function deltaFor(frame, previous, side, field) {
  return frame[side][field] - previous[side][field];
}

function motionTarget(frame, previous, motion) {
  for (const side of ['player', 'enemy']) {
    if (expectedMotion(frame, previous, side) === motion) return side;
  }
  return null;
}

async function assertFixtureMotion(page, snapshot, index, motion, label) {
  await setReplayCursor(page, index - 1);
  await waitForFrameIndex(page, index);
  await clickAction(page, 'battle-pause');
  const actual = await assertFrameContract(page, index, snapshot.frames, label);
  const targetSide = motionTarget(snapshot.frames[index], snapshot.frames[index - 1], motion);
  assert.ok(targetSide, `${label}: runtime frame 没有 ${motion} 表现对象`);
  assert.equal(actual.combatants.find(item => item.side === targetSide)?.motion, motion,
    `${label}: ${targetSide} 未呈现 ${motion}`);
  assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'), 'true',
    `${label}: 暂停状态没有反映到 battle shell`);
  return targetSide;
}

async function assertFixtureCoverage(page) {
  const shieldSnapshot = await createRuntimeBattleFixture(
    page, 'RKF01', 'motion-legal-shield-rage');
  const shieldIndex = findFrame(shieldSnapshot.frames, (frame, index) =>
    index > 0 && frame.kind === 'shield' &&
    ['player', 'enemy'].some(side =>
      deltaFor(frame, shieldSnapshot.frames[index - 1], side, 'shield') > 0),
  '护盾');
  const rageIndex = findFrame(shieldSnapshot.frames, frame =>
    frame.kind === 'action' && expectedActionKind(frame) === 'rage',
  '怒技');
  assert.ok(shieldSnapshot.frames.some((frame, index) =>
    index > 0 && frame.kind === 'action' && expectedActionKind(frame) === 'basic'),
  'RKF01 实战缺少普攻表现帧');
  await assertFixtureMotion(page, shieldSnapshot, shieldIndex, 'shield', '真实护盾 fixture');
  await assertFixtureMotion(page, shieldSnapshot, rageIndex, 'rage', '真实怒技 fixture');
  await assertFixtureMotion(page, shieldSnapshot,
    findFrame(shieldSnapshot.frames, (frame, index) =>
      index > 0 && frame.kind === 'action' && expectedActionKind(frame) === 'basic',
    '普攻'), 'strike', '真实普攻 fixture');

  const healSnapshot = await createRuntimeBattleFixture(
    page, 'RKF03', 'motion-legal-heal-rage', 0.2);
  const healIndex = findFrame(healSnapshot.frames, (frame, index) =>
    index > 0 && frame.kind === 'heal' &&
    ['player', 'enemy'].some(side => deltaFor(frame, healSnapshot.frames[index - 1], side, 'hp') > 0),
  '治疗');
  await assertFixtureMotion(page, healSnapshot, healIndex, 'heal', '真实治疗 fixture');
  const startLowHealth = healSnapshot.frames[0].player.hp / healSnapshot.frames[0].player.maxHp <= 0.3;
  if (startLowHealth) {
    await setReplayCursor(page, 0);
    await clickAction(page, 'battle-pause');
    const lowHealth = await page.locator('.combatant[data-side="player"]')
      .getAttribute('data-low-health');
    assert.equal(lowHealth, 'true', '低气血合法 fixture 未标记 data-low-health');
  }

  const readyIndex = findFrame(shieldSnapshot.frames, frame =>
    frame.player.rage >= frame.player.rageCap,
  '怒气已满');
  await createRuntimeBattleFixture(page, 'RKF01', 'motion-legal-shield-rage');
  await setReplayCursor(page, readyIndex - 1);
  await waitForFrameIndex(page, readyIndex);
  await clickAction(page, 'battle-pause');
  await assertFrameContract(page, readyIndex, shieldSnapshot.frames, '真实怒气就绪 fixture');
  const dotSnapshot = await createRuntimeBattleFixture(
    page, 'RKF04', 'motion-legal-dot', 1);
  const dotIndex = findFrame(dotSnapshot.frames, frame => frame.kind === 'dot', '持续伤害');
  await assertFixtureMotion(page, dotSnapshot, dotIndex, 'dot', '真实 DOT fixture');
  return {
    shieldSnapshot,
    shieldIndex,
    rageIndex,
    healSnapshot,
    healIndex,
    dotSnapshot,
    dotIndex,
    readyIndex,
  };
}

async function assertControlTimingAndReplay(page, snapshot, width) {
  const actionIndex = findFrame(snapshot.frames, frame =>
    frame.kind === 'action' && expectedActionKind(frame) === 'basic', '普攻动作');
  await setReplayCursor(page, actionIndex - 1);
  await captureStableNodes(page);
  await waitForFrameIndex(page, actionIndex);
  await assertFrameContract(page, actionIndex, snapshot.frames, `${width} active action`);
  const actionFrame = snapshot.frames[actionIndex];
  const actor = actionFrame.actor;
  const actorNode = page.locator(`.combatant[data-side="${actor}"]`);
  const actionMotion = await actorNode.getAttribute('data-motion');
  assert.equal(actionMotion, 'strike', `${width}: 普攻动作没有 strike motion`);
  const triggerKey = await readMotionKey(page, actor);
  assert.ok(triggerKey === '0' || triggerKey === '1',
    `${width}: combatant data-motion-trigger 缺少可测 motion key`);

  const animation = await assertMovingAnimation(page, {
    frameIndex: actionIndex,
    motion: 'strike',
    side: actor,
  }, `${width} 普攻位移`);

  const sameActionAnimationCount = await page.evaluate(({ frameIndex, actor, triggerKey }) =>
    window.__shanhaiMotionAudit.animations.filter(record =>
      record.frameIndex === frameIndex &&
      record.side === actor &&
      record.motion === 'strike' &&
      record.motionTrigger === triggerKey).length,
  { frameIndex: actionIndex, actor, triggerKey });
  assert.ok(sameActionAnimationCount > 0,
    `${width}: 没有记录到普攻动作动画 ${JSON.stringify(animation.record)}`);
  await clickAction(page, 'battle-pause');
  assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'), 'true',
    `${width}: pause 未同步到 shell`);
  const cursorAtPause = (await battleSnapshot(page)).replay?.cursor;
  assert.equal(cursorAtPause, actionIndex, `${width}: pause 时 cursor 不在当前动作`);
  const saveBeforeControls = await savedText(page);
  const beatAt1x = Number.parseFloat((await page.locator('.battle-shell')
    .evaluate(element => getComputedStyle(element).getPropertyValue('--beat-duration'))).trim());
  await clickAction(page, 'battle-speed', { speed: 2 });
  assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'), 'true');
  const beatAt2x = Number.parseFloat((await page.locator('.battle-shell')
    .evaluate(element => getComputedStyle(element).getPropertyValue('--beat-duration'))).trim());
  await clickAction(page, 'battle-speed', { speed: 4 });
  const beatAt4x = Number.parseFloat((await page.locator('.battle-shell')
    .evaluate(element => getComputedStyle(element).getPropertyValue('--beat-duration'))).trim());
  assert.ok(Math.abs(beatAt1x / 2 - beatAt2x) < 0.1,
    `${width}: 2x beat 时间没有减半 ${beatAt1x}/${beatAt2x}`);
  assert.ok(Math.abs(beatAt1x / 4 - beatAt4x) < 0.1,
    `${width}: 4x beat 时间没有按速率缩短 ${beatAt1x}/${beatAt4x}`);
  const keyAfterSpeed = await readMotionKey(page, actor);
  assert.equal(keyAfterSpeed, triggerKey, `${width}: 改速重渲染重复触发动作 key`);

  const logModeBefore = await page.locator('[data-action="battle-log-mode"]')
    .getAttribute('aria-pressed');
  const logDisclosure = page.locator('details[data-details="battle-log"]');
  if (!(await logDisclosure.getAttribute('open'))) await logDisclosure.locator('summary').click();
  assert.equal(await logDisclosure.getAttribute('open'), '');
  await clickAction(page, 'battle-log-mode');
  assert.notEqual(await page.locator('[data-action="battle-log-mode"]')
    .getAttribute('aria-pressed'), logModeBefore, `${width}: 战报模式没有切换`);
  await stableNodesRemain(page, `${width} controls`);
  const afterLogToggle = await battleSnapshot(page);
  assert.equal(afterLogToggle.replay?.cursor, cursorAtPause,
    `${width}: 暂停/改速/切战报模式改变了 cursor`);
  assert.equal(afterLogToggle.rawText, saveBeforeControls,
    `${width}: 暂停/改速/切战报模式改变了游戏存档`);
  assert.equal(await readMotionKey(page, actor), triggerKey,
    `${width}: 战报切换重新发射了同一动作`);
  const animationCountAfterControls = await page.evaluate(({ frameIndex, actor, triggerKey }) =>
    window.__shanhaiMotionAudit.animations.filter(record =>
      record.frameIndex === frameIndex &&
      record.side === actor &&
      record.motion === 'strike' &&
      record.motionTrigger === triggerKey).length,
  { frameIndex: actionIndex, actor, triggerKey });
  assert.equal(animationCountAfterControls, sameActionAnimationCount,
    `${width}: pause/speed/log 对同一普攻重复发射了动作`);

  const pauseBehavior = await actorNode.evaluate(element => ({
    pausedAnimations: element.getAnimations({ subtree: true })
      .filter(animation => animation.playState === 'paused').length,
  }));
  assert.ok(pauseBehavior.pausedAnimations > 0,
    `${width}: 暂停后没有冻结实际动作动画`);
  const pausedSamples = await sampleStableRect(
    page,
    `.combatant[data-side="${actor}"] .fighter-art`,
    Math.max(120, Math.min(260, beatAt1x)),
  );
  const pausedRange = key => Math.max(...pausedSamples.map(item => item[key])) -
    Math.min(...pausedSamples.map(item => item[key]));
  assert.ok(pausedRange('x') <= 0.5 && pausedRange('y') <= 0.5,
    `${width}: 暂停后动作仍发生位移 ${JSON.stringify({
      x: pausedRange('x'),
      y: pausedRange('y'),
    })}`);

  await clickAction(page, 'battle-pause');
  assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'), 'false',
    `${width}: 恢复没有清除暂停标记`);
  await waitForFrameChange(page, actionIndex);
  await stableNodesRemain(page, `${width} next frame`);
}

async function waitUntilStable(page, durationFactor = 1.5) {
  await page.evaluate(durationFactor => {
    const shell = document.querySelector('.battle-shell');
    const beat = Number.parseFloat(shell?.style.getPropertyValue('--beat-duration') || '300');
    const duration = Math.max(260, beat * durationFactor);
    const arena = document.querySelector('.combat-arena');
    const startIndex = arena?.getAttribute('data-frame-index');
    return new Promise(resolve => {
      const start = performance.now();
      const sample = () => {
        if (performance.now() - start >= duration) {
          resolve({ duration, startIndex, endIndex: arena?.getAttribute('data-frame-index') });
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  }, durationFactor).then(result => {
    assert.equal(result.endIndex, result.startIndex,
      `预期暂停期间帧索引稳定 ${JSON.stringify(result)}`);
  });
}

async function assertModalAndTabPause(page, width) {
  await clickAction(page, 'settings');
  await page.locator('.modal-backdrop .modal[role="dialog"]').waitFor({ state: 'visible' });
  const modalCursor = (await battleSnapshot(page)).replay?.cursor;
  await waitUntilStable(page);
  assert.equal((await battleSnapshot(page)).replay?.cursor, modalCursor,
    `${width}: modal 打开时播放仍在推进`);
  await page.locator('.modal-backdrop .modal [data-action="modal-close"][data-autofocus]').click();
  await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
  await waitForFrameChange(page, modalCursor);

  const tabHost = width >= 1050 ? '.desktop-nav' : '.bottom-nav';
  await clickAction(page, 'tab', { id: 'build' });
  await page.locator('.game-layout.view-build').waitFor({ state: 'visible' });
  const cursorBeforeTab = (await battleSnapshot(page)).replay?.cursor;
  await waitUntilStable(page);
  assert.equal((await battleSnapshot(page)).replay?.cursor, cursorBeforeTab,
    `${width}: 离开战斗页后播放仍在推进`);
  await clickAction(page, 'tab', { id: 'journey' });
  await page.locator('.game-page.phase-battle').waitFor({ state: 'visible' });
  assert.equal(await page.locator(`${tabHost} [data-action="tab"][data-id="journey"]`)
    .getAttribute('aria-current'), 'page', `${width}: 未回到山河页`);
  await waitForFrameChange(page, cursorBeforeTab);
}

async function assertSkipIsPresentationOnly(page, snapshot, width) {
  const latest = await battleSnapshot(page);
  assert.equal(await savedText(page), latest.rawText, `${width}: skip 前存档读取不一致`);
  await clickAction(page, 'battle-pause');
  const beforeSkip = await battleSnapshot(page);
  const expectedResult = beforeSkip.result;
  const runSave = beforeSkip.rawText;
  const logDisclosure = page.locator('details[data-details="battle-log"]');
  if (!(await logDisclosure.getAttribute('open'))) await logDisclosure.locator('summary').click();
  assert.equal(await logDisclosure.getAttribute('open'), '',
    `${width}: 战报摘要没有展开完整回放`);
  await clickAction(page, 'battle-skip');
  await page.locator('[data-action="battle-finish"], [data-action="continue-battle"]')
    .first().waitFor({ state: 'visible' });
  const afterSkip = await battleSnapshot(page);
  assert.deepEqual(afterSkip.result, expectedResult,
    `${width}: skip 改变了 deterministic replay 结果`);
  assert.equal(afterSkip.rawText, runSave, `${width}: skip 改写了运行时存档`);
  assert.equal(afterSkip.replay?.cursor, afterSkip.frames.length - 1,
    `${width}: skip 没有移动到完整战斗末帧`);
  const log = page.locator('.battle-log');
  assert.equal(await log.locator('.battle-log-row').count(), afterSkip.frames.length,
    `${width}: 结算战报行数与重建帧数不一致`);
  const text = await log.textContent();
  const displayTexts = await page.evaluate(async frames => {
    const { localizeBattleText } = await import('/shanhai/localization.js');
    return frames.map(frame => localizeBattleText(frame.text));
  }, afterSkip.frames);
  const missing = displayTexts.filter(frameText => frameText && !text?.includes(frameText));
  assert.deepEqual(missing, [], `${width}: 完整战报遗漏真实 runtime 帧`);
  const savedAgain = await battleSnapshot(page);
  assert.deepEqual(savedAgain.result, expectedResult,
    `${width}: 结算后从空帧存档重建得到不同结果`);
  assert.deepEqual(savedAgain.raw.state.battle.frames, [],
    `${width}: 结算后存档意外写入预计算帧`);
}

async function assertFloatMoves(page, snapshot, width) {
  const index = findFrame(snapshot.frames, (frame, cursor) =>
    cursor > 0 && ['damage', 'dot'].includes(frame.kind) &&
    ['player', 'enemy'].some(side => frame[side].hp < snapshot.frames[cursor - 1][side].hp),
  '实际伤害/持续伤害');
  await setReplayCursor(page, index - 1);
  await waitForFrameIndex(page, index);
  const result = await motionSamples(page, { frameIndex: index, float: true });
  assert.ok(result.xMovement > 0.5 || result.yMovement > 0.5,
    `${width}: 实际 combat-float 没有位移 ${JSON.stringify(result.record)}`);
}

async function sampleStableRect(page, selector, duration = 240) {
  return page.evaluate(({ selector, duration }) => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing motion target ${selector}`);
    return new Promise(resolve => {
      const started = performance.now();
      const samples = [];
      const collect = () => {
        const rect = target.getBoundingClientRect();
        samples.push({
          time: performance.now(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          transform: getComputedStyle(target).transform,
        });
        if (performance.now() - started < duration) requestAnimationFrame(collect);
        else resolve(samples);
      };
      requestAnimationFrame(collect);
    });
  }, { selector, duration });
}

async function assertReducedMotion(browser, errors) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await installMotionInstrumentation(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(`reduced pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`reduced console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    errors.push(`reduced requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    const snapshot = await createRuntimeBattleFixture(
      page, 'RKF04', 'motion-reduced-real-dot', 0.2);
    const dotIndex = findFrame(snapshot.frames, frame => frame.kind === 'dot', 'reduced motion DOT');
    const actionIndex = findFrame(snapshot.frames, frame =>
      frame.kind === 'action' && expectedActionKind(frame) === 'basic',
    'reduced motion 普攻');

    await setReplayCursor(page, actionIndex - 1);
    await waitForFrameIndex(page, actionIndex);
    const actionFrame = snapshot.frames[actionIndex];
    assert.equal(await page.locator(`.combatant[data-side="${actionFrame.actor}"]`)
      .getAttribute('data-motion'), 'strike',
    'reduced-motion 普攻没有实际 combatant motion 状态');
    const actionSamples = await sampleStableRect(
      page, `.combatant[data-side="${actionFrame.actor}"] .fighter-art`, 280);
    const actionRange = key => Math.max(...actionSamples.map(item => item[key])) -
      Math.min(...actionSamples.map(item => item[key]));
    assert.ok(actionRange('x') <= 0.5 && actionRange('y') <= 0.5,
      `reduced motion 普攻仍发生位移 ${JSON.stringify({
        x: actionRange('x'),
        y: actionRange('y'),
      })}`);

    await setReplayCursor(page, dotIndex - 1);
    await waitForFrameIndex(page, dotIndex);
    assert.equal(await page.evaluate(() =>
      matchMedia('(prefers-reduced-motion: reduce)').matches), true,
    'reduced-motion context 没有生效');
    const dotSide = motionTarget(
      snapshot.frames[dotIndex], snapshot.frames[dotIndex - 1], 'dot');
    assert.ok(dotSide, 'reduced-motion DOT 帧没有目标');
    assert.equal(await page.locator(`.combatant[data-side="${dotSide}"]`)
      .getAttribute('data-motion'), 'dot', 'reduced-motion 动作没有呈现 DOT 状态');
    assert.ok(await page.locator('.combat-float').count() > 0,
      'reduced-motion 真实 DOT 帧没有 combat-float 节点');
    const [combatantSamples, floatSamples] = await Promise.all([
      sampleStableRect(page, `.combatant[data-side="${dotSide}"] .fighter-art`, 180),
      sampleStableRect(page, '.combat-float', 180),
    ]);
    for (const [label, samples] of [
      ['combatant action', combatantSamples],
      ['combat-float', floatSamples],
    ]) {
      const range = selector => Math.max(...samples.map(item => item[selector])) -
        Math.min(...samples.map(item => item[selector]));
      assert.ok(range('x') <= 0.5 && range('y') <= 0.5,
        `reduced motion ${label} 仍发生位移 ${JSON.stringify({ x: range('x'), y: range('y') })}`);
    }
    const style = await page.locator('.combat-float').evaluate(element => ({
      animationName: getComputedStyle(element).animationName,
      animationDuration: getComputedStyle(element).animationDuration,
      transform: getComputedStyle(element).transform,
    }));
    assert.ok(style.animationDuration === '0.001ms' || style.animationDuration === '0s' ||
      style.animationName === 'none',
    `reduced-motion float 动画没有被收敛 ${JSON.stringify(style)}`);
    await page.screenshot({
      path: path.join(screenshotDir, '390-reduced-motion.png'),
      fullPage: true,
    });
    await assertNoPageIssues(page, errors, '390 reduced-motion');
  } finally {
    await context.close();
  }
}

async function runViewport(browser, width, height, includeDeepChecks) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await installMotionInstrumentation(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  try {
    let snapshot;
    await check(`${width} real steady first battle and stable frame contract`, async () => {
      snapshot = await assertSteadyFirstBattle(page, width);
      assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'),
        'false', `${width}: 新战斗错误处于暂停`);
      await clickAction(page, 'battle-pause');
      const currentIndex = Number(await page.locator('.combat-arena').getAttribute('data-frame-index'));
      await assertFrameContract(page, currentIndex, snapshot.frames, `${width} opening frame`);
      assert.ok(snapshot.frames.some((frame, index) =>
        index > 0 && frame.kind === 'action' && expectedActionKind(frame) === 'rage'),
      `${width}: steady 首战没有真实怒技`);
      assert.ok(snapshot.frames.some((frame, index) =>
        index > 0 && frame.kind === 'shield' &&
        ['player', 'enemy'].some(side =>
          deltaFor(frame, snapshot.frames[index - 1], side, 'shield') > 0)),
      `${width}: steady 首战没有真实护盾`);
      await assertNoPageIssues(page, errors, width);
      await page.screenshot({
        path: path.join(screenshotDir, `${width}-steady-first-battle.png`),
        fullPage: true,
      });
      return {
        frameCount: snapshot.frames.length,
        outcome: snapshot.result.outcome,
        rounds: snapshot.result.rounds,
      };
    });

    if (includeDeepChecks) {
      await check(`${width} DOM identity, motion restart, and rage interpolation`, async () => {
        await assertRageInterpolation(page, snapshot, width);
        await assertControlTimingAndReplay(page, snapshot, width);
        return { frames: snapshot.frames.length };
      });
      await check(`${width} modal/tab pause and deterministic skip history`, async () => {
        await assertModalAndTabPause(page, width);
        await assertSkipIsPresentationOnly(page, snapshot, width);
      });
      await check(`${width} runtime shield/heal/DOT fixtures`, async () => {
        const fixtures = await assertFixtureCoverage(page);
        await assertFloatMoves(page, fixtures.dotSnapshot, width);
        return {
          frames: {
            shield: fixtures.shieldSnapshot.frames.length,
            heal: fixtures.healSnapshot.frames.length,
            dot: fixtures.dotSnapshot.frames.length,
          },
        };
      });
    } else {
      await check(`${width} responsive speed/pause/log/skip controls`, async () => {
        assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'), 'true');
        const before = await battleSnapshot(page);
        await clickAction(page, 'battle-speed', { speed: 2 });
        const logDisclosure = page.locator('details[data-details="battle-log"]');
        assert.equal(await logDisclosure.getAttribute('open'), null,
          `${width}: 战报应默认折叠`);
        await logDisclosure.locator('summary').click();
        await clickAction(page, 'battle-log-mode');
        const after = await battleSnapshot(page);
        assert.equal(after.replay?.cursor, before.replay?.cursor,
          `${width}: 控件改变了播放 cursor`);
        assert.equal(after.rawText, before.rawText, `${width}: 控件改变了存档`);
        await clickAction(page, 'battle-skip');
        await page.locator('[data-action="battle-finish"], [data-action="continue-battle"]')
          .first().waitFor({ state: 'visible' });
        assert.deepEqual((await battleSnapshot(page)).result, before.result,
          `${width}: skip 改变确定性结果`);
        await assertNoPageIssues(page, errors, width);
      });
    }
  } catch (error) {
    failures.push({
      viewport: width,
      message: error instanceof Error ? error.message : String(error),
      phase: await page.locator('.game-page').getAttribute('class').catch(() => null),
    });
    throw error;
  } finally {
    browserErrors.push(...errors.map(message => `${width}: ${message}`));
    await context.close();
  }
}

async function run() {
  await mkdir(reportDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  try {
    await runViewport(browser, 1440, 1000, true);
    await runViewport(browser, 390, 844, false);
    await check('reduced-motion keeps actual combatant and float geometry still', async () => {
      await assertReducedMotion(browser, browserErrors);
    });
  } catch (error) {
    failures.push({
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await browser.close();
    await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
      url,
      reportDir,
      generatedAt: new Date().toISOString(),
      viewports: [1440, 390],
      checks,
      browserErrors,
      failures,
    }, null, 2) + '\n');
  }
  if (browserErrors.length) {
    throw new Error(`Motion browser errors: ${JSON.stringify(browserErrors)}`);
  }
  if (failures.length) {
    throw new Error(`Motion browser failures: ${JSON.stringify(failures)}`);
  }
  console.log(`Motion browser report: ${reportDir}`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
