import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pauseNextReplay } from './shanhai-replay-fixture.mjs';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const saveKey = 'suishi-shanhai-run-v1';
const replayKey = 'suishi-shanhai-replay-v1';
const reportOverride = process.env.SHANHAI_ART_REPORT_DIR ||
  process.env.BROWSER_REPORT_DIR || process.env.BROWSER_OUTPUT_DIR;
const reportDir = reportOverride
  ? path.resolve(reportOverride)
  : await mkdtemp(path.join(os.tmpdir(), 'shanhai-art-'));
const screenshotDir = path.join(reportDir, 'screenshots');
const checks = [];
const errors = [];
const screenshots = [];

function playwrightModule() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    '/opt/tools/browser-tools/node_modules/playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Keep looking in the configured local browser tools cache.
    }
  }
  throw new Error('Playwright is not installed in /opt/tools/browser-tools');
}

const { chromium } = playwrightModule();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/opt/tools/ms-playwright/chromium-1228/chrome-linux/chrome';

async function check(name, fn) {
  try {
    const details = await fn();
    checks.push({ name, ok: true, ...(details ? { details } : {}) });
    console.log(`ok - ${name}`);
    return details;
  } catch (error) {
    checks.push({
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function waitForApp(page) {
  await page.locator('#shanhai-app').waitFor({ state: 'visible' });
  await page.locator('.landing-page, .game-page').first().waitFor({ state: 'visible' });
}

async function waitForPhase(page, phase) {
  await page.locator(`.game-page.phase-${phase}`).waitFor({ state: 'visible' });
}

async function clickAction(page, action, attributes = {}) {
  const candidates = page.locator(`[data-action="${action}"]`);
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible()) || await candidate.isDisabled()) continue;
    let matches = true;
    for (const [key, value] of Object.entries(attributes)) {
      if (await candidate.getAttribute(`data-${key}`) !== String(value)) {
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

async function openLanding(page, label) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);
  await page.locator('.method-choice[data-id="RKF01"]').waitFor({ state: 'visible' });
  return label;
}

async function waitForArtReady(page) {
  await page.locator('.combat-arena[data-art-ready="true"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas[data-game-battle]');
    return typeof canvas?.getFrameSnapshot === 'function';
  }, null, { polling: 'raf' });
}

async function waitForFrameIndex(page, index) {
  await page.waitForFunction(expected =>
    Number(document.querySelector('.combat-arena')?.getAttribute('data-frame-index')) === expected,
  index, { polling: 'raf' });
}

async function getBattleMeta(page) {
  return page.evaluate(async ({ saveKey, replayKey }) => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    if (!game || game.state.phase !== 'battle' || !game.state.battle?.frames?.length) {
      throw new Error('真实命途没有重建出战斗帧');
    }
    const frames = game.state.battle.frames;
    const basicIndices = [];
    const rageIndices = { player: [], enemy: [] };
    for (let index = 1; index < frames.length; index += 1) {
      const frame = frames[index];
      if (frame.kind !== 'action' || !frame.actor) continue;
      if (frame[frame.actor]?.lockedAction === 'rage_action' || /怒技/.test(frame.text)) {
        rageIndices[frame.actor].push(index);
      }
      if (frame[frame.actor]?.lockedAction === 'basic_action' || /普攻/.test(frame.text)) {
        basicIndices.push(index);
      }
    }
    const state = game.state;
    const key = `${state.id}:${state.act}:${state.step}:${frames.length}`;
    const raw = JSON.parse(localStorage.getItem(saveKey) || 'null');
    return {
      state: {
        id: state.id,
        act: state.act,
        step: state.step,
        phase: state.phase,
        method: state.method,
        outcome: state.battle.outcome,
        rounds: state.battle.rounds,
      },
      savedFrameCount: raw?.state?.battle?.frames?.length ?? -1,
      key,
      replay: JSON.parse(localStorage.getItem(replayKey) || 'null'),
      frameCount: frames.length,
      rageIndices,
      basicIndices,
      frames,
    };
  }, { saveKey, replayKey });
}

async function saveReplayCursor(page, meta, cursor) {
  await page.evaluate(({ replayKey, key, frameCount, cursor }) => {
    localStorage.setItem(replayKey, JSON.stringify({
      key,
      cursor: Math.max(0, Math.min(frameCount - 1, Math.floor(cursor))),
    }));
  }, { replayKey, key: meta.key, frameCount: meta.frameCount, cursor });
}

async function seekPausedCursor(page, meta, cursor, { artReady = true } = {}) {
  await saveReplayCursor(page, meta, cursor);
  await pauseNextReplay(page);
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);
  await waitForPhase(page, 'battle');
  await page.locator('.battle-shell[data-paused="true"]').waitFor();
  if (artReady === 'settled') {
    await page.waitForTimeout(500);
  } else if (artReady) {
    await waitForArtReady(page);
  } else {
    await page.waitForFunction(() => {
      const arena = document.querySelector('.combat-arena');
      return Boolean(arena && arena.getAttribute('data-art-ready') !== 'true');
    },
    null, { polling: 'raf' });
  }
  await waitForFrameIndex(page, cursor);
}

