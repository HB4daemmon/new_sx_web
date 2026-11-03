import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const screenshotDir = '/tmp/shanhai-elemental-review';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const replayKey = 'suishi-shanhai-replay-v2-overhaul';
const viewports = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
];
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

async function installRealBattleFixture(page, method, swordPills = false) {
  return page.evaluate(async ({ saveKey, replayKey, method, swordPills }) => {
    const [contentApi, run, combat, persistence, playback, impact, elemental] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
      import('/shanhai/battle-playback.js'),
      import('/shanhai/battle-impact.js'),
      import('/shanhai/battle-elemental-vfx.js'),
    ]);
    const content = await contentApi.loadContent('/content/');
    run.registerCombatWorker({
      calculateStats: combat.calculateStats,
      simulateBattle: combat.simulateBattle,
    });

    const cueData = (frames, cursor) => elemental.battleElementalFxCues(
      frames,
      cursor,
      playback.combatPresentationGroup(frames, cursor),
    );
    const volleyHits = (frames, cursor) => {
      const group = playback.combatPresentationGroup(frames, cursor);
      return impact.battleImpactSegments(frames, cursor, group).filter(hit => {
        const frame = frames[hit.frameIndex];
        return frame.kind === 'damage' && hit.attacker === 'player' && hit.target === 'enemy' &&
          frame.cue?.kind === 'sword_volley' && frame.cue.owner === hit.attacker &&
          frame.source === frame.cue.sourceId;
      });
    };
    const hasStatusIncrease = (frames, cursor, status) => {
      if (cursor <= 0) return false;
      const frame = frames[cursor];
      const previous = frames[cursor - 1];
      return frame.kind === 'status' && frame.actor === 'player' && frame.target === 'enemy' &&
        (frame.enemy.statuses[status] || 0) > (previous.enemy.statuses[status] || 0);
    };

    let selected;
    for (let seedIndex = 0; seedIndex < 100 && !selected; seedIndex += 1) {
      const startingMethod = method === 'RKF06' ? 'RKF01' : method;
      const game = run.ShanhaiGame.create(content, {
        seed: `elemental-vfx-browser-real-engine-${method}-${seedIndex}`,
        name: '五行特效浏览器验收',
        method: startingMethod,
      });
      if (method === 'RKF06') {
        // RKF06 is a valid later-run method and is not one of the five new-run
        // choices. Model its legal ownership on the real run state before battle.
        game.state.method = 'RKF06';
        game.state.ownedMethods = ['RKF06'];
        game.state.talents = { RKF06: [] };
        run.validateRunState(content, game.state);
      }
      if (swordPills) {
        // Model a valid later-run fire build before simulating its real battle.
        game.state.n = 2;
        game.state.talents[method] = ['RKF04-J1-A', 'V2-J2-C'];
        run.validateRunState(content, game.state);
      }

      const node = game.availableNodes().find(item => item.type === 'C');
      if (!node) continue;
      game.dispatch({ type: 'enter', id: node.key });
      if (game.state.phase !== 'preview') continue;
      game.dispatch({ type: 'fight' });
      if (game.state.phase !== 'battle' || !game.state.battleInput || !game.state.battle) continue;
      run.validateRunState(content, game.state);

      const frames = game.state.battle.frames;
      const castCursor = frames.findIndex(frame => frame.kind === 'action' && frame.actor === 'player' &&
        frame.player.method === method);
      if (castCursor < 0) continue;

      if (swordPills) {
        const pillCursors = frames.map((frame, cursor) => ({ frame, cursor }))
          .filter(({ frame }) => frame.kind === 'damage' && frame.actor === 'player' &&
            frame.source === 'RKF04-BASIC-DAMAGE' && frame.strikeVisual === 'sword_pill')
          .map(({ cursor }) => cursor);
        const attackCursor = pillCursors.find(cursor => {
          const cues = cueData(frames, cursor);
          return cues.some(cue => cue.kind === 'fire' && cue.phase === 'travel') &&
            cues.some(cue => cue.kind === 'blade' && cue.phase === 'travel' && cue.count === 2);
        });
        if (attackCursor !== undefined) {
          selected = { game, frames, castCursor, attackCursor, pillCursors, seedIndex };
        }
        continue;
      }

      if (method === 'RKF05') {
        const volleyCursors = {};
        for (let cursor = 0; cursor < frames.length; cursor += 1) {
          if (frames[cursor].cue?.kind !== 'sword_volley') continue;
          const count = volleyHits(frames, cursor).length;
          if ([1, 2, 3].includes(count) && volleyCursors[count] === undefined) {
            volleyCursors[count] = cursor;
          }
        }
        const reverseFireCursor = frames.findIndex(frame => frame.kind === 'action' &&
          frame.actor === 'enemy' && frame.target === 'player' &&
          frame.enemy.method === 'RKF04' && frame.source?.startsWith('RKF04-'));
        const reverseFireTravelCursor = frames.findIndex(frame => frame.kind === 'damage' &&
          frame.actor === 'enemy' && frame.target === 'player' &&
          frame.enemy.method === 'RKF04' && frame.source === 'RKF04-BASIC-DAMAGE');
        if ([1, 2, 3].every(count => volleyCursors[count] !== undefined) &&
            reverseFireCursor >= 0 && reverseFireTravelCursor >= 0) {
          selected = {
            game, frames, castCursor, volleyCursors, reverseFireCursor,
            reverseFireTravelCursor, seedIndex,
          };
        }
        continue;
      }

      const element = method === 'RKF04' ? 'fire' : 'poison';
      const statusName = method === 'RKF04' ? 'burn' : 'poison';
      const statusSource = `${method}-BASIC-${method === 'RKF04' ? 'BURN' : 'POISON'}`;
      const attackCursor = frames.findIndex(frame => frame.kind === 'damage' &&
        frame.actor === 'player' && frame.target === 'enemy' &&
        frame.source === `${method}-BASIC-DAMAGE`);
      const statusCursor = frames.findIndex((frame, cursor) =>
        frame.source === statusSource && hasStatusIncrease(frames, cursor, statusName));
      const dotCursor = frames.findIndex(frame => frame.kind === 'dot' && frame.actor === 'player' &&
        frame.target === 'enemy' && frame.dotStatus === statusName);
      if (attackCursor >= 0 && statusCursor >= 0 && dotCursor >= 0) {
        selected = {
          game, frames, castCursor, attackCursor, statusCursor, dotCursor,
          element, statusName, statusSource, seedIndex,
        };
      }
    }

    if (!selected) {
      throw new Error(`真实 ${method} 战斗未产生所需的出手、状态/DOT 与齐射验收帧`);
    }

    const { game, frames } = selected;
    const reportCursors = swordPills
      ? [selected.castCursor, ...selected.pillCursors, selected.attackCursor]
      : method === 'RKF05'
      ? [selected.castCursor, ...Object.values(selected.volleyCursors), selected.reverseFireCursor,
        selected.reverseFireTravelCursor]
      : [selected.castCursor, selected.attackCursor, selected.statusCursor, selected.dotCursor];
    const cuesAtCursor = {};
    const prefixCuesAtCursor = {};
    const frameMetaAtCursor = {};
    for (const cursor of new Set(reportCursors)) {
      cuesAtCursor[cursor] = cueData(frames, cursor);
      prefixCuesAtCursor[cursor] = cueData(frames.slice(0, cursor + 1), cursor);
      const frame = frames[cursor];
      frameMetaAtCursor[cursor] = {
        kind: frame.kind,
        actor: frame.actor,
        target: frame.target,
        source: frame.source,
        dotStatus: frame.dotStatus,
        strikeVisual: frame.strikeVisual,
      };
    }

    let initialCursor = selected.attackCursor ?? selected.volleyCursors[3];
    if (method === 'RKF05') initialCursor = selected.volleyCursors[3];
    const record = persistence.saveRun(game);
    record.state.battle.frames = frames;
    delete record.replay;
    persistence.parseRunSave(content, JSON.stringify(record));
    localStorage.setItem(saveKey, JSON.stringify(record));
    const battleKey = [game.state.id, game.state.act, game.state.step, frames.length].join(':');
    localStorage.setItem(replayKey, JSON.stringify({ key: battleKey, cursor: initialCursor }));
    // Battle speed persists across reloads; each fixture starts from 1×.
    localStorage.removeItem('suishi-shanhai-battle-speed-v1');

    return {
      method,
      seed: game.state.seed,
      seedIndex: selected.seedIndex,
      frameCount: frames.length,
      battleInputMethod: game.state.battleInput.player.method,
      enemyMethod: game.state.battleInput.enemy.method,
      castCursor: selected.castCursor,
      initialCursor,
      ...(swordPills ? {
        attackCursor: selected.attackCursor,
        pillCursors: selected.pillCursors,
      } : method === 'RKF05' ? {
        volleyCursors: selected.volleyCursors,
        reverseFireCursor: selected.reverseFireCursor,
        reverseFireTravelCursor: selected.reverseFireTravelCursor,
        volleyDamageFrameIndexes: Object.fromEntries(Object.entries(selected.volleyCursors).map(
          ([count, cursor]) => [count, volleyHits(frames, cursor).map(hit => hit.frameIndex)],
        )),
      } : {
        attackCursor: selected.attackCursor,
        statusCursor: selected.statusCursor,
        dotCursor: selected.dotCursor,
        element: selected.element,
        statusName: selected.statusName,
        statusSource: selected.statusSource,
      }),
      cuesAtCursor,
      prefixCuesAtCursor,
      frameMetaAtCursor,
    };
  }, { saveKey, replayKey, method, swordPills });
}

