import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { createPreviewServer } from './serve.mjs';
import { clips, poseNames } from '../src/frames-data.js';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/tools/browser-tools/node_modules/playwright');
const captures = new URL('../captures/frames/', import.meta.url);
const ids = ['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05', 'EN-A1-L1'];
const viewportSizes = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];
const actionPlans = Object.fromEntries(Object.entries(clips)
  .filter(([name]) => name !== 'idle')
  .map(([name, clip]) => {
    let frame = 0;
    return [name, {
      duration: clip.duration,
      impactAt: clip.impactAt,
      steps: clip.frames.map(step => {
        const current = { frame: step.frame, at: frame * 1000 / 60 };
        frame += step.frames;
        return current;
      }),
    }];
  }));
const contactStages = [
  { action: 'attack', frame: 1, name: 'earlywindup' },
  { action: 'attack', frame: 2, name: 'latewindup' },
  { action: 'attack', frame: 3, name: 'contact' },
  { action: 'attack', frame: 4, name: 'follow' },
  { action: 'attack', frame: 5, name: 'recover' },
  { action: 'rage', frame: 6, name: 'ragewindup' },
  { action: 'rage', frame: 7, name: 'ragecontact' },
  { action: 'rage', frame: 8, name: 'ragefollow' },
  { action: 'idle', frame: 0, name: 'ready' },
];

await mkdir(captures, { recursive: true });
const server = createPreviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const pages = [];

function fingerprint(dataUrl) {
  return createHash('sha256').update(dataUrl).digest('hex');
}