async function armPauseAtFrame(page, index) {
  await page.evaluate(target => {
    const marker = { target, pausedAt: null };
    window.__shanhaiPauseAtFrame = marker;
    const deadline = performance.now() + 5000;
    const poll = () => {
      if (marker.pausedAt !== null || performance.now() > deadline) return;
      const arena = document.querySelector('.combat-arena');
      const shell = document.querySelector('.battle-shell');
      if (Number(arena?.getAttribute('data-frame-index')) === target &&
          shell?.getAttribute('data-paused') !== 'true') {
        const button = document.querySelector('[data-action="battle-pause"]');
        if (button instanceof HTMLButtonElement) {
          button.click();
          if (document.querySelector('.battle-shell')?.getAttribute('data-paused') === 'true') {
            marker.pausedAt = performance.now();
            return;
          }
        }
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }, index);
}

async function startRealBattle(page, { method = 'RKF01', seed = 'art-rage-player-enemy' } = {}) {
  await page.locator(`.method-choice[data-id="${method}"]`).click();
  await page.locator('[name="player-name"]').fill('手绘验收行者');
  await page.locator('[name="seed"]').fill(seed);
  await clickAction(page, 'start');
  await waitForPhase(page, 'map');

  const combatNode = page.locator('.map-node.available[data-node-type="C"]:not([disabled])').first();
  await combatNode.waitFor({ state: 'visible' });
  await combatNode.scrollIntoViewIfNeeded();
  await combatNode.click();
  await page.locator('.node-preview-dialog').waitFor({ state: 'visible' });
  await clickAction(page, 'confirm-node');
  await waitForPhase(page, 'preview');
  await clickAction(page, 'fight');
  await waitForPhase(page, 'battle');
  await page.locator('.battle-shell').waitFor({ state: 'visible' });
  await clickAction(page, 'battle-pause');
  await page.locator('.battle-shell[data-paused="true"]').waitFor();

  const meta = await getBattleMeta(page);
  assert.equal(meta.state.method, method, '实际启动的命途没有使用所选功法');
  assert.equal(meta.savedFrameCount, 0, '战斗帧应由真实 replay 重建，而非写入 fixture');
  assert.ok(['player', 'enemy', 'draw'].includes(meta.state.outcome),
    `真实战斗 outcome 无效 ${meta.state.outcome}`);
  assert.ok(meta.basicIndices.length > 0, '真实首战没有普通攻击');
  assert.ok(meta.rageIndices.player.length > 0, '真实首战没有我方怒技');
  assert.ok(meta.rageIndices.enemy.length > 0, '真实首战没有敌方怒技');
  return meta;
}

async function inspectPngImage(page, selector, label) {
  const image = page.locator(selector).first();
  await image.waitFor({ state: 'visible' });
  const result = await image.evaluate(async element => {
    const rect = element.getBoundingClientRect();
    const viewport = { width: innerWidth, height: innerHeight };
    const intersection = {
      width: Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0)),
      height: Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0)),
    };
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!(element instanceof HTMLImageElement) || !element.complete ||
        !element.naturalWidth || !element.naturalHeight || !context) {
      return {
        source: element.getAttribute('src'),
        complete: element.complete,
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        intersection,
      };
    }
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    let visiblePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 16) visiblePixels += 1;
      colors.add(`${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`);
    }
    return {
      source: element.currentSrc || element.src,
      complete: element.complete,
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      intersection,
      visiblePixels,
      colorBuckets: colors.size,
    };
  });
  assert.match(result.source || '', /\.png(?:$|[?#])/i, `${label}: 场景不是 PNG ${JSON.stringify(result)}`);
  assert.ok(result.complete && result.naturalWidth > 0 && result.naturalHeight > 0,
    `${label}: PNG 场景没有解码 ${JSON.stringify(result)}`);
  assert.ok(result.rect.width > 0 && result.rect.height > 0 &&
    result.intersection.width > 1 && result.intersection.height > 1,
  `${label}: PNG 场景没有出现在当前视口 ${JSON.stringify(result)}`);
  assert.ok(result.visiblePixels > 1000 && result.colorBuckets > 12,
    `${label}: PNG 场景没有实际绘制内容 ${JSON.stringify(result)}`);
  return result;
}

async function inspectBattleCanvas(page, label) {
  const result = await page.locator('canvas[data-game-battle]').evaluate(canvas => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    const snapshot = canvas.getFrameSnapshot?.() || null;
    const context2d = !gl ? canvas.getContext('2d') : null;
    if (!gl && !context2d) {
      return {
        ready: canvas.closest('.combat-arena')?.getAttribute('data-art-ready'),
        width: canvas.width,
        height: canvas.height,
        snapshot,
        error: 'No drawable canvas context',
      };
    }
    const width = gl?.drawingBufferWidth ?? canvas.width;
    const height = gl?.drawingBufferHeight ?? canvas.height;
    const pixels = gl ? new Uint8Array(width * height * 4) :
      context2d.getImageData(0, 0, width, height).data;
    if (gl) gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonTransparent = 0;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 12) nonTransparent += 1;
      if (pixels[index + 3] > 12) {
        colors.add(`${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`);
      }
    }
    return {
      ready: canvas.closest('.combat-arena')?.getAttribute('data-art-ready'),
      width,
      height,
      nonTransparent,
      colorBuckets: colors.size,
      snapshot,
      renderer: gl ? 'webgl' : 'canvas2d',
    };
  });
  assert.equal(result.ready, 'true', `${label}: 战斗绘制器没有就绪`);
  assert.equal(result.error, undefined, `${label}: ${result.error}`);
  assert.ok(result.width > 100 && result.height > 80,
    `${label}: Canvas 绘制缓冲尺寸异常 ${JSON.stringify(result)}`);
  assert.ok(result.nonTransparent > 1000 && result.colorBuckets > 12,
    `${label}: Canvas 没有完整的非空人物像素 ${JSON.stringify(result)}`);
  assert.ok(result.snapshot?.player && result.snapshot?.enemy,
    `${label}: 缺少双角色真实帧快照 ${JSON.stringify(result.snapshot)}`);
  for (const side of ['player', 'enemy']) {
    assert.ok(result.snapshot[side].pose && result.snapshot[side].scale > 0,
      `${label}: ${side} 没有可见姿态/缩放 ${JSON.stringify(result.snapshot[side])}`);
  }
  return result;
}

