import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const saveKey = 'suishi-shanhai-run-v1';
const reportDir = await mkdtemp(path.join(os.tmpdir(), 'shanhai-enemy-art-'));
const screenshotDir = path.join(reportDir, 'screenshots');
const checks = [];
const errors = [];
const screenshots = [];
const battleRuns = [];

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
      // Keep looking in the configured browser tools cache.
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

async function waitForPhase(page, phase) {
  await page.locator(`.game-page.phase-${phase}`).waitFor({ state: 'visible' });
}

async function waitForPhaseChange(page, phase) {
  await page.waitForFunction(
    previous => !document.querySelector('.game-page')?.classList.contains(`phase-${previous}`),
    phase,
    { polling: 'raf' },
  );
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

async function openFreshRun(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.landing-page').waitFor({ state: 'visible' });
  await page.locator('.method-choice[data-id="RKF01"]').waitFor({ state: 'visible' });
}

async function startRealBattle(page, { seed = 'enemy-art-0' } = {}) {
  await page.locator('.method-choice[data-id="RKF01"]').click();
  await page.locator('[name="player-name"]').fill('敌帧验收行者');
  await page.locator('[name="seed"]').fill(seed);
  await clickAction(page, 'start');
  await waitForPhase(page, 'map');

  const firstCombat = page.locator(
    '.map-node.available[data-node-type="C"]:not([disabled])',
  ).first();
  await firstCombat.waitFor({ state: 'visible' });
  await firstCombat.scrollIntoViewIfNeeded();
  await firstCombat.click();
  await page.locator('.node-preview-dialog[data-node-type="C"]').waitFor();
  await clickAction(page, 'confirm-node');
  await waitForPhase(page, 'preview');
  await clickAction(page, 'fight');
  await waitForPhase(page, 'battle');
  await page.locator('.battle-shell').waitFor({ state: 'visible' });
  await clickAction(page, 'battle-pause');
  await page.locator('.battle-shell[data-paused="true"]').waitFor();
  await page.locator('.combat-arena[data-art-ready="true"]').waitFor({
    state: 'visible',
    timeout: 30000,
  });
  await page.waitForFunction(() =>
    typeof document.querySelector('canvas[data-game-battle]')?.getFrameSnapshot === 'function',
  null, { polling: 'raf' });
  await page.waitForTimeout(100);

  const meta = await readCurrentBattle(page);
  assert.equal(meta.state.phase, 'battle', '战斗必须来自当前真实存档');
  assert.equal(meta.state.method, 'RKF01', '真实开局没有使用选择的功法');
  assert.equal(meta.state.seed, seed, '真实开局种子不匹配');
  assert.equal(meta.saveExists, true, '真实 UI 开局没有生成自动存档');
  assert.ok(meta.enemyId.startsWith('EN-'), `当前节点不是敌人 ${meta.enemyId}`);
  assert.equal(meta.snapshot.enemy?.id, meta.enemyId,
    `战斗绘制器没有加载当前敌人 ${meta.enemyId}/${meta.snapshot.enemy?.id}`);
  assert.equal(meta.canvasSkin, meta.enemyId,
    `battle canvas 的敌方 skin 不匹配 ${meta.enemyId}/${meta.canvasSkin}`);
  return meta;
}

async function readCurrentBattle(page) {
  return page.evaluate(async saveKey => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    const state = game?.state;
    const canvas = document.querySelector('canvas[data-game-battle]');
    const snapshot = canvas?.getFrameSnapshot?.() || null;
    const raw = JSON.parse(localStorage.getItem(saveKey) || 'null');
    return {
      state: {
        phase: state?.phase,
        act: state?.act,
        step: state?.step,
        method: state?.method,
        seed: state?.seed,
        outcome: state?.battle?.outcome,
      },
      enemyId: state?._pendingEvent?.enemyId ?? state?.nodes?.[state.step]?.id ?? '',
      enemyMethod: state?.battleInput?.enemy?.method,
      saveExists: Boolean(raw?.state?.battle),
      canvasSkin: canvas?.dataset.enemySkin || '',
      artReady: canvas?.closest('.combat-arena')?.dataset.artReady || '',
      canvasWidth: canvas?.clientWidth || 0,
      canvasHeight: canvas?.clientHeight || 0,
      snapshot,
    };
  }, saveKey);
}