async function openFixture(browser, method, reducedMotion = 'no-preference', swordPills = false) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.addInitScript(() => {
    // Keep the real engine snapshot fixed while CSS animation behavior is tested.
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
  });
  const fixture = await installRealBattleFixture(page, method, swordPills);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('.game-page, .landing-page'));
  await page.waitForFunction(() => {
    const game = document.querySelector('.game-page');
    return (game && !game.classList.contains('phase-loading')) || document.querySelector('.landing-page');
  });
  await page.waitForFunction(cursor =>
    document.querySelector('.combat-arena')?.getAttribute('data-frame-index') === String(cursor),
  fixture.initialCursor);
  assert.ok(await page.locator('.battle-shell').count(),
    `${method}: persisted real battle fixture did not restore`);
  return { context, page, fixture };
}

async function showCursor(page, fixture, cursor) {
  assert.ok(cursor >= 0 && cursor < fixture.frameCount,
    `${fixture.method}: cursor ${cursor} is outside the real frame array`);
  await page.evaluate(({ replayKey, cursor }) => {
    const record = JSON.parse(localStorage.getItem('suishi-shanhai-run-v2-overhaul'));
    const state = record.state;
    const key = [state.id, state.act, state.step, state.battle.frames.length].join(':');
    localStorage.setItem(replayKey, JSON.stringify({ key, cursor }));
    // Battle speed persists across reloads; each fixture starts from 1×.
    localStorage.removeItem('suishi-shanhai-battle-speed-v1');
  }, { replayKey, cursor });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(expected =>
    document.querySelector('.combat-arena')?.getAttribute('data-frame-index') === String(expected),
  cursor);
}