async function capture(page, fileName) {
  const filePath = path.join(screenshotDir, fileName);
  await page.screenshot({ path: filePath, animations: 'disabled' });
  screenshots.push(filePath);
  return filePath;
}

async function checkMethodSkins(page) {
  const ids = ['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05'];
  const results = [];
  for (const id of ids) {
    await page.locator(`.method-choice[data-id="${id}"]`).click();
    await page.waitForFunction(expected =>
      document.querySelector('canvas[data-game-start]')?.dataset.playerSkin === expected,
    id, { polling: 'raf' });
    const result = await page.evaluate(expected => {
      const canvas = document.querySelector('canvas[data-game-start]');
      const stage = document.querySelector('.hero-card-stage');
      const fallback = stage?.querySelector('.character-art');
      const artSkin = fallback?.getAttribute('data-art-skin');
      const stature = Number.parseFloat(fallback?.style.getPropertyValue('--stature') || 'NaN');
      return {
        canvasSkin: canvas?.dataset.playerSkin,
        canvasArtReady: stage?.getAttribute('data-art-ready'),
        fallbackSkin: artSkin,
        stature,
        requestedSkin: expected,
      };
    }, id);
    assert.equal(result.canvasSkin, id, `${id}: 开局 canvas 使用了错误功法皮肤`);
    assert.equal(result.fallbackSkin, id, `${id}: 静态 fallback 使用了错误功法皮肤`);
    assert.ok(Number.isFinite(result.stature) && result.stature > 0,
      `${id}: 缺少归一身高比例 ${JSON.stringify(result)}`);
    results.push(result);
  }
  assert.deepEqual(results.map(item => item.canvasSkin), ids,
    '五门开局功法没有五种独立手绘皮肤');

  const manifest = await page.evaluate(async () => {
    const response = await fetch('/assets/frames.json');
    if (!response.ok) throw new Error(`frames manifest HTTP ${response.status}`);
    const value = await response.json();
    return {
      approval: value.approval,
      targetBodyHeight: value.targetBodyHeight,
      characters: Object.fromEntries(['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05']
        .map(id => [id, value.characters[id]])),
    };
  });
  assert.equal(manifest.approval, 'approved', '手绘帧 manifest 未标为 approved');
  const normalized = [];
  for (const id of ids) {
    const character = manifest.characters[id];
    const scale = results.find(item => item.canvasSkin === id).stature;
    const bodyHeight = character?.bodyHeight;
    const renderedBodyHeight = bodyHeight * scale;
    assert.ok(Number.isFinite(bodyHeight) && bodyHeight > 0,
      `${id}: frames manifest 缺少有效 bodyHeight`);
    assert.ok(Math.abs(renderedBodyHeight - manifest.targetBodyHeight) < 1,
      `${id}: 开局 fallback 身高没有归一 ${renderedBodyHeight}/${manifest.targetBodyHeight}`);
    normalized.push({ id, bodyHeight, scale, renderedBodyHeight });
  }
  assert.equal(new Set(ids.map(id => manifest.characters[id].src)).size, ids.length,
    '五门开局功法复用了相同 PNG 皮肤资源');
  return { skins: results, normalized, targetBodyHeight: manifest.targetBodyHeight };
}

async function startAndSeekPage(browser, viewport, label, { reducedMotion = false } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    ...(reducedMotion ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push({ label, type: 'pageerror', message: error.message }));
  await openLanding(page, label);
  await inspectPngImage(page, '.landing-atmosphere .game-scene', `${label} start scene`);
  const meta = await startRealBattle(page);
  const initialCursor = meta.rageIndices.player[0] - 1;
  await seekPausedCursor(page, meta, initialCursor);
  await waitForArtReady(page);
  return { context, page, meta };
}