async function loadAndInspectEnemyAtlases(page) {
  return page.evaluate(async () => {
    const [framesResponse, artResponse] = await Promise.all([
      fetch('/assets/frames.json', { cache: 'no-store' }),
      fetch('/assets/game-art.json', { cache: 'no-store' }),
    ]);
    if (!framesResponse.ok || !artResponse.ok) {
      throw new Error(`manifest status frames=${framesResponse.status} art=${artResponse.status}`);
    }
    const framesManifest = await framesResponse.json();
    const artManifest = await artResponse.json();
    const enemyIds = Object.keys(framesManifest.characters || {})
      .filter(id => id.startsWith('EN-'))
      .sort();
    const playerIds = Object.keys(framesManifest.characters || {})
      .filter(id => id.startsWith('RKF'))
      .sort();
    const cellWidth = 72;
    const cellHeight = 80;
    const rowHeight = cellHeight + 4;
    const matrix = document.createElement('canvas');
    matrix.width = cellWidth * 12;
    matrix.height = rowHeight * enemyIds.length;
    matrix.dataset.enemyAtlasMatrix = 'true';
    matrix.style.display = 'block';
    matrix.style.width = `${matrix.width}px`;
    matrix.style.height = `${matrix.height}px`;
    document.body.append(matrix);
    const context = matrix.getContext('2d', { willReadFrequently: true });
    const records = [];
    const fetchErrors = [];

    for (const [row, id] of enemyIds.entries()) {
      const character = framesManifest.characters[id];
      const libraryRecord = artManifest.assets?.[character?.src];
      if (!character || !character.src || !Array.isArray(character.frames) ||
          character.frames.length !== 12) {
        fetchErrors.push(`${id}: missing 12 frame manifest entries`);
        continue;
      }
      if (!/^\/assets\/frames-en-[a-z0-9-]+\.png$/.test(character.src) ||
          /RKF/i.test(character.src)) {
        fetchErrors.push(`${id}: not an enemy-specific atlas source ${character.src}`);
        continue;
      }
      if (!libraryRecord?.sha256 || libraryRecord.sha256 !== character.sha256) {
        fetchErrors.push(`${id}: atlas sha mismatch between runtime and release manifest`);
        continue;
      }

      const response = await fetch(character.src, { cache: 'no-store' });
      if (!response.ok) {
        fetchErrors.push(`${id}: atlas HTTP ${response.status}`);
        continue;
      }
      const bytes = await response.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== character.sha256) {
        fetchErrors.push(`${id}: atlas bytes do not match release sha256`);
        continue;
      }
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      if (!(bitmap.width > 0 && bitmap.height > 0)) {
        fetchErrors.push(`${id}: decoded atlas is empty`);
        bitmap.close();
        continue;
      }

      for (const [index, frame] of character.frames.entries()) {
        if (!Array.isArray(frame) || frame.length !== 4 ||
            frame[2] !== 400 || frame[3] !== 448 ||
            frame.some(value => !Number.isInteger(value)) ||
            frame[0] < 0 || frame[1] < 0 ||
            frame[0] + frame[2] > bitmap.width ||
            frame[1] + frame[3] > bitmap.height) {
          fetchErrors.push(`${id}: invalid frame rectangle ${index}`);
          continue;
        }
        context.drawImage(
          bitmap,
          frame[0], frame[1], frame[2], frame[3],
          index * cellWidth, row * rowHeight + 2, cellWidth, cellHeight,
        );
      }
      bitmap.close();
      records.push({
        id,
        src: character.src,
        sha256: digest,
        width: character.frames[0][2],
        height: character.frames[0][3],
        frames: character.frames.length,
      });
    }

    const pixels = [];
    for (const [row, record] of records.entries()) {
      const framePixels = [];
      for (let index = 0; index < 12; index += 1) {
        const data = context.getImageData(
          index * cellWidth, row * rowHeight + 2, cellWidth, cellHeight,
        ).data;
        let visible = 0;
        const buckets = new Set();
        for (let offset = 0; offset < data.length; offset += 4) {
          if (data[offset + 3] <= 16) continue;
          visible += 1;
          buckets.add(`${data[offset] >> 4}:${data[offset + 1] >> 4}:${data[offset + 2] >> 4}`);
        }
        framePixels.push({ visible, colorBuckets: buckets.size });
      }
      pixels.push({ id: record.id, frames: framePixels });
    }

    return {
      schemaVersion: framesManifest.schemaVersion,
      approval: framesManifest.approval,
      characterCount: Object.keys(framesManifest.characters || {}).length,
      enemyIds,
      playerIds,
      records,
      pixels,
      errors: fetchErrors,
      matrixPixels: (() => {
        let visible = 0;
        const image = context.getImageData(0, 0, matrix.width, matrix.height).data;
        for (let offset = 3; offset < image.length; offset += 4) {
          if (image[offset] > 16) visible += 1;
        }
        return visible;
      })(),
      matrix: { width: matrix.width, height: matrix.height },
    };
  });
}

