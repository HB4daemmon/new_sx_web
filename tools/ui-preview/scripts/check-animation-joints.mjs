import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { createPreviewServer } from './serve.mjs';
import { bindings, createSkeletonData, durations } from '../src/rig-data.js';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/tools/browser-tools/node_modules/playwright');
const captures = new URL('../captures/dragonbones/', import.meta.url);
await mkdir(captures, { recursive: true });
const library = JSON.parse(await readFile(new URL('../public/assets/library.json', import.meta.url)));
const skeleton = createSkeletonData(library);
const server = createPreviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({
    executablePath: '/opt/tools/ms-playwright/chromium-1228/chrome-linux/chrome', headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/?screen=start`);
  await page.waitForFunction(() => document.querySelector('#preview-app').dataset.libraryReady === 'true');
  const results = await page.evaluate(async ({ library, skeleton, bindings, durations }) => {
    const { BattleRig } = await import('/rig.js');
    const images = new Map(await Promise.all(library.assets.map(async asset => {
      const image = new Image(); image.src = asset.src; await image.decode();
      return [asset.src, image];
    })));
    const canvas = document.createElement('canvas');
    canvas.style.width = '450px'; canvas.style.height = '346px';
    document.body.append(canvas);
    const rig = await BattleRig.create(canvas, library, images);
    const report = { samples: 0, maxError: 0, rows: [] };
    const actions = ['idle', 'attack', 'rage', 'artifact', 'heal', 'hit', 'guard'];
    const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
    const project = (slot, point) => ({
      x: slot.x + slot.a * point[0] * slot.width + slot.c * point[1] * slot.height,
      y: slot.y + slot.b * point[0] * slot.width + slot.d * point[1] * slot.height,
    });
    for (const id of Object.keys(bindings)) {
      // The guardian is sampled on both sides; the other five methods stay player-side.
      rig.setCharacter('player', id);
      const row = document.createElement('canvas');
      row.width = 1400; row.height = 275;
      const context = row.getContext('2d');
      context.fillStyle = '#f1f4ef'; context.fillRect(0, 0, row.width, row.height);
      context.fillStyle = '#263936'; context.font = '16px sans-serif';
      context.fillText(library.rigs[id].name, 10, 22);
      for (const [index, action] of actions.entries()) {
        for (const fraction of [0, .12, .22, .33, .44, .55, .7, .85, .99]) {
          for (const armature of rig.armatures.values()) {
            armature.animation.gotoAndStopByTime(action, durations[action] / 1000 * fraction);
            armature.advanceTime(0);
          }
          rig.factory.dragonBones.advanceTime(0);
          rig.draw();
          for (const state of Object.values(rig.snapshot())) {
            const definition = skeleton.armature.find(item => item.name === state.id);
            const bind = bindings[state.id], bones = state.bones;
            for (const side of ['front', 'back']) {
              const upper = bones[`${side}Arm`], hand = bones[`${side}Hand`];
              const end = { x: upper.x + upper.a * upper.length, y: upper.y + upper.b * upper.length };
              const upperSprite = state.slots[`${side}Arm`], handSprite = state.slots[`${side}Hand`];
              report.maxError = Math.max(report.maxError,
                distance(end, hand),
                distance(project(upperSprite, bind.upper[0]), upper),
                distance(project(upperSprite, bind.upper[1]), hand),
                distance(project(handSprite, bind.forearm[0]), hand));
            }
            const weaponPivot = definition.skin[0].slot.find(slot => slot.name === 'weapon').display[0].pivot;
            report.maxError = Math.max(report.maxError,
              distance(bones.weapon, bones.grip),
              distance(project(state.slots.weapon, [weaponPivot.x, weaponPivot.y]), bones.grip));
            if (bones.legL.y !== -82 || bones.legR.y !== -82) throw new Error('Foot anchors drifted');
            report.samples++;
          }
          if (fraction === .44) {
            context.fillText(action, 200 * index + 12, 47);
            const player = rig.armatures.get('player').display;
            const enemy = rig.armatures.get('enemy').display;
            enemy.visible = false;
            player.position.x = 85;
            player.scale.set(.84, .84);
            rig.renderer.render(rig.stage);
            context.drawImage(canvas, 0, 0, 300 * rig.renderer.resolution, canvas.height,
              200 * index + 6, 50, 190, 219);
            enemy.visible = true;
          }
        }
      }
      row.dataset.reviewRow = id;
      document.body.append(row);
      report.rows.push(id);
    }
    rig.dispose(); canvas.remove();
    for (const element of [...document.body.children]) if (!element.dataset.reviewRow) element.remove();
    document.body.style.margin = '0';
    return report;
  }, { library, skeleton, bindings, durations });
  assert.equal(results.samples, 756);
  assert.ok(results.maxError < .001, `actual sprite joints mismatch by ${results.maxError}px`);
  for (const id of results.rows) {
    await page.locator(`[data-review-row="${id}"]`).screenshot({
      path: new URL(`${id}-actions.png`, captures).pathname,
    });
  }
  console.log(`DragonBones: ${results.samples} actual pose samples, sprite-to-joint error ${results.maxError.toFixed(6)}px`);
  await page.close();
} finally {
  if (browser) await browser.close();
  server.close();
  await once(server, 'close');
}