async function captureRageAction(page, meta, side, label) {
  const index = meta.rageIndices[side][0];
  const actor = meta.frames[index].actor;
  await seekPausedCursor(page, meta, index - 1);
  await armPauseAtFrame(page, index);
  await clickAction(page, 'battle-pause');
  await page.waitForFunction(expectedIndex => {
    const marker = window.__shanhaiPauseAtFrame;
    return marker?.target === expectedIndex && marker.pausedAt !== null &&
      Number(document.querySelector('.combat-arena')?.getAttribute('data-frame-index')) === expectedIndex &&
      document.querySelector('.battle-shell')?.getAttribute('data-paused') === 'true';
  }, index, { polling: 'raf' });
  await page.waitForFunction(expectedSide => {
    const snapshot = document.querySelector('canvas[data-game-battle]')?.getFrameSnapshot?.();
    return snapshot?.[expectedSide]?.action === 'rage' &&
      snapshot?.[expectedSide]?.effect?.action === 'rage';
  }, side, { polling: 'raf' });
  await page.evaluate(expectedSide => {
    window.__shanhaiRagePeak = false;
    const sample = () => {
      const actor = document.querySelector('canvas[data-game-battle]')
        ?.getFrameSnapshot?.()?.[expectedSide];
      if (actor?.action === 'rage' && actor.elapsed >= 260) {
        document.querySelector('[data-action="battle-pause"]').click();
        window.__shanhaiRagePeak = true;
      } else {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  }, side);
  await clickAction(page, 'battle-pause');
  await page.waitForFunction(() => window.__shanhaiRagePeak &&
    document.querySelector('.battle-shell')?.getAttribute('data-paused') === 'true');
  const snapshot = await page.locator('canvas[data-game-battle]').evaluate(canvas =>
    canvas.getFrameSnapshot?.() || null);
  assert.equal(snapshot?.[side]?.action, 'rage',
    `${label}: ${side} 动作没有进入怒技姿势 ${JSON.stringify(snapshot)}`);
  assert.equal(snapshot?.[side]?.effect?.action, 'rage',
    `${label}: ${side} 怒技没有 Canvas 特效 ${JSON.stringify(snapshot)}`);
  assert.ok(snapshot[side].effect.phase &&
    snapshot[side].effect.palette && snapshot[side].effect.motif,
  `${label}: ${side} 怒技特效没有形状/颜色状态 ${JSON.stringify(snapshot[side].effect)}`);
  return { index, actor, snapshot };
}

async function assertControlsKeepAction(page, side, baseline, label) {
  const stableAction = async operation => {
    await operation();
    const current = await page.locator('canvas[data-game-battle]').evaluate(canvas =>
      canvas.getFrameSnapshot?.() || null);
    assert.deepEqual(current, baseline,
      `${label}: 控制操作重置/推进了绘制动作\nbefore=${JSON.stringify(baseline)}\nafter=${JSON.stringify(current)}`);
  };
  const cursor = await page.locator('.combat-arena').getAttribute('data-frame-index');
  await stableAction(() => clickAction(page, 'battle-speed', { speed: 2 }));
  assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'), 'true',
    `${label}: 改倍速解除暂停`);
  await clickAction(page, 'battle-details', { tab: 'log' });
  const modal = page.locator('.battle-detail-dialog');
  await modal.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.battle-shell').getAttribute('data-paused'), 'true',
    `${label}: 查看详情没有保持暂停`);
  const logMode = modal.locator('[data-action="battle-log-mode"]');
  const beforeMode = await logMode.getAttribute('aria-pressed');
  await stableAction(() => clickAction(page, 'battle-log-mode'));
  assert.notEqual(await modal.locator('[data-action="battle-log-mode"]').getAttribute('aria-pressed'),
    beforeMode, `${label}: 战报详情切换没有生效`);
  await stableAction(() => clickAction(page, 'modal-close'));
  await modal.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.combat-arena').getAttribute('data-frame-index'), cursor,
    `${label}: 暂停/详情/倍速改写了真实 replay frame`);
  const sideSnapshot = baseline[side];
  assert.equal(sideSnapshot.action, 'rage', `${label}: 基线不是怒技动作`);
}