function assertAtlasMatrix(matrix) {
  assert.equal(matrix.schemaVersion, 1, 'runtime frames manifest schema version');
  assert.equal(matrix.approval, 'approved', 'runtime frames manifest approval');
  assert.equal(matrix.characterCount, 39, 'runtime manifest must contain 5 players and 34 enemies');
  assert.equal(matrix.playerIds.length, 5, 'expected five RKF player frames');
  assert.equal(matrix.enemyIds.length, 34, 'expected all 34 enemy frame records');
  assert.deepEqual(matrix.errors, [], `enemy atlas/frame matrix has invalid assets: ${matrix.errors.join('; ')}`);
  assert.equal(matrix.records.length, 34, 'all enemy atlases must decode');
  assert.equal(new Set(matrix.records.map(item => item.id)).size, 34,
    'enemy atlas records repeat an enemy ID');
  assert.equal(new Set(matrix.records.map(item => item.src)).size, 34,
    'enemy IDs do not have independent atlas URLs');
  assert.equal(new Set(matrix.records.map(item => item.sha256)).size, 34,
    'enemy IDs do not have independent atlas bytes');
  assert.ok(matrix.matrixPixels > 50000, `enemy canvas matrix is empty (${matrix.matrixPixels})`);
  assert.deepEqual(
    matrix.records.map(({ width, height, frames }) => [width, height, frames]),
    Array.from({ length: 34 }, () => [400, 448, 12]),
    'each atlas must expose twelve 400x448 frame crops',
  );
  for (const entry of matrix.pixels) {
    assert.equal(entry.frames.length, 12, `${entry.id}: matrix does not include all frames`);
    entry.frames.forEach((frame, index) => {
      assert.ok(frame.visible > 80 && frame.colorBuckets > 2,
        `${entry.id} frame ${index} has no meaningful rendered pixels ${JSON.stringify(frame)}`);
    });
  }
}

async function capture(page, filename) {
  const destination = path.join(screenshotDir, filename);
  await page.screenshot({ path: destination, animations: 'disabled' });
  screenshots.push(destination);
  return destination;
}