function expectedDomCues(cues) {
  return cues.map(cue => {
    const count = cue.phase === 'travel'
      ? Math.min(5, Math.max(1, Math.trunc(cue.count ?? 1)))
      : null;
    return {
      kind: cue.kind,
      owner: cue.owner,
      target: cue.target,
      phase: cue.phase,
      intensity: cue.intensity ?? 'basic',
      count,
      projectileCount: count ?? 0,
    };
  });
}

async function readFx(page) {
  return page.evaluate(() => ({
    frameIndex: Number(document.querySelector('.combat-arena')?.getAttribute('data-frame-index')),
    overlays: [...document.querySelectorAll('.combat-arena > .elemental-fx')].map(element => ({
      kind: element.getAttribute('data-fx-kind'),
      owner: element.getAttribute('data-owner'),
      target: element.getAttribute('data-target'),
      phase: element.getAttribute('data-phase'),
      travelAngle: getComputedStyle(element).getPropertyValue('--fx-travel-angle').trim(),
      intensity: element.getAttribute('data-intensity'),
      count: element.hasAttribute('data-count') ? Number(element.getAttribute('data-count')) : null,
      projectileCount: element.querySelectorAll('.elemental-fx__projectile').length,
      shotIndexes: [...element.querySelectorAll('.elemental-fx__projectile')]
        .map(projectile => Number(projectile.getAttribute('data-shot-index'))),
      pointerEvents: getComputedStyle(element).pointerEvents,
      animationName: getComputedStyle(element.querySelector('.elemental-fx__projectile, .elemental-fx__charge, .elemental-fx__impact'))?.animationName,
      visibility: getComputedStyle(element).visibility,
    })),
  }));
}

async function assertCurrentCues(page, fixture, cursor) {
  await page.waitForFunction(expected =>
    Number(document.querySelector('.combat-arena')?.getAttribute('data-frame-index')) === expected,
  cursor);
  const actual = await readFx(page);
  assert.equal(actual.frameIndex, cursor, `${fixture.method}: battle cursor mismatch`);
  assert.deepEqual(actual.overlays.map(({ kind, owner, target, phase, intensity, count, projectileCount }) => ({
    kind, owner, target, phase, intensity, count, projectileCount,
  })), expectedDomCues(fixture.cuesAtCursor[cursor]),
  `${fixture.method} frame ${cursor}: DOM cues must match only cues from the current real frame`);
  assert.deepEqual(fixture.cuesAtCursor[cursor], fixture.prefixCuesAtCursor[cursor],
    `${fixture.method} frame ${cursor}: later frames leaked into the current cue set`);
  for (const overlay of actual.overlays) {
    assert.equal(overlay.pointerEvents, 'none', 'decorative overlay must not accept pointer events');
    if (overlay.phase === 'travel') {
      assert.equal(overlay.projectileCount, overlay.count,
        `${fixture.method} travel cue must have one independent projectile per authored count`);
      assert.deepEqual(overlay.shotIndexes,
        Array.from({ length: overlay.count }, (_, index) => index + 1),
        'projectile DOM nodes should have a distinct one-based shot index');
    }
  }
  return actual;
}