async function assertSkipCleansEffects(page, meta, label) {
  await clickAction(page, 'battle-skip');
  await page.locator('[data-control-cta][data-action="battle-finish"]').waitFor({ state: 'visible' });
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-game-battle]');
    const snapshot = canvas?.getFrameSnapshot?.() || null;
    return {
      finished: !document.querySelector('[data-action="battle-skip"]'),
      frameIndex: Number(document.querySelector('.combat-arena')?.getAttribute('data-frame-index')),
      artReady: document.querySelector('.combat-arena')?.getAttribute('data-art-ready'),
      actions: snapshot ? {
        player: snapshot.player?.action,
        enemy: snapshot.enemy?.action,
      } : null,
      effects: snapshot ? {
        player: snapshot.player?.effect,
        enemy: snapshot.enemy?.effect,
      } : null,
      vfxNodes: document.querySelectorAll('.combat-vfx').length,
    };
  });
  assert.equal(result.finished, true, `${label}: 跳至结算后仍显示 skip`);
  assert.equal(result.frameIndex, meta.frameCount - 1,
    `${label}: 跳过没有到真实战斗结算帧`);
  assert.equal(result.artReady, 'true', `${label}: skip 后丢失 Canvas`);
  assert.deepEqual(result.actions, { player: 'idle', enemy: 'idle' },
    `${label}: skip 后残留动作 ${JSON.stringify(result.actions)}`);
  assert.deepEqual(result.effects, { player: null, enemy: null },
    `${label}: skip 后残留 RageFX ${JSON.stringify(result.effects)}`);
  assert.equal(result.vfxNodes, 0, `${label}: skip 后残留 DOM 战斗特效`);
  return result;
}