async function inspectBattleCanvas(page, label, expectedEnemyId) {
  const result = await page.evaluate(async expectedId => {
    const canvas = document.querySelector('canvas[data-game-battle]');
    const snapshot = canvas?.getFrameSnapshot?.() || null;
    const framesManifest = await (await fetch('/assets/frames.json')).json();
    const characters = [snapshot?.player?.id, snapshot?.enemy?.id].map(id => ({
      id,
      character: framesManifest.characters?.[id] || null,
    }));
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl') ||
      canvas?.getContext('experimental-webgl');
    if (!canvas || !gl) {
      return { error: 'battle canvas is missing WebGL', snapshot, characters };
    }
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonTransparent = 0;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] <= 12) continue;
      nonTransparent += 1;
      colors.add(`${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`);
    }
    return {
      error: null,
      expectedId,
      ready: canvas.closest('.combat-arena')?.dataset.artReady,
      engine: canvas.dataset.engine,
      enemySkin: canvas.dataset.enemySkin,
      canvasSize: { width: canvas.clientWidth, height: canvas.clientHeight },
      drawingBuffer: { width, height },
      nonTransparent,
      colorBuckets: colors.size,
      snapshot,
      characters,
    };
  }, expectedEnemyId);
  assert.equal(result.error, null, `${label}: ${result.error}`);
  assert.equal(result.ready, 'true', `${label}: battle art is not ready`);
  assert.equal(result.engine, 'drawn-frames', `${label}: unexpected renderer`);
  assert.equal(result.enemySkin, expectedEnemyId,
    `${label}: canvas skin was reused from the wrong enemy`);
  assert.ok(result.nonTransparent > 1000 && result.colorBuckets > 12,
    `${label}: battle canvas has no character pixels ${JSON.stringify(result)}`);
  assert.equal(result.snapshot.enemy?.id, expectedEnemyId,
    `${label}: current battle snapshot has wrong enemy ID`);
  assert.ok(result.snapshot.player?.id.startsWith('RKF'),
    `${label}: player was accidentally assigned an enemy frame`);
  assert.equal(result.characters[1].character?.src.startsWith('/assets/frames-en-'), true,
    `${label}: enemy image does not resolve to an enemy atlas`);
  return result;
}