async function captureMidFlight(page, filename, selector, allOverlays = false) {
  let animation;
  try {
    animation = await page.evaluate(({ selector, allOverlays }) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`screenshot selector did not match: ${selector}`);
      const host = element.closest('.elemental-fx');
      if (!host) throw new Error('screenshot animation is outside an elemental overlay');
      const duration = Number.parseFloat(host.style.getPropertyValue('--fx-duration'));
      const flight = element.getAnimations().find(candidate => candidate.animationName === 'shanhai-fx-flight');
      if (!flight || !Number.isFinite(duration)) throw new Error('real CSS flight animation is missing');
      const hosts = allOverlays ? document.querySelectorAll('.combat-arena > .elemental-fx') : [host];
      for (const item of hosts) {
        const itemDuration = Number.parseFloat(item.style.getPropertyValue('--fx-duration'));
        for (const candidate of item.getAnimations({ subtree: true })) {
          candidate.pause();
          if (candidate.animationName === 'shanhai-fx-flight') candidate.currentTime = itemDuration * 0.46;
        }
      }
      return {
        animationName: flight.animationName,
        duration,
        currentTime: Number(flight.currentTime),
        playState: flight.playState,
        kind: host.getAttribute('data-fx-kind'),
        owner: host.getAttribute('data-owner'),
        target: host.getAttribute('data-target'),
      };
    }, { selector, allOverlays });
  } catch (error) {
    animation = { error: error instanceof Error ? error.message : String(error) };
  }
  await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
  return animation;
}

function assertMidFlightCapture(animation, kind) {
  assert.equal(animation.animationName, 'shanhai-fx-flight',
    `screenshot should pause the real ${kind} CSS flight: ${JSON.stringify(animation)}`);
  assert.equal(animation.kind, kind);
  assert.equal(animation.playState, 'paused');
  assert.ok(animation.currentTime > 0 && animation.currentTime < animation.duration,
    `screenshot should capture a real projectile mid-flight: ${JSON.stringify(animation)}`);
}