try {
  browser = await chromium.launch({
    executablePath: '/opt/tools/ms-playwright/chromium-1228/chrome-linux/chrome',
    headless: true,
  });

  const clippingIssues = [];
  for (const viewport of viewportSizes) {
    const page = await browser.newPage({ viewport });
    pages.push(page);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${origin}/?screen=battle&capture=1`);
    await page.waitForFunction(() =>
      document.querySelector('#preview-app')?.dataset.libraryReady === 'true');
    await page.locator('[data-battle-control="pause"]').click();
    const stageSize = await page.locator('.battle-actors').evaluate(node => ({
      width: node.clientWidth,
      height: node.clientHeight,
    }));
    assert.ok(stageSize.width > 0 && stageSize.height > 0,
      `${viewport.width}x${viewport.height} has a real battle actor stage`);

    const auditAtlases = viewport.width === viewportSizes[0].width;
    const results = await page.evaluate(async ({
      ids, actionPlans, poseNames, stageSize, auditAtlases,
    }) => {
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

      const canvas = document.createElement('canvas');
      canvas.style.cssText = `position:fixed;left:0;top:0;width:${stageSize.width}px;` +
        `height:${stageSize.height}px;pointer-events:none;z-index:-1`;
      document.body.append(canvas);
      const { FrameBattle } = await import('/rig.js');
      const rig = await FrameBattle.create(canvas, manifest, images);
      rig.timeline.configure({ active: true });

      async function inspectAtlases() {
        const reports = [];
        for (const id of ids) {
          const character = manifest.characters[id];
          const atlas = images.get(character.src);
          const hashes = [];
          for (let index = 0; index < character.frames.length; index++) {
            const [x, y, width, height] = character.frames[index];
            const cell = document.createElement('canvas');
            cell.width = width;
            cell.height = height;
            const context = cell.getContext('2d', { willReadFrequently: true });
            context.drawImage(atlas, x, y, width, height, 0, 0, width, height);
            const pixels = context.getImageData(0, 0, width, height).data;
            let visible = 0, left = width, top = height, right = -1, bottom = -1;
            for (let py = 0; py < height; py++) {
              for (let px = 0; px < width; px++) {
                if (pixels[(py * width + px) * 4 + 3] === 0) continue;
                visible++;
                left = Math.min(left, px);
                top = Math.min(top, py);
                right = Math.max(right, px);
                bottom = Math.max(bottom, py);
              }
            }
            const hash = await crypto.subtle.digest('SHA-256', pixels);
            hashes.push({
              index,
              visible,
              transparent: width * height - visible,
              padding: Math.min(left, top, width - right - 1, height - bottom - 1),
              sha256: [...new Uint8Array(hash)].map(byte =>
                byte.toString(16).padStart(2, '0')).join(''),
            });
          }
          reports.push({ id, poses: hashes });
        }
        return reports;
      }

      function readBounds() {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) throw new Error('Pixi WebGL context is unavailable');
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let left = width, top = height, right = -1, bottom = -1;
        let visible = 0, edgePixels = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const alpha = pixels[(y * width + x) * 4 + 3];
            if (alpha <= 8) continue;
            visible++;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
            if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) edgePixels++;
          }
        }
        return { width, height, left, top, right, bottom, visible, edgePixels };
      }

      function checkBounds(label, bounds, issues) {
        if (bounds.visible < 1500 || bounds.edgePixels !== 0 ||
            bounds.left < 0 || bounds.top < 0 ||
            bounds.right >= bounds.width - 1 || bounds.bottom >= bounds.height - 1) {
          issues.push(`${label} at ${bounds.width}x${bounds.height}: ${JSON.stringify(bounds)}`);
        }
      }

      const allPoses = new Set();
      const checkedViews = [];
      const viewIssues = [];
      const atlasReports = auditAtlases ? await inspectAtlases() : [];
      for (const id of ids) {
        rig.setCharacter('player', id);
        rig.setCharacter('enemy', id);
        rig.timeline.clock = 0;
        rig.draw();
        const initial = readBounds();
        checkBounds(`${id} ready`, initial, viewIssues);
        checkedViews.push({ id, pose: 'ready', ...initial });

        for (const [action, plan] of Object.entries(actionPlans)) {
          rig.reset();
          rig.timeline.clock = 0;
          let impacts = 0;
          rig.timeline.play('player', action, () => impacts++);
          rig.draw();
          let elapsed = 0;
          let beforeContactChecked = plan.impactAt === null;
          for (const step of plan.steps) {
            const sampleAt = step.at + Math.min(1,
              Math.max(0, ((plan.steps.find(candidate => candidate.at > step.at)?.at ??
                plan.duration) - step.at) / 2));
            const delta = sampleAt - elapsed;
            rig.timeline.advance(delta);
            rig.draw();
            elapsed = sampleAt;
            const frame = rig.snapshot().player.frame;
            if (frame !== step.frame) {
              throw new Error(`${id} ${action} expected frame ${step.frame}, got ${frame}`);
            }
            allPoses.add(frame);
            if (plan.impactAt !== null && sampleAt < plan.impactAt) {
              if (impacts !== 0) throw new Error(`${id} ${action} impacted before contact`);
            } else if (plan.impactAt !== null && step.at === plan.impactAt) {
              if (frame !== (action === 'attack' ? 3 : action === 'rage' ? 7 : step.frame) ||
                  impacts !== 1) {
                throw new Error(`${id} ${action} impact did not land on its contact frame: ` +
                  `frame ${frame}, impacts ${impacts}, time ${rig.timeline.clock}/${plan.impactAt}`);
              }
              beforeContactChecked = true;
            } else if (plan.impactAt !== null && impacts !== 1) {
              throw new Error(`${id} ${action} missed its contact impact`);
            }
            const bounds = readBounds();
            checkBounds(`${id} ${action}/${poseNames[frame]}`, bounds, viewIssues);
          }
          if (!beforeContactChecked) {
            throw new Error(`${id} ${action} did not sample its contact boundary`);
          }
          rig.timeline.advance(plan.duration - elapsed);
          rig.draw();
          if (impacts !== (plan.impactAt === null ? 0 : 1)) {
            throw new Error(`${id} ${action} emitted an unexpected impact count: ${impacts}`);
          }
          if (rig.timeline.actions.size !== 0) {
            throw new Error(`${id} ${action} did not finish`);
          }
        }

        for (const [action, contactFrame, previousFrame] of [
          ['attack', 3, 2], ['rage', 7, 6],
        ]) {
          rig.reset();
          rig.timeline.clock = 0;
          let impacts = 0;
          const plan = actionPlans[action];
          rig.timeline.play('player', action, () => impacts++);
          rig.timeline.advance(plan.impactAt - 1000 / 60);
          rig.draw();
          if (rig.snapshot().player.frame !== previousFrame || impacts !== 0) {
            throw new Error(`${id} ${action} impacted before the contact pose`);
          }
          rig.timeline.advance(1000 / 60);
          rig.draw();
          if (rig.snapshot().player.frame !== contactFrame || impacts !== 1) {
            throw new Error(`${id} ${action} contact frame did not settle exactly once`);
          }
          rig.timeline.advance(1000 / 60);
          rig.draw();
          if (impacts !== 1) throw new Error(`${id} ${action} repeated its contact impact`);
        }

        // Check the mirrored enemy position on the two widest contact poses too.
        for (const [action, frame] of [['attack', 3], ['rage', 7]]) {
          rig.reset();
          rig.timeline.clock = 0;
          const plan = actionPlans[action];
          rig.timeline.play('enemy', action);
          rig.timeline.advance(plan.impactAt);
          rig.draw();
          if (rig.snapshot().enemy.frame !== frame) {
            throw new Error(`${id} mirrored ${action} missed contact frame ${frame}`);
          }
          const mirrored = readBounds();
          checkBounds(`${id} mirrored ${action}/${poseNames[frame]}`, mirrored, viewIssues);
        }
      }

      if (allPoses.size !== poseNames.length) {
        throw new Error(`Not all authored poses rendered: ${[...allPoses].join(',')}`);
      }

      const pausePlan = actionPlans.attack;
      rig.reset();
      rig.timeline.clock = 0;
      rig.timeline.play('player', 'attack');
      rig.timeline.advance(100);
      rig.draw();
      rig.timeline.configure({ paused: true });
      const pausedPixels = canvas.toDataURL();
      const pausedClock = rig.timeline.clock;
      rig.timeline.advance(2000);
      rig.draw();
      if (rig.timeline.clock !== pausedClock || canvas.toDataURL() !== pausedPixels) {
        throw new Error('Paused Pixi pixels or timeline clock changed');
      }
      rig.timeline.configure({ paused: false });
      rig.reset();

      let reducedImpacts = 0;
      rig.timeline.clock = 0;
      rig.timeline.play('player', 'attack', () => reducedImpacts++);
      rig.timeline.configure({ reduced: true });
      rig.timeline.configure({ reduced: true });
      rig.timeline.play('enemy', 'rage', () => reducedImpacts++);
      rig.timeline.advance(pausePlan.duration * 2);
      rig.draw();
      rig.timeline.configure({ reduced: true });
      if (reducedImpacts !== 2 || rig.timeline.actions.size !== 0) {
        throw new Error(`Reduced motion settled actions ${reducedImpacts} times`);
      }
      rig.configure({ active: true, paused: true, reduced: false });
      let canceledImpacts = 0;
      rig.timeline.clock = 0;
      rig.timeline.play('player', 'attack', () => canceledImpacts++);
      rig.configure({ active: false });
      const leftBattleClock = rig.timeline.clock;
      await new Promise(resolve => setTimeout(resolve, 80));
      if (canceledImpacts !== 0 || rig.timeline.actions.size !== 0 ||
          rig.timeline.clock !== leftBattleClock || rig.frameId !== null) {
        throw new Error('Leaving battle did not cancel the pending action clock');
      }

      rig.dispose();
      canvas.remove();
      return { stageSize, checkedViews, poses: [...allPoses], paused: true,
        reducedImpacts, canceledImpacts, viewIssues, atlasReports };
    }, { ids, actionPlans, poseNames, stageSize, auditAtlases });

    assert.equal(results.checkedViews.length, ids.length,
      `${viewport.width}x${viewport.height} renders all six characters`);
    assert.equal(results.poses.length, poseNames.length,
      `${viewport.width}x${viewport.height} renders every authored pose`);
    assert.equal(results.paused, true);
    assert.equal(results.reducedImpacts, 2);
    assert.equal(results.canceledImpacts, 0);
    if (auditAtlases) {
      assert.equal(results.atlasReports.length, ids.length);
      for (const report of results.atlasReports) {
        assert.equal(report.poses.length, 12, `${report.id} has twelve decoded poses`);
        assert.equal(new Set(report.poses.map(pose => pose.sha256)).size, 12,
          `${report.id} poses have distinct decoded pixels`);
        for (const pose of report.poses) {
          assert.ok(pose.visible > 5000, `${report.id}/${poseNames[pose.index]} is nonempty`);
          assert.ok(pose.transparent > 0, `${report.id}/${poseNames[pose.index]} retains alpha`);
          assert.ok(pose.padding >= 3,
            `${report.id}/${poseNames[pose.index]} has edge padding, got ${pose.padding}px`);
        }
      }
    }
    clippingIssues.push(...results.viewIssues.map(issue => `${viewport.width}x${viewport.height}: ${issue}`));
    assert.deepEqual(pageErrors, []);
    console.log(`Pixi frame atlas/actions/padding and lifecycle passed ${viewport.width}x${viewport.height}`);
    await page.close();
  }

  const contactPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pages.push(contactPage);
  const contactErrors = [];
  contactPage.on('pageerror', error => contactErrors.push(error.message));
  await contactPage.goto(origin);
  await contactPage.evaluate(async ({ ids, actionPlans, contactStages }) => {
    const manifest = await (await fetch('/assets/frames.json')).json();
    const images = new Map();
    await Promise.all(ids.map(async id => {
      const src = manifest.characters[id].src;
      const image = new Image();
      image.src = src;
      await image.decode();
      images.set(src, image);
    }));

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:520px;height:448px';
    document.body.append(canvas);
    const { FrameBattle } = await import('/rig.js');
    const rig = await FrameBattle.create(canvas, manifest, images);
    rig.timeline.configure({ active: true });
    rig.actors.get('enemy').sprite.visible = false;
    const sheets = [];
    for (const id of ids) {
      rig.setCharacter('player', id);
      const tiles = [];
      for (const stage of contactStages) {
        rig.reset();
        rig.timeline.clock = 0;
        let at = 0;
        if (stage.action !== 'idle') {
          const plan = actionPlans[stage.action];
          const step = plan.steps.find(candidate => candidate.frame === stage.frame);
          if (!step) throw new Error(`Missing ${id} ${stage.name} contact-sheet sample`);
          at = step.at + 1;
          rig.timeline.play('player', stage.action);
          rig.timeline.advance(at);
        }
        rig.draw();
        if (rig.snapshot().player.frame !== stage.frame) {
          throw new Error(`${id} ${stage.name} contact sheet sampled the wrong pose`);
        }
        const sample = document.createElement('canvas');
        sample.width = canvas.width;
        sample.height = canvas.height;
        sample.getContext('2d').drawImage(canvas, 0, 0);
        tiles.push({
          label: `${stage.name} · ${at.toFixed(1)} ms`,
          canvas: sample,
        });
      }
      sheets.push({ id, tiles });
    }
    rig.dispose();
    canvas.remove();

    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;padding:20px;background:#18211e;color:#f4f1e8;' +
      'font:14px/1.4 system-ui,sans-serif';
    for (const { id, tiles } of sheets) {
      const section = document.createElement('section');
      section.id = `sheet-${id.toLowerCase()}`;
      section.dataset.sheet = id;
      section.style.cssText = 'display:none;width:1300px;max-width:100%;margin:0 auto';
      const title = document.createElement('h1');
      title.textContent = `${id} · attack / rage`;
      title.style.cssText = 'margin:0 0 12px;font-size:24px;font-weight:700';
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px';
      for (const tile of tiles) {
        const figure = document.createElement('figure');
        figure.style.cssText = 'margin:0;overflow:hidden;background:#e9e4d8;color:#222;' +
          'border-radius:4px';
        tile.canvas.style.cssText = 'display:block;width:100%;height:224px;object-fit:contain;' +
          'background:#f4f1e8';
        const caption = document.createElement('figcaption');
        caption.textContent = tile.label;
        caption.style.cssText = 'padding:7px 9px;font-weight:650';
        figure.append(tile.canvas, caption);
        grid.append(figure);
      }
      section.append(title, grid);
      document.body.append(section);
    }
    window.showFrameSheet = id => {
      for (const section of document.querySelectorAll('[data-sheet]')) {
        section.style.display = section.dataset.sheet === id ? 'block' : 'none';
      }
    };
    window.showFrameSheet(ids[0]);
  }, { ids, actionPlans, contactStages });
  assert.deepEqual(contactErrors, []);
  for (const id of ids) {
    await contactPage.evaluate(id => window.showFrameSheet(id), id);
    await contactPage.screenshot({
      path: new URL(`${id.toLowerCase()}-combat.png`, captures).pathname,
      fullPage: true,
    });
  }
  console.log(`Six attack/rage contact sheets written to ${captures.pathname}`);
  assert.deepEqual(clippingIssues, [], 'all rendered character poses stay inside the real actor canvas');
} finally {
  for (const page of pages) await page.close();
  if (browser) await browser.close();
  server.close();
  await once(server, 'close');
}