async function inspectBattleGeometry(page, label, enemyId) {
  const result = await page.evaluate(async expectedEnemyId => {
    const canvas = document.querySelector('canvas[data-game-battle]');
    const snapshot = canvas?.getFrameSnapshot?.() || null;
    const manifest = await (await fetch('/assets/frames.json')).json();
    const width = canvas?.clientWidth || 0;
    const height = canvas?.clientHeight || 0;
    const targetBodyHeight = manifest.targetBodyHeight;
    const characters = [snapshot?.player?.id, snapshot?.enemy?.id].map(id => ({
      id,
      ...manifest.characters?.[id],
    }));
    const motions = {
      footRoom: 0,
      rearExtent: 1,
      rise: 1,
    };
    for (const character of characters) {
      if (!character.id || !Array.isArray(character.cels)) continue;
      const stature = targetBodyHeight / character.bodyHeight;
      motions.footRoom = Math.max(
        motions.footRoom,
        (448 - character.anchor[1]) * stature,
      );
      motions.rearExtent = Math.max(
        motions.rearExtent,
        ...character.cels.map(cel => (character.anchor[0] - cel.bounds[0]) * stature),
      );
      motions.rise = Math.max(
        motions.rise,
        ...character.cels.map(cel => (character.anchor[1] - cel.bounds[1]) * stature),
      );
    }
    const scale = Math.min(
      (width / 4 - 4) / (motions.rearExtent + 8),
      (height - 12) / (motions.rise + motions.footRoom + 6),
      1,
    );
    const baseline = height - Math.max(12, motions.footRoom * scale + 6);
    const stance = width * 0.25;
    const actorEnvelopes = {};
    for (const side of ['player', 'enemy']) {
      const state = snapshot?.[side];
      const character = characters.find(entry => entry.id === state?.id);
      const stature = targetBodyHeight / character.bodyHeight;
      const actorScale = state.scale;
      const direction = side === 'player' ? 1 : -1;
      const envelope = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      const poseBounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      const currentCel = character.cels[state.frame];
      for (const cel of character.cels) {
        const [left, top, right, bottom] = cel.bounds;
        const celLeft = direction === 1
          ? state.x + (left - character.anchor[0]) * actorScale
          : state.x - (right - character.anchor[0]) * actorScale;
        const celRight = direction === 1
          ? state.x + (right - character.anchor[0]) * actorScale
          : state.x - (left - character.anchor[0]) * actorScale;
        envelope.left = Math.min(envelope.left, celLeft - 7 * scale);
        envelope.right = Math.max(envelope.right, celRight + 7 * scale);
        envelope.top = Math.min(
          envelope.top,
          state.y + (top - character.anchor[1]) * actorScale - 2 * scale,
        );
        envelope.bottom = Math.max(
          envelope.bottom,
          state.y + (bottom - character.anchor[1]) * actorScale + 2 * scale,
        );
      }
      if (currentCel) {
        const [left, top, right, bottom] = currentCel.bounds;
        poseBounds.left = direction === 1
          ? state.x + (left - character.anchor[0]) * actorScale
          : state.x - (right - character.anchor[0]) * actorScale;
        poseBounds.right = direction === 1
          ? state.x + (right - character.anchor[0]) * actorScale
          : state.x - (left - character.anchor[0]) * actorScale;
        poseBounds.top = state.y + (top - character.anchor[1]) * actorScale;
        poseBounds.bottom = state.y + (bottom - character.anchor[1]) * actorScale;
      }
      const idleBob = -Math.sin((state.elapsed % 3000) / 3000 * Math.PI * 2) * 1.2;
      actorEnvelopes[side] = {
        id: state.id,
        action: state.action,
        pose: state.pose,
        frame: state.frame,
        x: state.x,
        y: state.y,
        scale: actorScale,
        expectedScale: stature * scale,
        expectedY: baseline + (state.action === 'idle' ? idleBob * scale : 0),
        expectedX: width / 2 + (side === 'player' ? -stance : stance),
        footAnchor: state.y + (448 - character.anchor[1]) * actorScale,
        targetFootAnchor: baseline + (448 - character.anchor[1]) * stature * scale,
        stature,
        envelope,
        poseBounds,
      };
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      canvas: { width, height },
      expectedEnemyId,
      snapshot,
      targetBodyHeight,
      motions,
      layout: { scale, baseline, stance },
      actors: actorEnvelopes,
    };
  }, enemyId);

  assert.equal(result.snapshot?.enemy?.id, enemyId,
    `${label}: geometry inspected the wrong enemy`);
  assert.ok(result.canvas.width > 100 && result.canvas.height > 100,
    `${label}: battle canvas dimensions are too small ${JSON.stringify(result.canvas)}`);
  assert.ok(result.layout.scale > 0 && result.layout.scale <= 1,
    `${label}: invalid layout scale ${result.layout.scale}`);
  for (const side of ['player', 'enemy']) {
    const actor = result.actors[side];
    assert.ok(Number.isFinite(actor.x) && Number.isFinite(actor.y) && actor.scale > 0,
      `${label}: ${side} has no usable frame snapshot`);
    assert.ok(Math.abs(actor.x - actor.expectedX) <= 7 * result.layout.scale + 1,
      `${label}: ${side} left its stable quarter-screen anchor ${JSON.stringify(actor)}`);
    assert.ok(Math.abs(actor.scale - actor.expectedScale) < 0.001,
      `${label}: ${side} scale differs from motion-envelope layout ${JSON.stringify(actor)}`);
    assert.ok(Math.abs(actor.y - actor.expectedY) <= 0.1,
      `${label}: ${side} feet/baseline drifted ${JSON.stringify(actor)}`);
    assert.ok(actor.envelope.left >= -1 && actor.envelope.right <= result.canvas.width + 1,
      `${label}: ${side} motion envelope is clipped horizontally ${JSON.stringify(actor.envelope)}`);
    assert.ok(actor.envelope.top >= -1 && actor.envelope.bottom < result.canvas.height,
      `${label}: ${side} motion envelope is clipped vertically ${JSON.stringify(actor.envelope)}`);
    assert.ok(actor.footAnchor > result.canvas.height - 180 &&
      actor.footAnchor <= result.canvas.height - 2,
    `${label}: ${side} foot anchor is not grounded near the canvas baseline ${JSON.stringify(actor)}`);
    assert.ok(Math.abs(actor.footAnchor - actor.targetFootAnchor) <= 2.5,
      `${label}: ${side} foot anchor does not match the stable shared baseline`);
  }
  assert.ok(result.actors.player.x < result.actors.enemy.x,
    `${label}: player and enemy sides were reversed`);
  assert.equal(result.actors.player.action, 'idle',
    `${label}: geometry must sample the paused ready pose`);
  assert.equal(result.actors.enemy.action, 'idle',
    `${label}: geometry must sample the paused ready pose`);
  assert.ok(result.actors.player.poseBounds.right + 1 < result.actors.enemy.poseBounds.left,
    `${label}: current ready poses overlap ${JSON.stringify(result.actors)}`);
  result.motionEnvelopeOverlap = Math.max(
    0,
    result.actors.player.envelope.right - result.actors.enemy.envelope.left,
  );
  assert.ok(Math.abs(result.actors.player.y - result.actors.enemy.y) <= 2.5,
    `${label}: the fighters do not share a stable foot baseline`);
  return result;
}