async function assertFallbackPose(page, label) {
  await page.locator('.combat-arena').waitFor({ state: 'visible' });
  await page.locator('.combatant .character-art').nth(1).waitFor({ state: 'attached' });
  const result = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas[data-game-battle]');
    const manifestResponse = await fetch('/assets/frames.json');
    const manifest = await manifestResponse.json();
    const characters = [...document.querySelectorAll('.combatant')].map(fighter => {
      const side = fighter.getAttribute('data-side');
      const art = fighter.querySelector('.character-art');
      const artContainer = art?.closest('.fighter-art');
      const cel = art?.querySelector('.character-cel');
      const style = cel ? getComputedStyle(cel) : null;
      const background = style?.backgroundImage || '';
      const source = background.match(/url\(["']?(.*?)["']?\)/)?.[1] || '';
      const id = art?.getAttribute('data-art-skin') || '';
      const character = manifest.characters[id];
      return {
        side,
        id,
        source,
        visible: Boolean(art && artContainer &&
          getComputedStyle(art).visibility !== 'hidden' &&
          getComputedStyle(artContainer).visibility !== 'hidden' &&
          art.getBoundingClientRect().width > 18 && art.getBoundingClientRect().height > 28),
        artContainerVisibility: artContainer ? getComputedStyle(artContainer).visibility : null,
        stature: Number.parseFloat(art?.style.getPropertyValue('--stature') || 'NaN'),
        frame: character?.frames?.[0],
        authoredBounds: character?.cels?.[0]?.bounds,
        bodyHeight: character?.bodyHeight,
        targetBodyHeight: manifest.targetBodyHeight,
      };
    });
    const poses = [];
    for (const character of characters) {
      const image = new Image();
      image.src = character.source;
      await image.decode();
      const [x, y, width, height] = character.frame || [];
      const canvas = document.createElement('canvas');
      canvas.width = width || 1;
      canvas.height = height || 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, x, y, width, height, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      let opaque = 0;
      let top = height;
      let bottom = -1;
      let left = width;
      let right = -1;
      for (let py = 0; py < height; py += 1) {
        for (let px = 0; px < width; px += 1) {
          if (pixels[(py * width + px) * 4 + 3] <= 16) continue;
          opaque += 1;
          top = Math.min(top, py);
          bottom = Math.max(bottom, py);
          left = Math.min(left, px);
          right = Math.max(right, px);
        }
      }
      poses.push({
        ...character,
        decoded: image.complete && image.naturalWidth > 0,
        opaque,
        silhouetteBounds: { left, top, right, bottom },
        frameSize: { width, height },
      });
    }
    return {
      artReady: document.querySelector('.combat-arena')?.dataset.artReady,
      canvasEngine: canvas?.dataset.engine || null,
      characters,
      poses,
    };
  });
  assert.notEqual(result.artReady, 'true',
    `${label}: 绘制层仍然就绪 (${result.canvasEngine || 'unknown renderer'}); 应显示静态 .character-art fallback ${JSON.stringify(result.characters)}`);
  assert.deepEqual(result.characters.map(item => item.side).sort(), ['enemy', 'player'],
    `${label}: fallback 没有两侧立绘`);
  for (const pose of result.poses) {
    assert.ok(pose.visible, `${label}: ${pose.side} 完整姿态 fallback 不可见 ${JSON.stringify(pose)}`);
    assert.match(pose.source, /\.png(?:$|[?#])/i,
      `${label}: ${pose.side} fallback 不是 PNG ${JSON.stringify(pose)}`);
    assert.ok(pose.decoded && pose.opaque > 10000,
      `${label}: ${pose.side} fallback PNG 没有有效人物像素 ${JSON.stringify(pose)}`);
    const bounds = pose.silhouetteBounds;
    assert.ok([bounds.left, bounds.top, bounds.right + 1, bounds.bottom + 1]
      .every((value, index) => Math.abs(value - pose.authoredBounds[index]) <= 2),
    `${label}: ${pose.side} fallback 与完整姿态边界不符 ${JSON.stringify(pose)}`);
    assert.ok(bounds.left > 0 && bounds.top > 0 &&
      bounds.right < pose.frameSize.width - 1 && bounds.bottom < pose.frameSize.height - 1,
    `${label}: ${pose.side} fallback 在帧格边缘被裁切 ${JSON.stringify(bounds)}`);
    assert.ok(Math.abs(pose.bodyHeight * pose.stature - pose.targetBodyHeight) < 1,
      `${label}: ${pose.side} fallback 姿态高度未归一`);
  }
  return result;
}

async function assertFallbackCanSkip(page, label) {
  await clickAction(page, 'battle-skip');
  await page.locator('[data-control-cta][data-action="battle-finish"]').waitFor({ state: 'visible' });
  const result = await page.evaluate(() => ({
    phase: document.querySelector('.game-page')?.getAttribute('data-phase'),
    frameIndex: Number(document.querySelector('.combat-arena')?.getAttribute('data-frame-index')),
    arts: [...document.querySelectorAll('.combatant .character-art')].map(art => {
      const container = art.closest('.fighter-art');
      return {
        art: getComputedStyle(art).visibility,
        container: container ? getComputedStyle(container).visibility : null,
      };
    }),
  }));
  assert.equal(result.phase, 'battle', `${label}: 降级战斗离开了真实 battle 阶段`);
  assert.ok(result.frameIndex > 0, `${label}: fallback 战斗没有真实回放帧`);
  assert.ok(result.arts.length === 2 &&
    result.arts.every(value => value.art !== 'hidden' && value.container !== 'hidden'),
    `${label}: skip 后静态人物姿态不完整 ${JSON.stringify(result.arts)}`);
  return result;
}

async function runViewport(browser, viewport, label, verifyMethods = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push({ label, type: 'pageerror', message: error.message }));
  try {
    await openLanding(page, label);
    const landingScene = await inspectPngImage(
      page, '.landing-atmosphere .game-scene', `${label} landing scene`,
    );
    let methods;
    if (verifyMethods) methods = await checkMethodSkins(page);
    else {
      await page.locator('.method-choice[data-id="RKF01"]').click();
    }

    const meta = await startRealBattle(page);
    await seekPausedCursor(page, meta, meta.rageIndices.player[0] - 1);
    await inspectPngImage(page, '.combat-arena .game-scene', `${label} battle scene`);
    const pixels = await inspectBattleCanvas(page, label);
    const screenshot = await capture(page, `${label}-battle-canvas.png`);
    return { context, page, meta, landingScene, methods, pixels, screenshot };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function run() {
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
      '--enable-unsafe-swiftshader',
    ],
  });
  const summaries = [];
  let runFailure = null;
  try {
    const desktop = await runViewport(browser, { width: 1440, height: 900 }, '1440x900', true);
    summaries.push({
      viewport: '1440x900',
      landingScene: desktop.landingScene,
      methods: desktop.methods,
      canvas: desktop.pixels,
      screenshot: desktop.screenshot,
      state: desktop.meta.state,
      rageIndices: desktop.meta.rageIndices,
    });
    await check('1440x900: 五门功法皮肤互异且渲染身高归一', async () => desktop.methods);
    await check('1440x900: PNG 战斗场景与双人 WebGL Canvas 非空', async () => ({
      scene: await inspectPngImage(desktop.page, '.combat-arena .game-scene', '1440x900 battle'),
      canvas: desktop.pixels,
    }));

    const playerRage = await check('真实我方怒技使用青碧菱形 RageFX', async () => {
      const action = await captureRageAction(desktop.page, desktop.meta, 'player', '我方怒技');
      assert.equal(action.actor, 'player', '实际我方怒技 actor 不正确');
      assert.equal(action.snapshot.player.effect.palette, 'jade-cyan');
      assert.equal(action.snapshot.player.effect.motif, 'diamond');
      await capture(desktop.page, '1440x900-player-rage.png');
      return action.snapshot.player.effect;
    });
    await check('暂停、详情、倍速不会重置或推进怒技', async () => {
      const baseline = await desktop.page.locator('canvas[data-game-battle]').evaluate(canvas =>
        canvas.getFrameSnapshot?.() || null);
      await assertControlsKeepAction(desktop.page, 'player', baseline, '我方怒技 controls');
      return baseline.player;
    });

    const enemyRage = await check('真实敌方怒技使用朱金箭镞 RageFX', async () => {
      const action = await captureRageAction(desktop.page, desktop.meta, 'enemy', '敌方怒技');
      assert.equal(action.actor, 'enemy', '实际敌方怒技 actor 不正确');
      assert.equal(action.snapshot.enemy.effect.palette, 'vermilion-gold');
      assert.equal(action.snapshot.enemy.effect.motif, 'chevron');
      await capture(desktop.page, '1440x900-enemy-rage.png');
      return action.snapshot.enemy.effect;
    });
    assert.notDeepEqual(playerRage, enemyRage,
      '双方 RageFX 颜色/形状状态不能相同');

    await check('真实普通攻击没有 RageFX', async () => {
      const index = desktop.meta.basicIndices[0];
      const actor = desktop.meta.frames[index].actor;
      await seekPausedCursor(desktop.page, desktop.meta, index - 1);
      await armPauseAtFrame(desktop.page, index);
      await clickAction(desktop.page, 'battle-pause');
      await desktop.page.waitForFunction(expectedIndex => {
        const marker = window.__shanhaiPauseAtFrame;
        return marker?.target === expectedIndex && marker.pausedAt !== null &&
          Number(document.querySelector('.combat-arena')?.getAttribute('data-frame-index')) === expectedIndex &&
          document.querySelector('.battle-shell')?.getAttribute('data-paused') === 'true';
      }, index, { polling: 'raf' });
      await desktop.page.waitForFunction(side => {
        const snapshot = document.querySelector('canvas[data-game-battle]')?.getFrameSnapshot?.();
        return snapshot?.[side]?.action === 'attack';
      }, actor, { polling: 'raf' });
      const snapshot = await desktop.page.locator('canvas[data-game-battle]').evaluate(canvas =>
        canvas.getFrameSnapshot?.() || null);
      assert.equal(snapshot[actor].action, 'attack');
      assert.equal(snapshot[actor].effect, null,
        `${actor} 普攻错误创建了 RageFX ${JSON.stringify(snapshot[actor])}`);
      return { actor, action: snapshot[actor] };
    });

    await check('跳至结算会清理怒技动作与特效', async () => {
      await captureRageAction(desktop.page, desktop.meta, 'player', 'skip cleanup');
      const result = await assertSkipCleansEffects(desktop.page, desktop.meta, '1440x900');
      await capture(desktop.page, '1440x900-skip-settlement.png');
      return result;
    });
    await desktop.context.close();

    for (const [width, height] of [[390, 844], [360, 780]]) {
      const result = await runViewport(
        browser, { width, height }, `${width}x${height}`, false,
      );
      summaries.push({
        viewport: `${width}x${height}`,
        landingScene: result.landingScene,
        canvas: result.pixels,
        screenshot: result.screenshot,
        state: result.meta.state,
        rageIndices: result.meta.rageIndices,
      });
      await check(`${width}x${height}: PNG 场景与完整双人 Canvas 可见`, async () => ({
        scene: await inspectPngImage(result.page, '.combat-arena .game-scene', `${width}x${height}`),
        canvas: result.pixels,
      }));
      await result.context.close();
    }

    const reduced = await startAndSeekPage(
      browser, { width: 390, height: 844 }, 'reduced-motion', { reducedMotion: true },
    );
    try {
      await check('prefers-reduced-motion 下人物绘制静止', async () => {
        const index = reduced.meta.rageIndices.player[0];
        await seekPausedCursor(reduced.page, reduced.meta, index - 1);
        await clickAction(reduced.page, 'battle-pause');
        await waitForFrameIndex(reduced.page, index);
        await reduced.page.waitForTimeout(240);
        const first = await reduced.page.locator('canvas[data-game-battle]').evaluate(canvas => ({
          snapshot: canvas.getFrameSnapshot?.() || null,
          actions: [canvas.dataset.playerAction, canvas.dataset.enemyAction],
        }));
        await reduced.page.waitForTimeout(220);
        const second = await reduced.page.locator('canvas[data-game-battle]').evaluate(canvas => ({
          snapshot: canvas.getFrameSnapshot?.() || null,
          actions: [canvas.dataset.playerAction, canvas.dataset.enemyAction],
        }));
        assert.deepEqual(second.actions, ['idle', 'idle'],
          `减弱动态仍触发了动作 ${JSON.stringify(second.actions)}`);
        for (const side of ['player', 'enemy']) {
          assert.equal(first.snapshot[side].action, 'idle');
          assert.equal(first.snapshot[side].pose, 'ready');
          assert.equal(first.snapshot[side].elapsed, 0);
          assert.equal(second.snapshot[side].action, 'idle');
          assert.equal(second.snapshot[side].pose, 'ready');
          assert.equal(second.snapshot[side].elapsed, 0);
          assert.deepEqual(second.snapshot[side].effect, null);
        }
        assert.equal(second.snapshot.clock, first.snapshot.clock,
          `减弱动态 Canvas 时钟仍在推进 ${first.snapshot.clock}/${second.snapshot.clock}`);
        const screenshot = await capture(reduced.page, '390x844-reduced-motion.png');
        return second;
      });
    } finally {
      await reduced.context.close();
    }

    const resourceFailureContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    const resourcePage = await resourceFailureContext.newPage();
    resourcePage.setDefaultTimeout(20000);
    resourcePage.on('pageerror', error =>
      errors.push({ label: 'resource-failure', type: 'pageerror', message: error.message }));
    await resourcePage.route('**/shanhai/animation.js', route => route.abort());
    try {
      await openLanding(resourcePage, 'resource-failure');
      await inspectPngImage(resourcePage, '.landing-atmosphere .game-scene', 'resource failure start');
      await resourcePage.locator('.method-choice[data-id="RKF01"]').click();
      await resourcePage.locator('.hero-card-stage .character-art').waitFor({ state: 'visible' });
      const startFallback = await resourcePage.locator('.hero-card-stage .character-art')
        .evaluate(art => ({
          visible: getComputedStyle(art).visibility !== 'hidden',
          skin: art.getAttribute('data-art-skin'),
          image: getComputedStyle(art.querySelector('.character-cel')).backgroundImage,
          bounds: (() => {
            const rect = art.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })(),
        }));
      assert.ok(startFallback.visible && startFallback.bounds.height > 40,
        `启动资源失败后没有可见完整姿态 ${JSON.stringify(startFallback)}`);
      assert.match(startFallback.image, /\.png(?:["')]|$)/i,
        `启动 fallback PNG 缺失 ${JSON.stringify(startFallback)}`);
      const resourceMeta = await startRealBattle(resourcePage);
      await seekPausedCursor(
        resourcePage, resourceMeta, resourceMeta.rageIndices.player[0] - 1, { artReady: false },
      );
      const fallback = await assertFallbackPose(resourcePage, 'animation.js resource failure');
      await inspectPngImage(resourcePage, '.combat-arena .game-scene', 'resource failure battle');
      await capture(resourcePage, '390x844-resource-failure-fallback.png');
      await check('美术运行时资源失败仍可正常开战、显示完整姿态并跳过', async () => {
        const settled = await assertFallbackCanSkip(resourcePage, 'resource failure');
        return { startFallback, fallback, settled };
      });
    } finally {
      await resourceFailureContext.close();
    }

    const webglContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    await webglContext.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
        if (/^(?:experimental-)?webgl2?$/i.test(String(type))) {
          window.__shanhaiBlockedWebGL = (window.__shanhaiBlockedWebGL || 0) + 1;
          return null;
        }
        return original.call(this, type, ...args);
      };
      if (globalThis.OffscreenCanvas) {
        const offscreenContext = OffscreenCanvas.prototype.getContext;
        OffscreenCanvas.prototype.getContext = function getContext(type, ...args) {
          if (/^(?:experimental-)?webgl2?$/i.test(String(type))) return null;
          return offscreenContext.call(this, type, ...args);
        };
      }
      if (navigator.gpu) navigator.gpu.requestAdapter = async () => null;
    });
    const webglPage = await webglContext.newPage();
    webglPage.setDefaultTimeout(20000);
    webglPage.on('pageerror', error =>
      errors.push({ label: 'webgl-unavailable', type: 'pageerror', message: error.message }));
    try {
      await openLanding(webglPage, 'webgl-unavailable');
      await inspectPngImage(webglPage, '.landing-atmosphere .game-scene', 'WebGL unavailable start');
      await webglPage.locator('.method-choice[data-id="RKF01"]').click();
      const meta = await startRealBattle(webglPage);
      await seekPausedCursor(
        webglPage, meta, meta.rageIndices.player[0] - 1, { artReady: 'settled' },
      );
      const blocked = await webglPage.evaluate(() => window.__shanhaiBlockedWebGL || 0);
      assert.ok(blocked > 0, 'WebGL 降级路径没有实际拦截 WebGL context');
      await capture(webglPage, '390x844-webgl-unavailable-state.png');
      let fallback;
      let fallbackFailure;
      try {
        fallback = await check('WebGL 不可用时使用可见 Canvas 2D 或完整静态姿态', async () => {
          if (await webglPage.locator('.combat-arena').getAttribute('data-art-ready') !== 'true') {
            return assertFallbackPose(webglPage, 'WebGL unavailable');
          }
          const canvas = await inspectBattleCanvas(webglPage, 'WebGL unavailable');
          assert.equal(canvas.renderer, 'canvas2d', 'WebGL 禁用没有进入 Canvas 2D 降级');
          return canvas;
        });
      } catch (error) {
        fallbackFailure = error;
      }
      await inspectPngImage(webglPage, '.combat-arena .game-scene', 'WebGL unavailable battle');
      await check('WebGL 被禁用时真实战斗仍可跳过播放', async () => {
        const settled = await assertSkipCleansEffects(webglPage, meta, 'WebGL unavailable');
        await capture(webglPage, '390x844-webgl-unavailable-skip.png');
        return { blocked, fallback, settled };
      });
      if (fallbackFailure) throw fallbackFailure;
    } finally {
      await webglContext.close();
    }

    assert.deepEqual(errors, [], `页面新增未捕获错误 ${JSON.stringify(errors)}`);
  } catch (error) {
    runFailure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await browser.close();
    await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
      url,
      executablePath,
      reportDir,
      screenshots,
      viewports: summaries,
      errors,
      checks,
      failure: runFailure,
    }, null, 2));
  }
}

try {
  await run();
  console.log(`Art browser report: ${reportDir}`);
  console.log(`Screenshots: ${screenshotDir}`);
} catch (error) {
  console.error(error);
  console.error(`Partial art browser report: ${path.join(reportDir, 'report.json')}`);
  process.exitCode = 1;
}
