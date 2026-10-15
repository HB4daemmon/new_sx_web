import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from './serve.mjs';
import { clips } from '../src/frames-data.js';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/tools/browser-tools/node_modules/playwright');
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captureRoot = path.join(moduleRoot, 'captures', 'frames');
const viewports = [
  { width: 320, height: 568 },
  { width: 320, height: 760 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];
const ragePhases = [
  { phase: 'charge', elapsed: 180 },
  { phase: 'impact', elapsed: clips.rage.impactAt },
  { phase: 'follow', elapsed: clips.rage.impactAt + 300 },
  {
    phase: 'recover',
    elapsed: clips.rage.impactAt + (clips.rage.duration - clips.rage.impactAt) * .56 + 5,
  },
];

await mkdir(captureRoot, { recursive: true });
const server = createPreviewServer();
let browser;
const pages = [];

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
      '/opt/tools/ms-playwright/chromium-1228/chrome-linux/chrome',
    headless: true,
  });

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    pages.push(page);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${origin}/?screen=battle&capture=1`);
    await page.waitForFunction(() =>
      document.querySelector('#preview-app')?.dataset.libraryReady === 'true' &&
      document.querySelector('.combat-rig')?.dataset.engine === 'drawn-frames');
    await page.locator('[data-battle-control="pause"]').click();
    const stageSize = await page.locator('.battle-actors').evaluate(node => ({
      width: node.clientWidth,
      height: node.clientHeight,
    }));
    assert.ok(stageSize.width > 0 && stageSize.height > 0,
      `${viewport.width}x${viewport.height} uses the actual battle actor stage`);

    const setup = await page.evaluate(async () => {
      const ids = ['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05', 'EN-A1-L1'];
      const manifestResponse = await fetch('/assets/frames.json', { cache: 'no-store' });
      if (!manifestResponse.ok) throw new Error('Frame manifest failed to load');
      const manifest = await manifestResponse.json();
      const images = new Map();
      await Promise.all(ids.map(async id => {
        const src = manifest.characters[id].src;
        const image = new Image();
        image.src = src;
        await image.decode();
        images.set(src, image);
      }));

      const stage = document.querySelector('.battle-actors');
      document.querySelector('.combat-rig').style.visibility = 'hidden';
      const canvas = document.createElement('canvas');
      canvas.dataset.battleEffectsRegression = 'true';
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;' +
        'z-index:1;pointer-events:none';
      stage.append(canvas);
      const { FrameBattle } = await import('/rig.js');
      const rig = await FrameBattle.create(canvas, manifest, images);
      rig.timeline.configure({ active: true });
      rig.draw();

      function readPixels() {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) throw new Error('Pixi WebGL context is unavailable');
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return { width, height, pixels };
      }

      async function analyze({ width, height, pixels }) {
        let left = width, top = height, right = -1, bottom = -1;
        let visiblePixels = 0;
        let edgePixels = 0;
        let brightPixels = 0;
        let brightnessMass = 0;
        let playerPalettePixels = 0;
        let enemyPalettePixels = 0;
        const alphaMask = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            const red = pixels[offset];
            const green = pixels[offset + 1];
            const blue = pixels[offset + 2];
            const alpha = pixels[offset + 3];
            if (alpha <= 8) continue;
            alphaMask[y * width + x] = 255;
            visiblePixels++;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
            if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) edgePixels++;

            const luminance = red * .2126 + green * .7152 + blue * .0722;
            brightnessMass += luminance * alpha / 255;
            if (alpha > 16 && luminance > 105) brightPixels++;
            if (alpha > 16 && green > red * 1.16 && blue > red * 1.3 && green > 70) {
              playerPalettePixels++;
            }
            if (alpha > 16 && red > green * 1.18 && red > blue * 1.4) {
              enemyPalettePixels++;
            }
          }
        }
        const rgbaHash = await crypto.subtle.digest('SHA-256', pixels);
        const alphaHash = await crypto.subtle.digest('SHA-256', alphaMask);
        const hex = bytes => [...new Uint8Array(bytes)]
          .map(byte => byte.toString(16).padStart(2, '0')).join('');
        return {
          width, height, left, top, right, bottom, visiblePixels, edgePixels,
          brightPixels, brightnessMass, playerPalettePixels, enemyPalettePixels,
          rgbaHash: hex(rgbaHash),
          alphaHash: hex(alphaHash),
        };
      }

      async function readAnalysis() {
        return analyze(readPixels());
      }

      function setNormalTimeline() {
        rig.timeline.configure({ active: true, paused: false, reduced: false });
      }

      function startRage(side, elapsed) {
        rig.reset();
        setNormalTimeline();
        rig.timeline.clock = 0;
        const impacts = { count: 0 };
        rig.timeline.play(side, 'rage', () => impacts.count++);
        if (elapsed > 0) rig.timeline.advance(elapsed);
        rig.actorLayer.visible = true;
        rig.effectLayer.visible = true;
        rig.draw();
        return impacts;
      }

      async function sampleRage(side, elapsed) {
        const impacts = startRage(side, elapsed);
        const metadata = rig.snapshot()[side].effect;
        rig.actorLayer.visible = false;
        rig.draw();
        const pixels = await readAnalysis();
        rig.actorLayer.visible = true;
        rig.draw();
        return { metadata, impacts: impacts.count, pixels };
      }

      async function inspectSpacing() {
        rig.reset();
        setNormalTimeline();
        rig.timeline.clock = 0;
        rig.actorLayer.visible = true;
        rig.effectLayer.visible = false;
        const actors = {};
        function measureSourceRegion(image, side, sourceRegion) {
          const actor = rig.snapshot()[side];
          const character = rig.actors.get(side).character;
          const [anchorX, anchorY] = character.anchor;
          const direction = side === 'player' ? 1 : -1;
          const resolution = image.width / canvas.clientWidth;
          let left = image.width, top = image.height, right = -1, bottom = -1;
          let visiblePixels = 0;
          for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) {
              if (image.pixels[(y * image.width + x) * 4 + 3] <= 8) continue;
              const worldX = (x + .5) / resolution;
              const worldY = (image.height - y - .5) / resolution;
              const sourceX = anchorX + (worldX - actor.x) / (direction * actor.scale);
              const sourceY = anchorY + (worldY - actor.y) / actor.scale;
              if (sourceX < sourceRegion.left || sourceX > sourceRegion.right ||
                  sourceY < sourceRegion.top || sourceY > sourceRegion.bottom) continue;
              visiblePixels++;
              left = Math.min(left, x);
              top = Math.min(top, y);
              right = Math.max(right, x);
              bottom = Math.max(bottom, y);
            }
          }
          return { left, top, right, bottom, visiblePixels };
        }
        for (const side of ['player', 'enemy']) {
          const other = side === 'player' ? 'enemy' : 'player';
          rig.actors.get(other).sprite.visible = false;
          rig.draw();
          const image = readPixels();
          actors[side] = {
            ...await analyze(image),
            torsoBounds: measureSourceRegion(image, side,
              { left: 65, right: 265, top: 85, bottom: 330 }),
            footBounds: measureSourceRegion(image, side,
              { left: 25, right: 310, top: 350, bottom: 448 }),
          };
          rig.actors.get(other).sprite.visible = true;
        }
        rig.effectLayer.visible = true;
        rig.draw();

        const snapshot = rig.snapshot();
        const oldWidth = canvas.clientWidth - 24;
        const oldScale = Math.min(oldWidth / 520, canvas.clientHeight / 448, 1);
        const oldStance = Math.min(oldWidth * .2, 126 * oldScale);
        const oldAnchorDistance = oldStance * 2;
        return {
          actors,
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          actualAnchorDistance: Math.abs(snapshot.player.x - snapshot.enemy.x),
          oldAnchorDistance,
          spacingRatio: Math.abs(snapshot.player.x - snapshot.enemy.x) / oldAnchorDistance,
          anchorY: { player: snapshot.player.y, enemy: snapshot.enemy.y },
        };
      }

      window.__battleEffectsRegression = {
        canvas,
        rig,
        readAnalysis,
        startRage,
        sampleRage,
        inspectSpacing,
        setNormalTimeline,
        async inspectOrdinaryAttack(impactAt) {
          rig.reset();
          setNormalTimeline();
          rig.timeline.clock = 0;
          let impacts = 0;
          rig.timeline.play('player', 'attack', () => impacts++);
          rig.timeline.advance(impactAt);
          rig.draw();
          const actorEffect = rig.snapshot().player.effect;
          rig.actorLayer.visible = false;
          rig.draw();
          const pixels = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          return {
            impacts,
            effectCount: rig.effects.size,
            effectChildren: rig.effectLayer.children.length,
            actorEffect,
            pixels,
          };
        },
        async inspectPauseAndReset(rageImpactAt) {
          const impacts = startRage('player', rageImpactAt);
          const before = await readAnalysis();
          const heldClock = rig.timeline.clock;
          rig.timeline.configure({ paused: true });
          const advanced = rig.timeline.advance(2000);
          rig.draw();
          const after = await readAnalysis();
          const paused = {
            heldClock,
            currentClock: rig.timeline.clock,
            advanced,
            before,
            after,
            impactCount: impacts.count,
          };

          rig.timeline.configure({ paused: false });
          const resetImpacts = { count: 0 };
          rig.reset();
          rig.timeline.clock = 0;
          rig.timeline.play('player', 'rage', () => resetImpacts.count++);
          rig.timeline.advance(180);
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const beforeReset = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.reset();
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const afterReset = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          return {
            paused,
            reset: {
              before: beforeReset,
              after: afterReset,
              impactCount: resetImpacts.count,
              effectCount: rig.effects.size,
              effectChildren: rig.effectLayer.children.length,
            },
          };
        },
        async inspectReducedMotion() {
          rig.reset();
          setNormalTimeline();
          rig.timeline.clock = 0;
          let impacts = 0;
          rig.timeline.play('player', 'rage', () => impacts++);
          rig.timeline.advance(180);
          rig.draw();
          rig.timeline.configure({ reduced: true });
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const afterSettle = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          rig.timeline.configure({ reduced: true });
          rig.timeline.advance(2000);
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const afterWait = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          const settledCount = impacts;

          rig.timeline.play('enemy', 'rage', () => impacts++);
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const immediatePlay = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          rig.timeline.configure({ reduced: true });
          rig.timeline.advance(2000);
          rig.draw();
          return {
            settledCount,
            finalCount: impacts,
            actionCount: rig.timeline.actions.size,
            effectCount: rig.effects.size,
            effectChildren: rig.effectLayer.children.length,
            afterSettle,
            afterWait,
            immediatePlay,
          };
        },
        async inspectCompletionAndBattleExit(rageDuration, rageImpactAt) {
          rig.reset();
          setNormalTimeline();
          rig.timeline.clock = 0;
          let completionImpacts = 0;
          rig.timeline.play('player', 'rage', () => completionImpacts++);
          rig.timeline.advance(rageDuration);
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const afterCompletion = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          rig.timeline.advance(rageDuration);
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const afterExtraTime = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          const completion = {
            impactCount: completionImpacts,
            actionCount: rig.timeline.actions.size,
            effectCount: rig.effects.size,
            effectChildren: rig.effectLayer.children.length,
            afterCompletion,
            afterExtraTime,
          };

          rig.reset();
          setNormalTimeline();
          rig.timeline.clock = 0;
          let exitImpacts = 0;
          rig.timeline.play('enemy', 'rage', () => exitImpacts++);
          rig.timeline.advance(rageImpactAt);
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const beforeExit = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          const exitClock = rig.timeline.clock;
          rig.configure({ active: false });
          rig.actorLayer.visible = false;
          rig.draw();
          const afterExit = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          rig.timeline.advance(rageDuration * 2);
          return {
            completion,
            exit: {
              before: beforeExit,
              after: afterExit,
              impactCount: exitImpacts,
              clock: rig.timeline.clock,
              exitClock,
              active: rig.timeline.active,
              actionCount: rig.timeline.actions.size,
              effectCount: rig.effects.size,
              effectChildren: rig.effectLayer.children.length,
              frameId: rig.frameId,
            },
          };
        },
        async inspectSimultaneousRage(rageDuration, rageImpactAt) {
          rig.reset();
          setNormalTimeline();
          rig.timeline.clock = 0;
          const impacts = { player: 0, enemy: 0 };
          rig.timeline.play('player', 'rage', () => impacts.player++);
          rig.timeline.play('enemy', 'rage', () => impacts.enemy++);
          rig.timeline.advance(rageImpactAt);
          rig.draw();
          const phases = {
            player: rig.snapshot().player.effect,
            enemy: rig.snapshot().enemy.effect,
          };
          rig.actorLayer.visible = false;
          rig.draw();
          const atImpact = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.timeline.advance(rageDuration - rageImpactAt);
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const afterCompletion = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          return {
            impacts,
            phases,
            atImpact,
            afterCompletion,
            actionCount: rig.timeline.actions.size,
            effectCount: rig.effects.size,
            effectChildren: rig.effectLayer.children.length,
          };
        },
        async inspectPagehide() {
          rig.reset();
          setNormalTimeline();
          rig.timeline.clock = 0;
          let impacts = 0;
          rig.timeline.play('player', 'rage', () => impacts++);
          rig.timeline.advance(180);
          rig.draw();
          rig.actorLayer.visible = false;
          rig.draw();
          const before = await readAnalysis();
          rig.actorLayer.visible = true;
          rig.draw();
          const effect = rig.effects.get('player');
          window.addEventListener('pagehide', () => rig.dispose(), { once: true });
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
          return {
            before,
            impacts,
            disposed: rig.disposed,
            actionCount: rig.timeline.actions.size,
            effectCount: rig.effects.size,
            effectChildren: rig.effectLayer.children.length,
            effectDestroyed: effect.rage.destroyed,
            appSnapshotRemoved: document.querySelector('.combat-rig').getFrameSnapshot === undefined,
          };
        },
        cleanup() {
          rig.dispose();
          canvas.remove();
        },
      };
      return { width: canvas.clientWidth, height: canvas.clientHeight };
    });
    assert.deepEqual(setup, stageSize,
      `${viewport.width}x${viewport.height} test canvas matches .battle-actors`);

    const spacing = await page.evaluate(() =>
      window.__battleEffectsRegression.inspectSpacing());
    const pixelRatio = spacing.actors.player.width / spacing.width;
    for (const [side, bounds] of Object.entries(spacing.actors)) {
      assert.ok(bounds.visiblePixels >= 1500,
        `${viewport.width}x${viewport.height} ${side} renders real actor pixels: ${JSON.stringify(bounds)}`);
      assert.equal(bounds.edgePixels, 0,
        `${viewport.width}x${viewport.height} ${side} pixels stay inside the stage`);
      assert.ok(bounds.left > 0 && bounds.top > 0 &&
        bounds.right < bounds.width - 1 && bounds.bottom < bounds.height - 1,
      `${viewport.width}x${viewport.height} ${side} has pixel padding on every edge`);
      assert.ok(bounds.height - bounds.bottom > 1.5 * pixelRatio,
        `${viewport.width}x${viewport.height} ${side} feet do not touch the bottom edge`);
    }
    assert.ok(spacing.actors.enemy.left - spacing.actors.player.right >= 12 * pixelRatio,
      `${viewport.width}x${viewport.height} player and enemy silhouettes have a clear horizontal gap: ` +
      `${spacing.actors.player.right}..${spacing.actors.enemy.left}`);
    assert.ok(spacing.actors.enemy.torsoBounds.left -
      spacing.actors.player.torsoBounds.right >= 24 * pixelRatio,
    `${viewport.width}x${viewport.height} torsos have a clear pixel gap: ` +
    `${JSON.stringify({
      player: spacing.actors.player.torsoBounds,
      enemy: spacing.actors.enemy.torsoBounds,
    })}`);
    assert.ok(spacing.actors.enemy.footBounds.left -
      spacing.actors.player.footBounds.right >= 12 * pixelRatio,
    `${viewport.width}x${viewport.height} feet have a clear pixel gap: ` +
    `${JSON.stringify({
      player: spacing.actors.player.footBounds,
      enemy: spacing.actors.enemy.footBounds,
    })}`);
    assert.ok(Math.abs(spacing.actors.player.bottom - spacing.actors.enemy.bottom) <= 12 * pixelRatio,
      `${viewport.width}x${viewport.height} player and enemy feet share a visible baseline`);
    assert.ok(spacing.spacingRatio >= 1.25,
      `${viewport.width}x${viewport.height} anchor spacing is at least 25% above old layout: ` +
      `${JSON.stringify({
        actual: spacing.actualAnchorDistance,
        old: spacing.oldAnchorDistance,
        ratio: spacing.spacingRatio,
      })}`);
    await page.screenshot({
      path: path.join(captureRoot, `spacing-idle-${viewport.width}-${viewport.height}.png`),
      animations: 'disabled',
    });

    const ordinaryAttack = await page.evaluate(impactAt =>
      window.__battleEffectsRegression.inspectOrdinaryAttack(impactAt), clips.attack.impactAt);
    assert.equal(ordinaryAttack.impacts, 1,
      `${viewport.width}x${viewport.height} ordinary attack reaches its real contact time`);
    assert.equal(ordinaryAttack.effectCount, 0);
    assert.equal(ordinaryAttack.effectChildren, 0);
    assert.equal(ordinaryAttack.actorEffect, null);
    assert.equal(ordinaryAttack.pixels.visiblePixels, 0,
      `${viewport.width}x${viewport.height} ordinary attack has no effect-layer pixels`);

    const sideReports = {};
    for (const side of ['player', 'enemy']) {
      sideReports[side] = {};
      for (const { phase, elapsed } of ragePhases) {
        const report = await page.evaluate(({ side, elapsed }) =>
          window.__battleEffectsRegression.sampleRage(side, elapsed), { side, elapsed });
        assert.equal(report.metadata.action, 'rage',
          `${viewport.width}x${viewport.height} ${side} ${phase} snapshot identifies rage`);
        assert.equal(report.metadata.phase, phase,
          `${viewport.width}x${viewport.height} ${side} expected ${phase}: ${JSON.stringify(report.metadata)}`);
        assert.ok(report.pixels.visiblePixels >= 40,
          `${viewport.width}x${viewport.height} ${side} ${phase} draws actual effect pixels: ` +
          `${JSON.stringify(report.pixels)}`);
        assert.equal(report.pixels.edgePixels, 0,
          `${viewport.width}x${viewport.height} ${side} ${phase} effect pixels stay inside the stage`);
        assert.ok(report.pixels.left > 0 && report.pixels.top > 0 &&
          report.pixels.right < report.pixels.width - 1 &&
          report.pixels.bottom < report.pixels.height - 1,
        `${viewport.width}x${viewport.height} ${side} ${phase} effect has safe pixel bounds`);
        const expectedColorPixels = side === 'player'
          ? report.pixels.playerPalettePixels
          : report.pixels.enemyPalettePixels;
        assert.ok(expectedColorPixels >= 12,
          `${viewport.width}x${viewport.height} ${side} ${phase} uses its actual color palette: ` +
          `${JSON.stringify(report.pixels)}`);
        assert.equal(report.impacts, phase === 'charge' ? 0 : 1,
          `${viewport.width}x${viewport.height} ${side} ${phase} emits contact once`);
        sideReports[side][phase] = report;
      }

      const contact = await page.evaluate(({ side, elapsed }) =>
        window.__battleEffectsRegression.startRage(side, elapsed).count,
      { side, elapsed: clips.rage.impactAt });
      assert.equal(contact, 1);
      await page.screenshot({
        path: path.join(captureRoot, `rage-${side}-${viewport.width}-${viewport.height}.png`),
        animations: 'disabled',
      });
    }

    for (const side of ['player', 'enemy']) {
      const charge = sideReports[side].charge.pixels;
      const contact = sideReports[side].impact.pixels;
      assert.ok(contact.brightPixels >= charge.brightPixels * 1.2 &&
        contact.brightPixels >= charge.brightPixels + 10,
      `${viewport.width}x${viewport.height} ${side} contact has visibly more bright effect pixels than charge: ` +
      `${JSON.stringify({ charge: charge.brightPixels, contact: contact.brightPixels })}`);
    }
    assert.notEqual(sideReports.player.impact.pixels.rgbaHash,
      sideReports.enemy.impact.pixels.rgbaHash,
    `${viewport.width}x${viewport.height} player and enemy actual effect pixel fingerprints differ`);
    assert.notEqual(sideReports.player.impact.pixels.alphaHash,
      sideReports.enemy.impact.pixels.alphaHash,
    `${viewport.width}x${viewport.height} player and enemy actual effect geometry fingerprints differ`);
    assert.ok(sideReports.player.impact.pixels.playerPalettePixels > 0);
    assert.equal(sideReports.player.impact.pixels.enemyPalettePixels, 0);
    assert.ok(sideReports.enemy.impact.pixels.enemyPalettePixels > 0);
    assert.equal(sideReports.enemy.impact.pixels.playerPalettePixels, 0);

    const pauseAndReset = await page.evaluate(impactAt =>
      window.__battleEffectsRegression.inspectPauseAndReset(impactAt), clips.rage.impactAt);
    assert.equal(pauseAndReset.paused.heldClock, pauseAndReset.paused.currentClock);
    assert.equal(pauseAndReset.paused.advanced, 0);
    assert.equal(pauseAndReset.paused.before.rgbaHash, pauseAndReset.paused.after.rgbaHash,
      `${viewport.width}x${viewport.height} pausing preserves rendered rage pixels`);
    assert.equal(pauseAndReset.paused.impactCount, 1);
    assert.ok(pauseAndReset.reset.before.visiblePixels >= 40);
    assert.equal(pauseAndReset.reset.after.visiblePixels, 0,
      `${viewport.width}x${viewport.height} reset removes rage effect pixels`);
    assert.equal(pauseAndReset.reset.impactCount, 0);
    assert.equal(pauseAndReset.reset.effectCount, 0);
    assert.equal(pauseAndReset.reset.effectChildren, 0);

    const reduced = await page.evaluate(() =>
      window.__battleEffectsRegression.inspectReducedMotion());
    assert.equal(reduced.settledCount, 1,
      `${viewport.width}x${viewport.height} reduced motion settles a waiting impact once`);
    assert.equal(reduced.finalCount, 2,
      `${viewport.width}x${viewport.height} a second reduced rage settles once immediately`);
    assert.equal(reduced.actionCount, 0);
    assert.equal(reduced.effectCount, 0);
    assert.equal(reduced.effectChildren, 0);
    for (const [label, pixels] of [
      ['settle', reduced.afterSettle],
      ['wait', reduced.afterWait],
      ['immediate play', reduced.immediatePlay],
    ]) {
      assert.equal(pixels.visiblePixels, 0,
        `${viewport.width}x${viewport.height} reduced ${label} has no effect pixels`);
    }

    const lifecycle = await page.evaluate(({ duration, impactAt }) =>
      window.__battleEffectsRegression.inspectCompletionAndBattleExit(duration, impactAt),
    { duration: clips.rage.duration, impactAt: clips.rage.impactAt });
    assert.equal(lifecycle.completion.impactCount, 1);
    assert.equal(lifecycle.completion.actionCount, 0);
    assert.equal(lifecycle.completion.effectCount, 0);
    assert.equal(lifecycle.completion.effectChildren, 0);
    assert.equal(lifecycle.completion.afterCompletion.visiblePixels, 0);
    assert.equal(lifecycle.completion.afterExtraTime.visiblePixels, 0);
    assert.equal(lifecycle.exit.before.visiblePixels >= 40, true);
    assert.equal(lifecycle.exit.after.visiblePixels, 0,
      `${viewport.width}x${viewport.height} leaving battle removes active rage pixels`);
    assert.equal(lifecycle.exit.impactCount, 1);
    assert.equal(lifecycle.exit.clock, lifecycle.exit.exitClock);
    assert.equal(lifecycle.exit.active, false);
    assert.equal(lifecycle.exit.actionCount, 0);
    assert.equal(lifecycle.exit.effectCount, 0);
    assert.equal(lifecycle.exit.effectChildren, 0);
    assert.equal(lifecycle.exit.frameId, null);

    const simultaneous = await page.evaluate(({ duration, impactAt }) =>
      window.__battleEffectsRegression.inspectSimultaneousRage(duration, impactAt),
    { duration: clips.rage.duration, impactAt: clips.rage.impactAt });
    assert.deepEqual(simultaneous.impacts, { player: 1, enemy: 1 });
    assert.equal(simultaneous.phases.player.phase, 'impact');
    assert.equal(simultaneous.phases.enemy.phase, 'impact');
    assert.ok(simultaneous.atImpact.visiblePixels >= 80,
      `${viewport.width}x${viewport.height} simultaneous rage draws both effects`);
    assert.equal(simultaneous.actionCount, 0);
    assert.equal(simultaneous.effectCount, 0);
    assert.equal(simultaneous.effectChildren, 0);
    assert.equal(simultaneous.afterCompletion.visiblePixels, 0);

    const pagehide = await page.evaluate(() =>
      window.__battleEffectsRegression.inspectPagehide());
    assert.ok(pagehide.before.visiblePixels >= 40,
      `${viewport.width}x${viewport.height} rage pixels exist before pagehide`);
    assert.equal(pagehide.impacts, 0,
      `${viewport.width}x${viewport.height} pagehide cancels an unimpacted rage`);
    assert.equal(pagehide.disposed, true);
    assert.equal(pagehide.actionCount, 0);
    assert.equal(pagehide.effectCount, 0);
    assert.equal(pagehide.effectChildren, 0);
    assert.equal(pagehide.effectDestroyed, true);
    assert.equal(pagehide.appSnapshotRemoved, true,
      `${viewport.width}x${viewport.height} pagehide disposes the real battle rig`);
    assert.deepEqual(pageErrors, [],
      `${viewport.width}x${viewport.height} battle page has no uncaught errors`);

    const summary = Object.fromEntries(['player', 'enemy'].map(side => [side, {
      phases: Object.fromEntries(ragePhases.map(({ phase }) => [phase, {
        pixels: sideReports[side][phase].pixels.visiblePixels,
        bright: sideReports[side][phase].pixels.brightPixels,
      }])),
      contactPalettePixels: side === 'player'
        ? sideReports[side].impact.pixels.playerPalettePixels
        : sideReports[side].impact.pixels.enemyPalettePixels,
    }]));
    console.log(`Battle spacing/effects/lifecycle passed ${viewport.width}x${viewport.height}: ` +
      `${JSON.stringify({
        stage: { width: spacing.width, height: spacing.height },
        spacingRatio: Number(spacing.spacingRatio.toFixed(3)),
        pixelGap: spacing.actors.enemy.left - spacing.actors.player.right,
        torsoPixelGap: spacing.actors.enemy.torsoBounds.left -
          spacing.actors.player.torsoBounds.right,
        footPixelGap: spacing.actors.enemy.footBounds.left -
          spacing.actors.player.footBounds.right,
        effects: summary,
      })}`);
    await page.evaluate(() => window.__battleEffectsRegression.cleanup());
    await page.close();
  }
  console.log(`Battle effect screenshots written to ${captureRoot}`);
} finally {
  for (const page of pages) {
    if (!page.isClosed()) {
      await page.evaluate(() => window.__battleEffectsRegression?.cleanup()).catch(() => {});
      await page.close();
    }
  }
  if (browser) await browser.close();
  if (server.listening) {
    await new Promise((resolve, reject) => server.close(error =>
      error ? reject(error) : resolve()));
  }
}