async function assertResponsiveOverlay(page, fixture, width, height) {
  await page.setViewportSize({ width, height });
  await page.locator('[data-action="battle-speed"][data-speed="2"]').scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => {
    const arena = document.querySelector('.combat-arena');
    const actors = arena?.querySelector('.game-battle-actors');
    const controls = document.querySelector('.battle-controls');
    const speed = controls?.querySelector('[data-action="battle-speed"][data-speed="2"]');
    const pause = controls?.querySelector('[data-action="battle-pause"]');
    const bounds = element => {
      const rect = element?.getBoundingClientRect();
      return rect ? {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height,
      } : null;
    };
    const hitTarget = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === element || element.contains(hit);
    };
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      arena: bounds(arena),
      actors: bounds(actors),
      controls: bounds(controls),
      speedHitTarget: hitTarget(speed),
      pauseHitTarget: hitTarget(pause),
      overlays: [...(arena?.querySelectorAll(':scope > .elemental-fx') ?? [])].map(element => {
        const style = getComputedStyle(element);
        return {
          bounds: bounds(element),
          gridRowStart: style.gridRowStart,
          gridRowEnd: style.gridRowEnd,
          gridColumnStart: style.gridColumnStart,
          gridColumnEnd: style.gridColumnEnd,
          pointerEvents: style.pointerEvents,
          projectilePointerEvents: element.querySelector('.elemental-fx__projectile')
            ? getComputedStyle(element.querySelector('.elemental-fx__projectile')).pointerEvents
            : null,
        };
      }),
    };
  });
  assert.equal(layout.viewport, width);
  assert.ok(layout.documentWidth <= width + 1 && layout.bodyWidth <= width + 1,
    `${width}px page has horizontal overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.arena && layout.actors && layout.controls && layout.overlays.length > 0,
    `${width}px battle or VFX overlay is missing`);
  assert.ok(layout.overlays.every(overlay => overlay.gridRowStart === '2' && overlay.gridRowEnd === '3' &&
    overlay.gridColumnStart === '1' && overlay.gridColumnEnd === '-1'),
  `${width}px VFX must share the battle canvas grid cell: ${JSON.stringify(layout.overlays)}`);
  assert.ok(layout.overlays.every(overlay => overlay.pointerEvents === 'none' &&
    (overlay.projectilePointerEvents === null || overlay.projectilePointerEvents === 'none')),
  `${width}px VFX must be pointer-transparent: ${JSON.stringify(layout.overlays)}`);
  assert.ok(layout.overlays.every(overlay => Math.abs(overlay.bounds.left - layout.actors.left) <= 1 &&
    Math.abs(overlay.bounds.right - layout.actors.right) <= 1 &&
    Math.abs(overlay.bounds.top - layout.actors.top) <= 1 &&
    Math.abs(overlay.bounds.bottom - layout.actors.bottom) <= 1),
  `${width}px overlay bounds must stay inside the battle canvas grid: ${JSON.stringify(layout)}`);
  assert.ok(layout.overlays.every(overlay => overlay.bounds.bottom <= layout.controls.top + 1),
    `${width}px VFX must not overlap the battle HUD controls: ${JSON.stringify(layout)}`);
  assert.equal(layout.speedHitTarget, true, `${width}px speed button is obscured by the VFX layer`);
  assert.equal(layout.pauseHitTarget, true, `${width}px pause button is obscured by the VFX layer`);
  return layout;
}

async function assertBattleSpeedAndPause(page, fixture) {
  await showCursor(page, fixture, fixture.castCursor);
  const initial = await assertCurrentCues(page, fixture, fixture.castCursor);
  assert.ok(initial.overlays.some(overlay => overlay.kind === 'blade' && overlay.phase === 'cast'));
  const readChargeMotion = () => page.evaluate(selector => {
    const host = document.querySelector(selector);
    const charge = host?.querySelector('.elemental-fx__charge');
    const animation = charge?.getAnimations().find(item => item.animationName === 'shanhai-fx-gather');
    return {
      duration: Number.parseFloat(host?.style.getPropertyValue('--fx-duration') || '0'),
      shellPaused: document.querySelector('.battle-shell')?.getAttribute('data-paused'),
      beatDuration: Number.parseFloat(
        document.querySelector('.battle-shell')?.style.getPropertyValue('--beat-duration') || '0',
      ),
      speedButtons: [...document.querySelectorAll('[data-action="battle-speed"]')]
        .map(button => [button.dataset.speed, button.getAttribute('aria-pressed')]),
      animationPlayState: charge ? getComputedStyle(charge).animationPlayState : 'none',
      playState: animation?.playState ?? 'missing',
      currentTime: animation?.currentTime ?? null,
    };
  }, '.elemental-fx[data-fx-kind="blade"]');

  const oneX = await readChargeMotion();
  assert.equal(oneX.shellPaused, 'false');
  assert.ok(oneX.duration > 0);
  assert.equal(await page.locator('[data-action="battle-speed"][data-speed="1"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-action="battle-speed"][data-speed="2"]').click();
  const twoX = await readChargeMotion();
  assert.ok(twoX.beatDuration < oneX.beatDuration,
    `2x speed should shorten the actual beat schedule: ${JSON.stringify({ oneX, twoX })}`);
  assert.ok(twoX.duration < oneX.duration,
    `2x speed should shorten the active effect itself: ${JSON.stringify({ oneX, twoX })}`);
  assert.equal(await page.locator('[data-action="battle-speed"][data-speed="2"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-action="battle-speed"][data-speed="4"]').click();
  const fourX = await readChargeMotion();
  assert.ok(fourX.beatDuration < twoX.beatDuration,
    `4x speed should shorten the actual beat schedule: ${JSON.stringify({ twoX, fourX })}`);
  assert.ok(fourX.duration < twoX.duration,
    `4x speed should shorten the active effect itself: ${JSON.stringify({ twoX, fourX })}`);
  assert.equal(await page.locator('[data-action="battle-speed"][data-speed="4"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-action="battle-speed"][data-speed="1"]').click();

  await showCursor(page, fixture, fixture.volleyCursors[3]);
  await assertCurrentCues(page, fixture, fixture.volleyCursors[3]);
  const fxSelector = '.elemental-fx[data-fx-kind="volley"]';
  const readProjectileMotion = () => page.evaluate(selector => {
    const host = document.querySelector(selector);
    const projectile = host?.querySelector('.elemental-fx__projectile');
    const animation = projectile?.getAnimations().find(item => item.animationName === 'shanhai-fx-flight');
    return {
      shellPaused: document.querySelector('.battle-shell')?.getAttribute('data-paused'),
      animationPlayState: projectile ? getComputedStyle(projectile).animationPlayState : 'none',
      playState: animation?.playState ?? 'missing',
      currentTime: animation?.currentTime ?? null,
    };
  }, fxSelector);

  await page.locator('[data-action="battle-pause"]').click();
  await page.waitForFunction(() => document.querySelector('.battle-shell')?.dataset.paused === 'true');
  const paused = await readProjectileMotion();
  assert.equal(paused.animationPlayState, 'paused', 'pause control must pause the CSS projectile');
  assert.equal(paused.playState, 'paused', 'Web Animations API must report the projectile paused');
  assert.ok(paused.currentTime !== null, 'paused projectile animation should have a current time');
  await page.waitForTimeout(140);
  const stillPaused = await readProjectileMotion();
  assert.equal(stillPaused.currentTime, paused.currentTime,
    'CSS projectile time must remain fixed while the real battle is paused');

  const beforePausedSpeedChange = await page.evaluate(selector => {
    const host = document.querySelector(selector);
    const projectile = host?.querySelector('.elemental-fx__projectile');
    const animation = projectile?.getAnimations().find(item => item.animationName === 'shanhai-fx-flight');
    if (!host || !projectile || !animation) throw new Error('paused projectile is missing');
    const duration = Number.parseFloat(host.style.getPropertyValue('--fx-duration'));
    animation.currentTime = duration * 0.45;
    const rect = projectile.getBoundingClientRect();
    return { duration, x: rect.x, y: rect.y };
  }, fxSelector);
  await page.locator('[data-action="battle-speed"][data-speed="4"]').click();
  const afterPausedSpeedChange = await page.evaluate(selector => {
    const host = document.querySelector(selector);
    const projectile = host?.querySelector('.elemental-fx__projectile');
    const animation = projectile?.getAnimations().find(item => item.animationName === 'shanhai-fx-flight');
    const rect = projectile?.getBoundingClientRect();
    return {
      duration: Number.parseFloat(host?.style.getPropertyValue('--fx-duration') || '0'),
      x: rect?.x, y: rect?.y, time: animation?.currentTime,
      paused: document.querySelector('.battle-shell')?.getAttribute('data-paused'),
    };
  }, fxSelector);
  assert.equal(afterPausedSpeedChange.paused, 'true');
  assert.ok(afterPausedSpeedChange.duration < beforePausedSpeedChange.duration,
    'changing speed while paused must update the current effect duration');
  assert.ok(Math.abs(afterPausedSpeedChange.x - beforePausedSpeedChange.x) < 1 &&
    Math.abs(afterPausedSpeedChange.y - beforePausedSpeedChange.y) < 1,
  `changing speed while paused must preserve the projectile position: ${JSON.stringify({ beforePausedSpeedChange, afterPausedSpeedChange })}`);
  await page.waitForTimeout(100);
  assert.equal((await readProjectileMotion()).currentTime, afterPausedSpeedChange.time,
    'changing speed must not unpause the projectile');

  await page.locator('[data-action="battle-pause"]').click();
  await page.waitForFunction(() => document.querySelector('.battle-shell')?.dataset.paused === 'false');
  const resumed = await readProjectileMotion();
  assert.equal(resumed.animationPlayState, 'running', 'resume control must restart CSS VFX');
  const restartedTime = await page.evaluate(selector => {
    const animation = document.querySelector(selector)?.querySelector('.elemental-fx__projectile')
      ?.getAnimations().find(item => item.animationName === 'shanhai-fx-flight');
    if (!animation) throw new Error('resumed CSS projectile animation is missing');
    // It can finish while Playwright is interacting with the page. Rewind the
    // same real CSSAnimation so its resumed timeline can be measured.
    animation.currentTime = 0;
    animation.play();
    return Number(animation.currentTime);
  }, fxSelector);
  await page.waitForTimeout(100);
  const advanced = await readProjectileMotion();
  assert.ok(typeof advanced.currentTime === 'number' && advanced.currentTime > restartedTime,
    `CSS projectile time should advance after resume: ${JSON.stringify({ resumed, restartedTime, advanced })}`);
  assert.equal(initial.frameIndex, fixture.castCursor);
}

async function assertReducedMotion(page, fixture) {
  const current = await assertCurrentCues(page, fixture, fixture.attackCursor);
  assert.ok(current.overlays.some(overlay => overlay.kind === fixture.element &&
    overlay.owner === 'player' && overlay.target === 'enemy'),
  `${fixture.method} reduced-motion fixture should contain its real outgoing element`);
  const motion = await page.evaluate(() => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    overlays: [...document.querySelectorAll('.elemental-fx')].map(element => ({
      kind: element.dataset.fxKind,
      visibility: getComputedStyle(element).visibility,
      animationName: getComputedStyle(element.querySelector('.elemental-fx__projectile'))?.animationName,
    })),
  }));
  assert.equal(motion.matches, true, 'browser reduced-motion preference should be active');
  assert.ok(motion.overlays.length > 0 && motion.overlays.every(overlay =>
    overlay.visibility === 'hidden' && overlay.animationName === 'none'),
  `reduced-motion CSS should hide elemental overlays and disable flight animation: ${JSON.stringify(motion)}`);
}

async function main() {
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const fixtures = {};
  const opened = [];
  try {
    const sword = await openFixture(browser, 'RKF05');
    opened.push(sword);
    const fire = await openFixture(browser, 'RKF04');
    opened.push(fire);
    const poison = await openFixture(browser, 'RKF06');
    opened.push(poison);
    const fireSword = await openFixture(browser, 'RKF04', 'no-preference', true);
    opened.push(fireSword);
    fixtures.RKF05 = sword.fixture;
    fixtures.RKF04 = fire.fixture;
    fixtures.RKF06 = poison.fixture;
    fixtures['RKF04+V2-J2-C'] = fireSword.fixture;

    // Save all requested real-engine screenshots before assertions so failures
    // still leave reviewable evidence of the actual rendered state.
    await showCursor(sword.page, sword.fixture, sword.fixture.volleyCursors[3]);
    const swordShot = await captureMidFlight(
      sword.page, 'rkf05-sword-volley-390.png',
      '.elemental-fx[data-fx-kind="volley"] .elemental-fx__projectile',
    );
    await showCursor(fire.page, fire.fixture, fire.fixture.attackCursor);
    const fireShot = await captureMidFlight(
      fire.page, 'rkf04-fire-390.png',
      '.elemental-fx[data-fx-kind="fire"] .elemental-fx__projectile',
    );
    await showCursor(poison.page, poison.fixture, poison.fixture.attackCursor);
    const poisonShot = await captureMidFlight(
      poison.page, 'rkf06-poison-390.png',
      '.elemental-fx[data-fx-kind="poison"] .elemental-fx__projectile',
    );
    await sword.page.setViewportSize({ width: 1440, height: 900 });
    await captureMidFlight(
      sword.page, 'rkf05-sword-volley-desktop.png',
      '.elemental-fx[data-fx-kind="volley"] .elemental-fx__projectile',
    );
    assertMidFlightCapture(swordShot, 'volley');
    assertMidFlightCapture(fireShot, 'fire');
    assertMidFlightCapture(poisonShot, 'poison');
    assert.equal(sword.fixture.battleInputMethod, 'RKF05');
    assert.equal(sword.fixture.volleyDamageFrameIndexes[2].length, 2,
      'the 2-sword volley must come from two real current-beat damage snapshots');
    assert.equal(sword.fixture.volleyDamageFrameIndexes[3].length, 3,
      'the 3-sword volley must come from three real current-beat damage snapshots');

    await showCursor(sword.page, sword.fixture, sword.fixture.castCursor);
    const bladeCast = await assertCurrentCues(sword.page, sword.fixture, sword.fixture.castCursor);
    assert.ok(bladeCast.overlays.some(overlay => overlay.kind === 'blade' && overlay.owner === 'player' &&
      overlay.target === 'enemy' && overlay.phase === 'cast'),
    'real RKF05 action should render a blade cast cue');

    for (const count of [1, 2, 3]) {
      const cursor = sword.fixture.volleyCursors[count];
      await showCursor(sword.page, sword.fixture, cursor);
      const volley = await assertCurrentCues(sword.page, sword.fixture, cursor);
      const fx = volley.overlays.filter(overlay => overlay.kind === 'volley');
      const currentHitIndexes = sword.fixture.volleyDamageFrameIndexes[count].filter(index => index <= cursor);
      assert.equal(currentHitIndexes.length, count,
        `cursor ${cursor}: expected ${count} actual visible volley damage frames`);
      assert.equal(fx.length, 1, `cursor ${cursor}: expected one independent volley effect`);
      assert.equal(fx[0].target, 'enemy', `cursor ${cursor}: sword volley must point at the enemy`);
      assert.equal(fx[0].count, count, `cursor ${cursor}: projectile data count should match actual hits`);
      assert.equal(fx[0].projectileCount, count,
        `cursor ${cursor}: independent projectiles should equal current-beat real damage frames`);
    }

    await showCursor(sword.page, sword.fixture, sword.fixture.reverseFireCursor);
    const enemyFire = await assertCurrentCues(sword.page, sword.fixture, sword.fixture.reverseFireCursor);
    assert.ok(enemyFire.overlays.some(overlay => overlay.kind === 'fire' && overlay.owner === 'enemy' &&
      overlay.target === 'player' && overlay.phase === 'cast'),
    'a real RKF04 enemy action should aim from enemy to player');
    await showCursor(sword.page, sword.fixture, sword.fixture.reverseFireTravelCursor);
    const enemyFireTravel = await assertCurrentCues(
      sword.page, sword.fixture, sword.fixture.reverseFireTravelCursor,
    );
    const incomingFire = enemyFireTravel.overlays.find(overlay => overlay.kind === 'fire' &&
      overlay.owner === 'enemy' && overlay.target === 'player' && overlay.phase === 'travel');
    assert.ok(incomingFire, 'real enemy fire damage should travel toward the player');
    const incomingAngle = await sword.page.locator('.elemental-fx[data-owner="enemy"]').first()
      .evaluate(element => getComputedStyle(element).getPropertyValue('--fx-travel-angle').trim());
    assert.equal(incomingAngle, '-90deg', 'enemy projectile CSS direction should point toward the player');

    assert.equal(swordShot.target, 'enemy');
    for (const { width, height } of viewports) {
      await assertResponsiveOverlay(sword.page, sword.fixture, width, height);
    }
    await assertBattleSpeedAndPause(sword.page, sword.fixture);

    assert.equal(fire.fixture.battleInputMethod, 'RKF04');
    await showCursor(fire.page, fire.fixture, fire.fixture.castCursor);
    const fireCast = await assertCurrentCues(fire.page, fire.fixture, fire.fixture.castCursor);
    assert.ok(fireCast.overlays.some(overlay => overlay.kind === 'fire' && overlay.owner === 'player' &&
      overlay.target === 'enemy' && overlay.phase === 'cast'), 'real RKF04 action must have data-fx-kind fire');
    await showCursor(fire.page, fire.fixture, fire.fixture.attackCursor);
    const fireAttack = await assertCurrentCues(fire.page, fire.fixture, fire.fixture.attackCursor);
    assert.ok(fireAttack.overlays.some(overlay => overlay.kind === 'fire' && overlay.owner === 'player' &&
      overlay.target === 'enemy' && overlay.phase === 'travel'), 'RKF04 damage must use fire travel art');
    await showCursor(fire.page, fire.fixture, fire.fixture.statusCursor);
    const fireStatus = await assertCurrentCues(fire.page, fire.fixture, fire.fixture.statusCursor);
    assert.ok(fireStatus.overlays.some(overlay => overlay.kind === 'fire' && overlay.owner === 'player' &&
      overlay.target === 'enemy'), 'a real burn status application must carry fire semantic data');
    await showCursor(fire.page, fire.fixture, fire.fixture.dotCursor);
    const fireDot = await assertCurrentCues(fire.page, fire.fixture, fire.fixture.dotCursor);
    assert.ok(fireDot.overlays.some(overlay => overlay.kind === 'fire' && overlay.owner === 'player' &&
      overlay.target === 'enemy' && overlay.phase === 'impact'), 'a real burn DOT must use fire impact art');
    assert.equal(fireShot.owner, 'player');
    for (const { width, height } of viewports) {
      await assertResponsiveOverlay(fire.page, fire.fixture, width, height);
    }

    const fireSwordCues = await assertCurrentCues(fireSword.page, fireSword.fixture, fireSword.fixture.attackCursor);
    assert.ok(fireSwordCues.overlays.some(overlay => overlay.kind === 'fire' && overlay.phase === 'travel'));
    const swords = fireSwordCues.overlays.find(overlay => overlay.kind === 'blade' && overlay.phase === 'travel');
    assert.equal(swords?.projectileCount, 2, 'two real sword-pill hits should render two swords alongside fire');
    assert.equal(fireSword.fixture.frameMetaAtCursor[fireSword.fixture.attackCursor].strikeVisual, 'sword_pill');
    assertMidFlightCapture(await captureMidFlight(
      fireSword.page, 'rkf04-fire-sword-pills-390.png',
      '.elemental-fx[data-fx-kind="blade"] .elemental-fx__projectile', true,
    ), 'blade');

    assert.equal(poison.fixture.battleInputMethod, 'RKF06');
    await showCursor(poison.page, poison.fixture, poison.fixture.castCursor);
    const poisonCast = await assertCurrentCues(poison.page, poison.fixture, poison.fixture.castCursor);
    assert.ok(poisonCast.overlays.some(overlay => overlay.kind === 'poison' && overlay.owner === 'player' &&
      overlay.target === 'enemy' && overlay.phase === 'cast'), 'real RKF06 action must have data-fx-kind poison');
    await showCursor(poison.page, poison.fixture, poison.fixture.attackCursor);
    const poisonAttack = await assertCurrentCues(poison.page, poison.fixture, poison.fixture.attackCursor);
    assert.ok(poisonAttack.overlays.some(overlay => overlay.kind === 'poison' && overlay.owner === 'player' &&
      overlay.target === 'enemy' && overlay.phase === 'travel'), 'RKF06 damage must use poison travel art');
    await showCursor(poison.page, poison.fixture, poison.fixture.statusCursor);
    const poisonStatus = await assertCurrentCues(poison.page, poison.fixture, poison.fixture.statusCursor);
    assert.ok(poisonStatus.overlays.some(overlay => overlay.kind === 'poison' && overlay.owner === 'player' &&
      overlay.target === 'enemy'), 'a real poison status application must carry poison semantic data');
    await showCursor(poison.page, poison.fixture, poison.fixture.dotCursor);
    const poisonDot = await assertCurrentCues(poison.page, poison.fixture, poison.fixture.dotCursor);
    assert.ok(poisonDot.overlays.some(overlay => overlay.kind === 'poison' && overlay.owner === 'player' &&
      overlay.target === 'enemy' && overlay.phase === 'impact'), 'a real poison DOT must use poison impact art');
    assert.equal(poisonShot.owner, 'player');
    for (const { width, height } of viewports) {
      await assertResponsiveOverlay(poison.page, poison.fixture, width, height);
    }

    const reduced = await openFixture(browser, 'RKF06', 'reduce');
    opened.push(reduced);
    await assertReducedMotion(reduced.page, reduced.fixture);
    for (const { width, height } of viewports) {
      await assertResponsiveOverlay(reduced.page, reduced.fixture, width, height);
    }

    assert.deepEqual(pageErrors, [], `browser runtime errors: ${pageErrors.join(' | ')}`);
    console.log(JSON.stringify({
      result: 'ok',
      summary: '真实剑修齐射、火与毒状态/DOT、敌方来袭、CSS 动画与响应式验收',
      fixtures: Object.fromEntries(Object.entries(fixtures).map(([method, fixture]) => [method, {
        seed: fixture.seed,
        enemyMethod: fixture.enemyMethod,
        frameCount: fixture.frameCount,
      }])),
      screenshots: [
        'rkf05-sword-volley-390.png',
        'rkf04-fire-390.png',
        'rkf04-fire-sword-pills-390.png',
        'rkf06-poison-390.png',
        'rkf05-sword-volley-desktop.png',
      ].map(filename => path.join(screenshotDir, filename)),
    }, null, 2));
  } finally {
    for (const item of opened) await item.context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