async function enterSecondRealBattle(page, firstEnemyId) {
  const first = await readCurrentBattle(page);
  assert.equal(first.enemyId, firstEnemyId, 'battle changed before the real transition');
  assert.equal(first.state.outcome, 'player',
    `seed did not produce a winning first battle: ${first.state.outcome}`);

  await clickAction(page, 'battle-skip');
  await page.locator('[data-action="battle-finish"]:visible').waitFor();
  await clickAction(page, 'battle-finish');
  await waitForPhaseChange(page, 'battle');
  await page.waitForFunction(() => {
    const page = document.querySelector('.game-page');
    return page && !page.classList.contains('phase-battle');
  }, null, { polling: 'raf' });

  for (let step = 0; step < 32; step += 1) {
    const phase = await page.locator('.game-page').getAttribute('class');
    const phaseName = phase?.match(/phase-([a-z_]+)/)?.[1];
    if (phaseName === 'battle') {
      await page.locator('.battle-shell').waitFor({ state: 'visible' });
      if (await page.locator('.battle-shell[data-paused="true"]').count() === 0) {
        await clickAction(page, 'battle-pause');
        await page.locator('.battle-shell[data-paused="true"]').waitFor();
      }
      await page.locator('.combat-arena[data-art-ready="true"]').waitFor({
        state: 'visible',
        timeout: 30000,
      });
      await page.waitForTimeout(100);
      const meta = await readCurrentBattle(page);
      assert.notEqual(meta.enemyId, firstEnemyId,
        `真实流程第二战仍然使用同一个敌人 ${firstEnemyId}`);
      assert.equal(meta.snapshot.enemy?.id, meta.enemyId,
        `第二个生产战斗误用了旧敌人帧 ${JSON.stringify(meta.snapshot.enemy)}`);
      assert.equal(meta.canvasSkin, meta.enemyId,
        `第二个生产战斗 canvas 复用了旧 skin ${meta.canvasSkin}/${meta.enemyId}`);
      return meta;
    }
    if (phaseName === 'lost' || phaseName === 'won') {
      throw new Error(`真实命途在遇到第二名敌人之前进入 ${phaseName}`);
    }
    if (phaseName === 'reward') {
      await clickAction(page, 'reward', { id: '' });
      await waitForPhaseChange(page, 'reward');
      continue;
    }
    if (phaseName === 'map') {
      const combats = page.locator(
        '.map-node.available[data-node-type="C"]:not([disabled])',
      );
      const target = await combats.count()
        ? combats.first()
        : page.locator('.map-node.available:not([disabled])').first();
      await target.waitFor({ state: 'visible' });
      await target.scrollIntoViewIfNeeded();
      await target.click();
      await page.locator('.node-preview-dialog').waitFor({ state: 'visible' });
      await clickAction(page, 'confirm-node');
      await waitForPhaseChange(page, 'map');
      continue;
    }
    if (phaseName === 'preview') {
      await clickAction(page, 'fight');
      await waitForPhaseChange(page, 'preview');
      continue;
    }
    if (phaseName === 'event') {
      const options = await page.evaluate(async saveKey => {
        const [{ loadContent }, { loadRun }] = await Promise.all([
          import('/shanhai/content.js'),
          import('/shanhai/persistence.js'),
        ]);
        const content = await loadContent('/content/');
        const game = loadRun(content);
        const event = content.byId[game.node.id];
        return event.options
          .filter(option => game.optionAvailability(option).available && !option.encounter)
          .map(option => option.id);
      }, saveKey);
      const option = options[0];
      if (option) await clickAction(page, 'event', { id: option });
      else await clickAction(page, 'event');
      await waitForPhaseChange(page, 'event');
      continue;
    }
    if (phaseName === 'event_result') {
      await clickAction(page, 'continue');
      await waitForPhaseChange(page, 'event_result');
      continue;
    }
    if (phaseName === 'rest') {
      await clickAction(page, 'rest', { choice: 'heal' });
      await waitForPhaseChange(page, 'rest');
      continue;
    }
    if (phaseName === 'shop') {
      await clickAction(page, 'leave-shop');
      await waitForPhaseChange(page, 'shop');
      continue;
    }
    if (phaseName === 'talent') {
      await clickAction(page, 'talent');
      await waitForPhaseChange(page, 'talent');
      continue;
    }
    if (phaseName === 'transition') {
      await clickAction(page, 'continue');
      await waitForPhaseChange(page, 'transition');
      continue;
    }
    throw new Error(`真实命途无法从阶段 ${phaseName} 推进到第二场战斗`);
  }
  throw new Error('真实命途超过 32 次可见 UI 操作仍未进入第二场战斗');
}

