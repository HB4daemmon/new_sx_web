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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
  });
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
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    const rig = await BattleRig.create(canvas, library, images);
    const report = { samples: 0, maxError: 0, rows: [], sheets: [] };
    const actions = ['idle', 'attack', 'rage', 'artifact', 'heal', 'hit', 'guard'];
    const phaseActions = actions.filter(action => action !== 'idle');
    const phaseFractions = [.22, .44, .55, .70, .85];
    const cellWidth = 384, cellHeight = 512, sheetHeading = 38, cellHeading = 44;
    const contactWidth = 640, contactHeight = 620, contactScale = .98;
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
      const phaseSheets = new Map(phaseActions.map(action => {
        const sheet = document.createElement('canvas');
        sheet.width = cellWidth * phaseFractions.length;
        sheet.height = sheetHeading + cellHeight;
        sheet.dataset.reviewSheet = `${id}-${action}`;
        const sheetContext = sheet.getContext('2d');
        sheetContext.fillStyle = '#f1f4ef';
        sheetContext.fillRect(0, 0, sheet.width, sheet.height);
        sheetContext.fillStyle = '#dce5dd';
        sheetContext.fillRect(0, 0, sheet.width, sheetHeading);
        sheetContext.fillStyle = '#263936';
        sheetContext.font = 'bold 18px sans-serif';
        sheetContext.fillText(`${id} ${action}`, 12, 26);
        document.body.append(sheet);
        report.sheets.push(`${id}-${action}`);
        return [action, { canvas: sheet, context: sheetContext }];
      }));
      const playerDisplay = rig.armatures.get('player').display;
      playerDisplay.scale.set(contactScale, contactScale);
      playerDisplay.position.set(contactWidth / 2, contactHeight - 30);
      const union = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (const action of actions) for (const fraction of [0, .16, .22, .29, .44, .54, .70, .86, .99]) {
        const armature = rig.armatures.get('player');
        armature.animation.gotoAndStopByTime(action, durations[action] / 1000 * fraction);
        armature.advanceTime(0);
        rig.factory.dragonBones.advanceTime(0);
        const bounds = playerDisplay.getBounds();
        union.left = Math.min(union.left, bounds.x); union.top = Math.min(union.top, bounds.y);
        union.right = Math.max(union.right, bounds.x + bounds.width);
        union.bottom = Math.max(union.bottom, bounds.y + bounds.height);
      }
      const cropHeight = Math.max((union.bottom - union.top) * 1.1,
        (union.right - union.left) * 1.1 / (cellWidth / (cellHeight - cellHeading)));
      const cropWidth = cropHeight * cellWidth / (cellHeight - cellHeading);
      const cropX = Math.max(0, Math.min(contactWidth - cropWidth,
        (union.left + union.right - cropWidth) / 2));
      const cropY = Math.max(0, Math.min(contactHeight - cropHeight,
        (union.top + union.bottom - cropHeight) / 2));
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
            report.maxError = Math.max(report.maxError,
              distance(project(state.slots.body, bind.neck), bones.head));
            for (const side of ['front', 'back']) {
              const upper = bones[`${side}Arm`], hand = bones[`${side}Hand`];
              const end = { x: upper.x + upper.a * upper.length, y: upper.y + upper.b * upper.length };
              const upperSprite = state.slots[`${side}Arm`], handSprite = state.slots[`${side}Hand`];
              report.maxError = Math.max(report.maxError,
                distance(end, hand),
                distance(project(upperSprite, bind.upper[0]), upper),
                distance(project(upperSprite, bind.upper[1]), hand),
                distance(project(handSprite, bind.forearm[0]), hand),
                distance(project(handSprite, bind.forearm[1]),
                  side === 'front' ? bones.grip : {
                    x: hand.x + hand.a * hand.length, y: hand.y + hand.b * hand.length,
                  }));
            }
            const weaponPivot = definition.skin[0].slot.find(slot => slot.name === 'weapon').display[0].pivot;
            report.maxError = Math.max(report.maxError,
              distance(bones.weapon, bones.grip),
              distance(project(state.slots.weapon, [weaponPivot.x, weaponPivot.y]), bones.grip));
            if (bones.legL.y !== -82 || bones.legR.y !== -82) throw new Error('Foot anchors drifted');
            report.samples++;
          }
          if (phaseActions.includes(action) && phaseFractions.includes(fraction)) {
            const { canvas: sheet, context: sheetContext } = phaseSheets.get(action);
            const cellIndex = phaseFractions.indexOf(fraction);
            const cellX = cellIndex * cellWidth;
            const cellY = sheetHeading;
            const player = rig.armatures.get('player').display;
            const enemy = rig.armatures.get('enemy').display;
            enemy.visible = false;
            rig.renderer.resize(contactWidth, contactHeight);
            player.visible = true;
            player.scale.set(contactScale, contactScale);
            player.position.set(contactWidth / 2, contactHeight - 30);
            rig.renderer.render(rig.stage);

            const bounds = player.getBounds();
            const imageHeight = cellHeight - cellHeading;
            if (cropX < 0 || cropY < 0 ||
                cropX + cropWidth > contactWidth || cropY + cropHeight > contactHeight) {
              throw new Error(`${id} ${action} ${fraction}: character bounds exceed contact viewport`);
            }
            if (cropX > bounds.x || cropY > bounds.y ||
                cropX + cropWidth < bounds.x + bounds.width ||
                cropY + cropHeight < bounds.y + bounds.height) {
              throw new Error(`${id} ${action} ${fraction}: character or weapon would be cropped`);
            }

            sheetContext.fillStyle = '#f1f4ef';
            sheetContext.fillRect(cellX, cellY, cellWidth, cellHeight);
            sheetContext.fillStyle = '#263936';
            sheetContext.font = 'bold 16px sans-serif';
            sheetContext.fillText(`${fraction.toFixed(2)} (${Math.round(fraction * 100)}%)`,
              cellX + 12, cellY + 28);
            const resolution = rig.renderer.resolution;
            sheetContext.drawImage(canvas,
              cropX * resolution, cropY * resolution, cropWidth * resolution, cropHeight * resolution,
              cellX, cellY + cellHeading, cellWidth, imageHeight);
            sheetContext.strokeStyle = '#c5d0c7';
            sheetContext.lineWidth = 1;
            sheetContext.strokeRect(cellX + .5, cellY + .5, cellWidth - 1, cellHeight - 1);

            enemy.visible = true;
            rig.renderer.resize(450, 346);
            rig.draw();
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
    for (const element of [...document.body.children]) {
      if (!element.dataset.reviewRow && !element.dataset.reviewSheet) element.remove();
    }
    document.body.style.margin = '0';
    return report;
  }, { library, skeleton, bindings, durations });
  assert.equal(results.samples, 756);
  assert.ok(results.maxError < .001, `actual sprite joints mismatch by ${results.maxError}px`);
  for (const id of results.rows) {
    await page.locator(`[data-review-row="${id}"]`).screenshot({
      path: new URL(`${id}-actions.png`, captures).pathname, scale: 'css',
    });
  }
  for (const sheet of results.sheets) {
    const target = page.locator(`[data-review-sheet="${sheet}"]`);
    await target.screenshot({
      path: new URL(`${sheet}-phases.png`, captures).pathname, scale: 'css',
    });
    await target.evaluate(element => element.remove());
  }
  console.log(`DragonBones: ${results.samples} actual pose samples, sprite-to-joint error ${results.maxError.toFixed(6)}px`);
  console.log(`DragonBones: ${results.sheets.length} phase contact sheets at ${captures.pathname}`);
  await page.close();
} finally {
  if (browser) await browser.close();
  server.close();
  await once(server, 'close');
}