async function trackEnemyRequests(page) {
  const requests = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (/\/assets\/frames-en-[a-z0-9-]+\.png$/i.test(pathname)) requests.push(pathname);
  });
  return requests;
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
  let runFailure = null;
  try {
    const atlasContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const atlasPage = await atlasContext.newPage();
    atlasPage.setDefaultTimeout(30000);
    atlasPage.on('pageerror', error =>
      errors.push({ label: 'atlas-matrix', type: 'pageerror', message: error.message }));
    await atlasPage.goto(url, { waitUntil: 'networkidle' });
    const matrix = await check('final dist: 34 independent enemy atlases render all 12 frames', async () => {
      const result = await loadAndInspectEnemyAtlases(atlasPage);
      assertAtlasMatrix(result);
      const screenshot = path.join(screenshotDir, 'enemy-atlas-matrix.png');
      await atlasPage.locator('canvas[data-enemy-atlas-matrix="true"]').screenshot({ path: screenshot });
      screenshots.push(screenshot);
      return result;
    });
    await atlasContext.close();

    for (const [width, height] of [[360, 780], [390, 844], [1440, 900]]) {
      const label = `${width}x${height}`;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error =>
        errors.push({ label, type: 'pageerror', message: error.message }));
      const requests = await trackEnemyRequests(page);
      try {
        await openFreshRun(page);
        const battle = await check(`${label}: real production battle loads its current enemy`, async () => {
          const result = await startRealBattle(page);
          const canvas = await inspectBattleCanvas(page, label, result.enemyId);
          assert.deepEqual([...new Set(requests)], [matrix.records.find(
            entry => entry.id === result.enemyId,
          )?.src], `${label}: first battle eagerly fetched atlases beyond its current enemy`);
          return { state: result.state, enemyId: result.enemyId, canvas, requests: [...new Set(requests)] };
        });
        const geometry = await check(`${label}: battle anchors, motion envelope and foot baseline`, async () => {
          const screenshot = await capture(page, `${width}x${height}-real-battle.png`);
          const result = await inspectBattleGeometry(page, label, battle.enemyId);
          return { ...result, screenshot };
        });
        battleRuns.push({
          viewport: label,
          enemyId: battle.enemyId,
          enemyMethod: (await readCurrentBattle(page)).enemyMethod,
          requests: [...new Set(requests)],
          geometry,
        });

        if (width === 360) {
          await check('paused battle resizes without stretching actors or advancing the clock', async () => {
            const before = await readCurrentBattle(page);
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.waitForFunction(() => {
              const canvas = document.querySelector('canvas[data-game-battle]');
              return Math.abs(canvas.getFrameSnapshot().player.x - canvas.clientWidth / 4) < 1;
            });
            const resized = await inspectBattleGeometry(page, 'paused desktop resize', battle.enemyId);
            assert.equal(resized.snapshot.clock, before.snapshot.clock,
              'resizing a paused battle advanced its animation clock');
            await capture(page, 'paused-battle-desktop-resize.png');
            await page.setViewportSize({ width, height });
            await page.waitForFunction(() => {
              const canvas = document.querySelector('canvas[data-game-battle]');
              return Math.abs(canvas.getFrameSnapshot().player.x - canvas.clientWidth / 4) < 1;
            });
            return { clock: before.snapshot.clock, geometry: resized };
          });
        }

        if (width === 1440) {
          const next = await check('1440x900: real UI progression loads a different enemy without reuse', async () => {
            const second = await enterSecondRealBattle(page, battle.enemyId);
            const canvas = await inspectBattleCanvas(page, label, second.enemyId);
            const expectedSource = matrix.records.find(entry => entry.id === second.enemyId)?.src;
            const uniqueRequests = [...new Set(requests)];
            assert.deepEqual(uniqueRequests, [
              matrix.records.find(entry => entry.id === battle.enemyId)?.src,
              expectedSource,
            ], `second real battle did not lazily add only its enemy atlas: ${uniqueRequests}`);
            assert.ok(uniqueRequests.length < matrix.enemyIds.length,
              'normal production flow downloaded every enemy atlas');
            const screenshot = await capture(page, '1440x900-second-real-enemy.png');
            const record = {
              from: battle.enemyId,
              to: second.enemyId,
              enemyMethod: second.enemyMethod,
              canvas,
              requestedAtlases: uniqueRequests,
              screenshot,
              state: second.state,
            };
            battleRuns.push({ viewport: label, secondBattle: record });
            return record;
          });
          assert.notEqual(next.from, next.to);
        }
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(errors, [], `browser pages raised uncaught errors ${JSON.stringify(errors)}`);
  } catch (error) {
    runFailure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await browser.close();
    await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
      url,
      executablePath,
      reportDir,
      source: 'current served production dist',
      realFlow: {
        fixtureUsed: false,
        saveStateInjected: false,
        entry: 'fresh local storage, visible start/map/preview/fight controls',
        continuation: 'visible battle-skip, battle-finish, map and event/reward controls',
      },
      screenshots,
      battleRuns,
      errors,
      checks,
      atlasMatrix: checks.find(item => item.name.includes('34 independent'))?.details ?? null,
      failure: runFailure,
    }, null, 2));
  }
}

try {
  await run();
  console.log(`Enemy art browser report: ${reportDir}`);
  console.log(`Screenshots: ${screenshotDir}`);
} catch (error) {
  console.error(error);
  console.error(`Partial enemy art report: ${path.join(reportDir, 'report.json')}`);
  process.exitCode = 1;
}
