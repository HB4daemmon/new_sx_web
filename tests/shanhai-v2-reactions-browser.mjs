import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const url = process.env.BROWSER_URL || 'http://localhost:4178/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const replayKey = 'suishi-shanhai-replay-v2-overhaul';
const artifactDir = process.env.BROWSER_ARTIFACTS_DIR || '/tmp/shanhai-v2-reactions-browser';
const viewports = [
  { width: 360, height: 780, battle: 'sword', reducedMotion: true },
  { width: 390, height: 844, battle: 'guard', reducedMotion: false },
  { width: 430, height: 932, battle: 'spring', reducedMotion: false },
  { width: 1440, height: 900, battle: 'sword', reducedMotion: false },
];
const pageErrors = [];
const consoleErrors = [];

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

async function pauseBattleAtLoad(page) {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const pause = document.querySelector('.battle-controls [data-action="battle-pause"]');
      if (pause && pause.getAttribute('aria-pressed') === 'false') {
        observer.disconnect();
        pause.click();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

async function waitForApp(page, phase) {
  await page.locator(`.game-page.phase-${phase}`).waitFor({ state: 'visible' });
}

async function saveScreenshot(page, width, label) {
  const file = path.join(artifactDir, `${width}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  return file;
}

async function installBattleFixture(page, scenario, resumeAtCue = true) {
  return page.evaluate(async ({ scenario, resumeAtCue, saveKey, replayKey }) => {
    const [{ loadContent }, run, combat, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, registerCombatWorker, validateRunState } = run;
    const { calculateStats, simulateBattle } = combat;
    const { saveRun, loadRun } = persistence;
    registerCombatWorker({ calculateStats, simulateBattle });

    const firstCommonNode = game => {
      const node = game.availableNodes().find(candidate => candidate.type === 'C');
      if (!node) throw new Error('Reaction browser fixture has no reachable common battle');
      game.dispatch({ type: 'enter', id: node.key });
      if (game.state.phase !== 'preview') {
        throw new Error('Reaction browser fixture did not enter a battle preview');
      }
      game.dispatch({ type: 'fight' });
    };

    const bossMapGame = (seed, bossId) => {
      const game = ShanhaiGame.create(content, { seed, name: '首领准备验收', method: 'RKF05' });
      const state = game.state;
      state.n = 4;
      state.hp = game.stats.max_hp;
      state.coins = 100;
      const routeMap = state.routeMap;
      const byKey = new Map(routeMap.nodes.map(node => [node.key, node]));
      let node = routeMap.nodes.find(candidate => candidate.depth === 0);
      const path = [];
      const completedNodes = [];
      for (let depth = 0; depth < 10; depth++) {
        if (!node || node.depth !== depth) {
          throw new Error(`Boss route fixture is missing depth ${depth}`);
        }
        node.completed = true;
        path.push(node.key);
        completedNodes.push({ type: node.type, id: node.id, completed: true });
        const next = node.next[0];
        node = next ? byKey.get(next) : undefined;
      }
      if (!node || node.depth !== 10 || node.type !== 'B') {
        throw new Error('Boss route fixture did not reach its authored boss layer');
      }
      node.id = bossId;
      node.completed = false;
      routeMap.path = path;
      state.nodes = completedNodes;
      state.step = 10;
      state.phase = 'map';
      const restored = new ShanhaiGame(content, state);
      if (!restored.availableNodes().some(candidate => candidate.type === 'B' && candidate.id === bossId)) {
        throw new Error(`${bossId} is not reachable from the frozen boss route`);
      }
      return restored;
    };

    const directBattle = (game, {
      seed,
      roundLimit,
      playerStats,
      playerHp,
      playerShield = 0,
      playerMethod,
      enemyStats,
      enemyHp,
    }) => {
      const input = game.state.battleInput;
      if (!input || game.state.phase !== 'battle') throw new Error('Expected a frozen battle input');
      const player = {
        ...structuredClone(input.player),
        ...(playerMethod ? { method: playerMethod, talents: [] } : {}),
        baseStats: { ...playerStats },
        hp: playerHp,
        preparation: playerShield,
      };
      const enemy = {
        ...structuredClone(input.enemy),
        baseStats: { ...enemyStats },
        ...(enemyHp === undefined ? {} : { hp: enemyHp }),
      };
      const battleInput = {
        ...input,
        player,
        enemy,
        seed: `${input.seed}:${seed}`,
        roundLimit,
        rules: 'awakening-v1',
      };
      const result = simulateBattle(content, player, enemy, battleInput.seed, {
        roundLimit,
        artifactAwakenings: true,
      });
      game.state.battleInput = battleInput;
      game.state.battle = result;
      validateRunState(content, game.state);
      return result;
    };

    const completeOneShotBattle = game => {
      firstCommonNode(game);
      const maxHp = game.stats.max_hp;
      directBattle(game, {
        seed: 'reward-fixture',
        roundLimit: 3,
        playerStats: {
          attack: 100000,
          defense: 100,
          max_hp: maxHp,
          crit_rate: 0,
          speed: 100,
        },
        playerHp: maxHp,
        enemyStats: {
          attack: 1,
          defense: 0,
          max_hp: 1,
          crit_rate: 0,
          speed: 1,
        },
      });
      if (game.state.battle.outcome !== 'player') {
        throw new Error(`Reward fixture did not win its actual battle: ${game.state.battle.outcome}`);
      }
      game.dispatch({ type: 'battle_done' });
      if (game.state.phase !== 'reward') throw new Error('Reward fixture did not reach its reward');
    };

    localStorage.removeItem(saveKey);
    localStorage.removeItem(replayKey);

    if (scenario === 'sword' || scenario === 'guard' || scenario === 'spring') {
      const method = { sword: 'RKF05', guard: 'RKF01', spring: 'RKF03' }[scenario];
      const game = ShanhaiGame.create(content, {
        seed: `v2-reaction-browser-${scenario}`,
        name: `${method}真实回放验收`,
        method,
      });
      game.state.n = 4;
      game.state.hp = game.stats.max_hp;
      game.state.coins = 50;
      game.state.preparation = scenario === 'guard' ? 10 : 0;
      firstCommonNode(game);

      const configuration = {
        sword: {
          roundLimit: 3,
          playerStats: { attack: 10, defense: 0, max_hp: 1000, crit_rate: 0, speed: 30 },
          playerHp: 1000,
          enemyStats: { attack: 1, defense: 0, max_hp: 5000, crit_rate: 0, speed: 1 },
        },
        guard: {
          roundLimit: 1,
          playerStats: { attack: 5, defense: 0, max_hp: 1000, crit_rate: 0, speed: 30 },
          playerHp: 1000,
          playerShield: 10,
          enemyStats: { attack: 200, defense: 0, max_hp: 5000, crit_rate: 0, speed: 1 },
        },
        spring: {
          roundLimit: 12,
          playerStats: { attack: 1, defense: 0, max_hp: 10000, crit_rate: 0, speed: 30 },
          playerHp: 5000,
          enemyStats: { attack: 1, defense: 100, max_hp: 100000, crit_rate: 0, speed: 1 },
        },
      }[scenario];
      const battle = directBattle(game, { seed: scenario, ...configuration });
      const cueKind = {
        sword: 'sword_volley',
        guard: 'guard_counter',
        spring: 'spring_bloom',
      }[scenario];
      const cueIndex = battle.frames.findIndex(frame =>
        frame.kind === 'reaction' && frame.cue?.kind === cueKind);
      if (cueIndex < 0) {
        throw new Error(`${scenario} actual combat emitted no ${cueKind} cue`);
      }

      let snapshot;
      if (scenario === 'sword') {
        const swordCounts = [...new Set(battle.frames.flatMap(frame =>
          (frame.player.summons ?? [])
            .filter(summon => summon.id === 'RKF05-V2-RESONANCE')
            .map(summon => summon.count)))].sort((a, b) => a - b);
        if (![1, 2, 3].every(count => swordCounts.includes(count))) {
          throw new Error(`Sword snapshots did not progress 1 -> 2 -> 3: ${swordCounts}`);
        }
        snapshot = { swordCounts };
      } else if (scenario === 'guard') {
        const pressureId = 'RKF01-V2-RESONANCE';
        const pressureValues = battle.frames.flatMap(frame =>
          (frame.player.counters ?? [])
            .filter(counter => counter.id === pressureId)
            .map(counter => counter.value));
        if (!pressureValues.some(value => value > 0) ||
            !battle.frames.some(frame => frame.kind === 'reaction' &&
              frame.cue?.kind === cueKind && frame.player.shield === 0)) {
          throw new Error(`Guard replay lacks a real shield/pressure snapshot: ${pressureValues}`);
        }
        snapshot = { pressureValues };
      } else {
        const springId = 'RKF03-V2-RESONANCE';
        const springSnapshots = battle.frames.flatMap(frame =>
          (frame.player.counters ?? [])
            .filter(counter => counter.id === springId)
            .map(counter => ({ value: counter.value, max: counter.max })));
        if (!springSnapshots.some(counter => counter.value > 0) ||
            !springSnapshots.some(counter => counter.max > 0)) {
          throw new Error(`Spring replay lacks a real charge snapshot: ${JSON.stringify(springSnapshots)}`);
        }
        snapshot = { springSnapshots };
      }

      const saved = saveRun(game);
      const restored = loadRun(content);
      if (!restored || restored.state.battle.frames.length !== battle.frames.length) {
        throw new Error('Deterministic load did not restore the actual reaction replay');
      }
      const restoredCueIndex = restored.state.battle.frames.findIndex(frame =>
        frame.kind === 'reaction' && frame.cue?.kind === cueKind);
      if (restoredCueIndex < 0) throw new Error(`Reloaded replay lost ${cueKind}`);
      const replayCursor = resumeAtCue ? restoredCueIndex : 0;
      const key = [
        restored.state.id,
        restored.state.act,
        restored.state.step,
        restored.state.battle.frames.length,
      ].join(':');
      localStorage.setItem(replayKey, JSON.stringify({ key, cursor: replayCursor }));

      return {
        scenario,
        method,
        methodName: content.byId[method].name,
        cueKind,
        cueIndex: restoredCueIndex,
        frames: restored.state.battle.frames.length,
        rounds: restored.state.battle.rounds,
        outcome: restored.state.battle.outcome,
        replay: saved.replay,
        snapshot,
      };
    }

    if (scenario === 'tidal_charge' || scenario === 'reviving_mist') {
      const bossId = scenario === 'tidal_charge' ? 'EN-A1-B1' : 'EN-A1-B2';
      const game = bossMapGame(`v2-reaction-browser-${scenario}`, bossId);
      const bossNode = game.availableNodes().find(candidate => candidate.id === bossId);
      game.dispatch({ type: 'enter', id: bossNode.key });
      game.dispatch({ type: 'fight' });
      const initial = game.state.battleInput;
      const playerMethod = scenario === 'reviving_mist' ? 'RKF05' : undefined;
      const battle = directBattle(game, scenario === 'tidal_charge'
        ? {
          seed: scenario,
          roundLimit: 3,
          playerStats: { attack: 100, defense: 0, max_hp: 10000, crit_rate: 0, speed: 30 },
          playerHp: 10000,
          enemyStats: { ...initial.enemy.baseStats, attack: 20, defense: 0, max_hp: 100000, speed: 1 },
        }
        : {
          seed: scenario,
          roundLimit: 3,
          playerMethod,
          playerStats: { attack: 0, defense: 100, max_hp: 10000, crit_rate: 0, speed: 30 },
          playerHp: 10000,
          enemyStats: { ...initial.enemy.baseStats, attack: 1, defense: 0, max_hp: 1000, speed: 1 },
          enemyHp: 1,
        });
      const cueIndex = battle.frames.findIndex(frame =>
        frame.kind === 'reaction' && frame.cue?.kind === 'enemy_release');
      if (cueIndex < 0) throw new Error(`${bossId} actual battle emitted no release cue`);
      const chargeId = `${bossId}-TRIAL-CHARGES`;
      const snapshots = battle.frames.flatMap(frame =>
        (frame.enemy.counters ?? [])
          .filter(counter => counter.id === chargeId)
          .map(counter => ({ value: counter.value, max: counter.max })));
      if (!snapshots.some(counter => counter.value === 3 && counter.max === 3) ||
          !snapshots.some(counter => counter.value === 0)) {
        throw new Error(`${bossId} release replay lacks charge snapshots: ${JSON.stringify(snapshots)}`);
      }
      if (scenario === 'tidal_charge') {
        if (!battle.frames.some(frame =>
          frame.kind === 'status' && frame.cue?.kind === 'enemy_charge' && frame.target === 'enemy')) {
          throw new Error('Tidal trial did not record an effective direct-hit interruption');
        }
      } else if (!battle.frames.some(frame =>
        frame.kind === 'heal' && frame.actor === 'enemy' && frame.source === bossId && frame.amount > 0)) {
        throw new Error('Reviving mist release did not heal from its remaining charges');
      }

      const saved = saveRun(game);
      const restored = loadRun(content);
      if (!restored || restored.state.battle.frames.length !== battle.frames.length) {
        throw new Error(`${bossId} deterministic load did not restore the actual trial replay`);
      }
      const restoredCueIndex = restored.state.battle.frames.findIndex(frame =>
        frame.kind === 'reaction' && frame.cue?.kind === 'enemy_release');
      const key = [
        restored.state.id,
        restored.state.act,
        restored.state.step,
        restored.state.battle.frames.length,
      ].join(':');
      localStorage.setItem(replayKey, JSON.stringify({ key, cursor: restoredCueIndex }));
      return {
        scenario,
        bossId,
        bossName: content.byId[bossId].name,
        trialKind: content.byId[bossId].trial.kind,
        cueIndex: restoredCueIndex,
        frames: restored.state.battle.frames.length,
        snapshots,
        replay: saved.replay,
      };
    }

    if (scenario === 'boss_map') {
      const game = bossMapGame('v2-reaction-browser-boss-map', 'EN-A1-B1');
      const saved = saveRun(game);
      const restored = loadRun(content);
      if (!restored || restored.state.phase !== 'map') throw new Error('Boss map fixture failed to reload');
      return { phase: restored.state.phase, bossId: 'EN-A1-B1', replay: saved.replay };
    }

    if (scenario === 'first_reward' || scenario === 'paid_reward') {
      const game = ShanhaiGame.create(content, {
        seed: `v2-reaction-browser-${scenario}`,
        name: '寻缘真实行旅验收',
        method: 'RKF05',
      });
      game.state.n = 4;
      game.state.hp = game.stats.max_hp;
      game.state.coins = 40;
      completeOneShotBattle(game);
      if (scenario === 'first_reward') {
        const preview = game.rewardSearchPreview('sword');
        if (preview.available || preview.reason !== 'guaranteed-core-offer') {
          throw new Error(`Initial core offer was searchable: ${JSON.stringify(preview)}`);
        }
      } else {
        game.dispatch({ type: 'reward', id: null });
        if (game.state.phase !== 'map' || !game.state._coreRewardOffered) {
          throw new Error('Initial offer was not completed before the later reward fixture');
        }
        game.startAct(2);
        const secondMaxHp = game.stats.max_hp;
        game.state.hp = secondMaxHp;
        completeOneShotBattle(game);
        const original = game.state.rewardCandidates.slice();
        const choices = ['guard', 'sword', 'vitality', 'affliction']
          .map(family => ({ family, preview: game.rewardSearchPreview(family) }))
          .filter(item => item.preview.available);
        const selected = choices.sort((left, right) =>
          left.preview.candidates.length - right.preview.candidates.length)[0];
        if (!selected) {
          throw new Error(`No real artifact family can replace this reward: ${JSON.stringify(original)}`);
        }
        const coinsBefore = game.state.coins;
        const paid = selected.preview;
        const saved = saveRun(game);
        const restored = loadRun(content);
        if (!restored ||
            JSON.stringify(restored.state.rewardCandidates) !== JSON.stringify(original) ||
            restored.state.rewardSearches.length !== 0 ||
            restored.state.coins !== coinsBefore) {
          throw new Error('Later reward preview fixture changed its candidates or coins before payment');
        }
        return {
          phase: restored.state.phase,
          act: restored.state.act,
          family: selected.family,
          preview: paid,
          original,
          coinsBefore,
          cost: 8,
          candidateNames: paid.candidates.map(id => content.byId[id].name),
          replay: saved.replay,
        };
      }

      const saved = saveRun(game);
      const restored = loadRun(content);
      if (!restored || restored.state.phase !== 'reward') {
        throw new Error('Initial reward fixture failed to reload');
      }
      return {
        phase: restored.state.phase,
        act: restored.state.act,
        reason: restored.rewardSearchPreview('sword').reason,
        replay: saved.replay,
      };
    }

    throw new Error(`Unknown reaction browser fixture: ${scenario}`);
  }, { scenario, resumeAtCue, saveKey, replayKey });
}

async function assertNoHorizontalOverflow(page, viewport, state) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(metrics.documentWidth <= viewport.width + 1 &&
    metrics.bodyWidth <= viewport.width + 1 &&
    metrics.clientWidth <= viewport.width + 1,
  `${viewport.width}px ${state}: page has horizontal overflow ${JSON.stringify(metrics)}`);
}

async function inspectFighterLayout(page, viewport, scenario) {
  const metrics = await page.evaluate(() => {
    const arena = document.querySelector('.combat-arena');
    const fighter = arena?.querySelector('.combatant[data-side="player"]');
    const fighterRect = fighter?.getBoundingClientRect();
    const selectors = [
      '.fighter-art',
      '.fighter-identity',
      '.fighter-bars',
      '.fighter-summons',
      '.fighter-counters',
    ];
    const boxes = selectors.flatMap(selector => {
      const element = fighter?.querySelector(selector);
      if (!element || element.hidden) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return [];
      return [{
        selector,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }];
    });
    const overlaps = (a, b) => {
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return width > 1 && height > 1
        ? { first: a.selector, second: b.selector, width, height, firstRect: a, secondRect: b }
        : undefined;
    };
    const boxOverlaps = boxes.flatMap((box, index) =>
      boxes.slice(index + 1).map(other => overlaps(box, other)).filter(Boolean));
    const counterItems = [...(fighter?.querySelectorAll('.fighter-counter') ?? [])];
    const summonItems = [
      ...(fighter?.querySelectorAll('.summon-sword, .fighter-summon-name, .fighter-summon-array') ?? []),
    ];
    const itemRects = [
      ...counterItems.map(element => ({ element, container: '.fighter-counters' })),
      ...summonItems.map(element => ({ element, container: '.fighter-summons' })),
    ].map(({ element, container }) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.className,
        container,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    const containmentErrors = itemRects.flatMap(item => {
      const container = fighter?.querySelector(item.container)?.getBoundingClientRect();
      if (!container || (item.left >= container.left - 1 && item.right <= container.right + 1)) return [];
      return [{ container: item.container, item }];
    });
    return {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      arena: arena && {
        left: arena.getBoundingClientRect().left,
        right: arena.getBoundingClientRect().right,
        width: arena.clientWidth,
      },
      fighter: fighterRect && { left: fighterRect.left, right: fighterRect.right },
      boxes,
      boxOverlaps,
      containmentErrors,
      summonText: fighter?.querySelector('.fighter-summons')?.innerText.trim() || '',
      counterText: fighter?.querySelector('.fighter-counters')?.innerText.trim() || '',
      counterCount: fighter?.querySelectorAll('.fighter-counter').length || 0,
    };
  });
  assert.ok(metrics.boxes.some(box => box.selector === '.fighter-bars'),
    `${viewport.width}px ${scenario}: fighter bars did not render ${JSON.stringify(metrics)}`);
  assert.ok(metrics.boxes.some(box => box.selector === '.fighter-art'),
    `${viewport.width}px ${scenario}: fighter art did not render ${JSON.stringify(metrics)}`);
  assert.equal(metrics.boxOverlaps.length, 0,
    `${viewport.width}px ${scenario}: fighter art, bars, counters or summons overlap ${JSON.stringify(metrics.boxOverlaps)}`);
  assert.equal(metrics.containmentErrors.length, 0,
    `${viewport.width}px ${scenario}: counters or summons escape their panel ${JSON.stringify(metrics.containmentErrors)}`);
  assert.ok(metrics.boxes.every(box => box.scrollWidth <= box.clientWidth + 1),
    `${viewport.width}px ${scenario}: fighter line overflows horizontally ${JSON.stringify(metrics.boxes)}`);
  if (scenario === 'sword') {
    assert.match(metrics.summonText, /飞剑阵/);
    assert.match(metrics.summonText, /[23]\s*\/\s*3/);
  }
  if (scenario === 'guard' || scenario === 'spring') {
    assert.ok(metrics.counterCount > 0,
      `${viewport.width}px ${scenario}: actual reaction counter is missing ${JSON.stringify(metrics)}`);
  }
  assert.ok(metrics.documentWidth <= viewport.width + 1 && metrics.bodyWidth <= viewport.width + 1,
    `${viewport.width}px ${scenario}: battle view overflows horizontally ${JSON.stringify(metrics)}`);
  return metrics;
}

async function pauseAtCurrentFrame(page, viewport, expectedKind) {
  const pause = page.locator('.battle-controls [data-action="battle-pause"]');
  await pause.waitFor({ state: 'visible' });
  if (await pause.getAttribute('aria-pressed') !== 'true') await pause.click();
  const shell = page.locator('.battle-shell');
  await assert.equal(await shell.getAttribute('data-paused'), 'true');
  const arena = page.locator('.combat-arena');
  await arena.waitFor({ state: 'visible' });
  if (expectedKind) {
    await page.locator(`.combat-arena[data-reaction-kind="${expectedKind}"]`).waitFor({ state: 'visible' });
  }
  const before = await arena.getAttribute('data-frame-index');
  await page.waitForTimeout(320);
  const after = await arena.getAttribute('data-frame-index');
  assert.equal(after, before,
    `${viewport.width}px: pause moved replay cursor from ${before} to ${after}`);
  assert.equal(await pause.getAttribute('aria-pressed'), 'true',
    `${viewport.width}px: pause control did not remain pressed`);
  return Number(after);
}

async function pauseWhenReactionAppears(page, expectedKind) {
  await page.evaluate(kind => {
    delete window.__reactionPauseFrame;
    let observer;
    const pauseOnReaction = () => {
      const arena = document.querySelector(`.combat-arena[data-reaction-kind="${kind}"]`);
      const pause = document.querySelector('.battle-controls [data-action="battle-pause"]');
      if (!arena || !pause || pause.getAttribute('aria-pressed') !== 'false') return;
      window.__reactionPauseFrame = Number(arena.getAttribute('data-frame-index'));
      observer.disconnect();
      pause.click();
    };
    observer = new MutationObserver(pauseOnReaction);
    observer.observe(document, {
      attributes: true,
      attributeFilter: ['data-reaction-kind'],
      childList: true,
      subtree: true,
    });
    pauseOnReaction();
  }, expectedKind);
  await page.waitForFunction(() => Number.isFinite(window.__reactionPauseFrame), null, {
    polling: 'raf',
  });
  return page.evaluate(() => window.__reactionPauseFrame);
}

async function playFromOpeningToReaction(page, viewport, expectedKind, cueIndex) {
  const initialIndex = await pauseAtCurrentFrame(page, viewport);
  assert.ok(initialIndex < cueIndex,
    `${viewport.width}px: replay did not pause before ${expectedKind} (${initialIndex} >= ${cueIndex})`);
  await page.locator('.battle-controls [data-action="battle-speed"][data-speed="4"]').click();
  const pause = page.locator('.battle-controls [data-action="battle-pause"]');
  const reactionFrame = pauseWhenReactionAppears(page, expectedKind);
  await pause.click();
  assert.equal(await pause.getAttribute('aria-pressed'), 'false',
    `${viewport.width}px: replay did not resume from the opening frame`);
  await reactionFrame;
  const reactionIndex = Number(await page.locator('.combat-arena').getAttribute('data-frame-index'));
  assert.equal(reactionIndex, await page.evaluate(() => window.__reactionPauseFrame));
  assert.ok(reactionIndex > initialIndex,
    `${viewport.width}px: replay cursor moved backwards ${initialIndex} -> ${reactionIndex}`);
  await pauseAtCurrentFrame(page, viewport, expectedKind);
  return reactionIndex;
}

async function assertReactionLog(page, viewport, expectedLabel, expectedSource) {
  await page.locator('.battle-shell [data-action="battle-details"][data-tab="log"]').click();
  const log = page.locator('.battle-detail-dialog .battle-log');
  await log.waitFor({ state: 'visible' });
  const text = await log.innerText();
  assert.ok(text.includes(expectedLabel),
    `${viewport.width}px: reaction log label "${expectedLabel}" is missing`);
  assert.ok(text.includes(expectedSource),
    `${viewport.width}px: source cue label "${expectedSource}" is missing`);
  await page.keyboard.press('Escape');
  await page.locator('.battle-detail-dialog').waitFor({ state: 'detached' });
}

async function assertBattleFixture(page, viewport, fixture) {
  assert.equal(fixture.replay, 'deterministic-input-v1');
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page, 'battle');
  if (viewport.width === 1440 && fixture.scenario === 'sword' && fixture.cueIndex > 0) {
    await playFromOpeningToReaction(page, viewport, fixture.cueKind, fixture.cueIndex);
  } else {
    await pauseAtCurrentFrame(page, viewport, fixture.cueKind);
  }
  if (fixture.cueKind === 'sword_volley' || fixture.cueKind === 'guard_counter' ||
      fixture.cueKind === 'spring_bloom') {
    const reducedMotion = await page.evaluate(() =>
      matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (viewport.reducedMotion) assert.equal(reducedMotion, true);
    if (fixture.cueKind === 'sword_volley' && viewport.reducedMotion) {
      const animation = await page.locator('.reaction-launch-sword').first().evaluate(element =>
        getComputedStyle(element).animationName);
      assert.equal(animation, 'none',
        `${viewport.width}px: reduced-motion did not disable the sword launch`);
    }
    const methodSource = `${fixture.methodName}·共鸣`;
    const reactionLabel = {
      sword_volley: '飞剑齐射',
      guard_counter: '架势反击',
      spring_bloom: '春生回涌',
    }[fixture.cueKind];
    const frameText = await page.locator('.battle-stage-core [data-frame-text]').innerText();
    assert.ok(frameText.includes(reactionLabel),
      `${viewport.width}px: reaction frame label "${reactionLabel}" is missing from "${frameText}"`);
    await assertReactionLog(page, viewport, reactionLabel, methodSource);
    await pauseAtCurrentFrame(page, viewport, fixture.cueKind);
    const layout = await inspectFighterLayout(page, viewport, fixture.scenario);
    await assertNoHorizontalOverflow(page, viewport, 'battle');
    await saveScreenshot(page, viewport.width, `${fixture.scenario}-reaction`);
    return layout;
  }
  throw new Error(`Unexpected reaction fixture kind ${fixture.cueKind}`);
}

async function installBossMapFixture(page, bossId) {
  const fixture = await installBattleFixture(page, 'boss_map');
  if (bossId === 'EN-A1-B1') return fixture;
  return page.evaluate(async ({ bossId, saveKey, replayKey }) => {
    const [{ loadContent }, run, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame } = run;
    const { saveRun, loadRun } = persistence;
    const existing = loadRun(content);
    const state = structuredClone(existing.state);
    const byKey = new Map(state.routeMap.nodes.map(node => [node.key, node]));
    const boss = state.routeMap.nodes.find(node => node.depth === 10 && node.type === 'B');
    if (!boss) throw new Error('Saved map fixture is missing the boss node');
    boss.id = bossId;
    const game = new ShanhaiGame(content, state);
    const saved = saveRun(game);
    const restored = loadRun(content);
    localStorage.removeItem(replayKey);
    if (!restored || restored.state.phase !== 'map') throw new Error('Second boss map fixture failed to reload');
    return { phase: restored.state.phase, bossId, replay: saved.replay };
  }, { bossId, saveKey, replayKey });
}

async function testBossDisclosure(page, viewport, bossId) {
  const fixture = await installBossMapFixture(page, bossId);
  assert.equal(fixture.phase, 'map');
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page, 'map');
  const hint = page.locator('.boss-map-hint');
  await hint.locator('summary').click();
  const trialKind = bossId === 'EN-A1-B1' ? 'tidal_charge' : 'reviving_mist';
  const mapTrial = hint.locator(`.boss-trial-brief[data-trial-kind="${trialKind}"]`);
  await mapTrial.waitFor({ state: 'visible' });
  const mapText = await mapTrial.innerText();
  assert.match(mapText, /每\s*3\s*回合/);
  assert.match(mapText, /初始准备\s*3\s*格/);
  assert.match(mapText, /破解/);
  if (bossId === 'EN-A1-B1') {
    assert.match(mapText, /有效直击或衍生攻击/);
  } else {
    assert.match(mapText, /中毒或燃烧跳伤/);
  }
  await assertNoHorizontalOverflow(page, viewport, `${bossId} map`);
  await saveScreenshot(page, viewport.width, `${bossId}-map-disclosure`);

  const mapBoss = page.locator('.map-node[data-node-type="B"]:not([disabled])');
  await mapBoss.click();
  const modal = page.locator('.node-preview-dialog[role="dialog"]');
  await modal.waitFor({ state: 'visible' });
  const modalTrial = modal.locator(`.boss-trial-brief[data-trial-kind="${trialKind}"]`);
  await modalTrial.waitFor({ state: 'visible' });
  assert.ok((await modalTrial.innerText()).includes('每 3 回合'));
  await modal.locator('[data-action="confirm-node"]').click();
  await waitForApp(page, 'preview');
  const previewTrial = page.locator(`.game-page.phase-preview .boss-trial-brief[data-trial-kind="${trialKind}"]`);
  await previewTrial.waitFor({ state: 'visible' });
  const previewText = await previewTrial.innerText();
  assert.match(previewText, /初始准备\s*3\s*格/);
  if (bossId === 'EN-A1-B1') assert.match(previewText, /持续伤害与反噬不计/);
  else assert.match(previewText, /只伤护盾的持续伤害和直击不计/);
  await assertNoHorizontalOverflow(page, viewport, `${bossId} preview`);
  await saveScreenshot(page, viewport.width, `${bossId}-preview-disclosure`);
}

async function testBossReplay(page, viewport, scenario) {
  const fixture = await installBattleFixture(page, scenario);
  assert.equal(fixture.replay, 'deterministic-input-v1');
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page, 'battle');
  await pauseAtCurrentFrame(page, viewport, 'enemy_release');
  const counters = page.locator('.combatant[data-side="enemy"] .fighter-counters');
  const counterText = await counters.innerText();
  const chargeLabel = scenario === 'tidal_charge' ? '蓄潮' : '回雾';
  assert.match(counterText, new RegExp(`${chargeLabel}\\s*0\\s*/\\s*3`));
  assert.match(counterText, /释势倒计时\s*0\s*\/\s*3/);
  await assertReactionLog(page, viewport, '首领释招', fixture.bossName);
  await pauseAtCurrentFrame(page, viewport, 'enemy_release');
  await assertNoHorizontalOverflow(page, viewport, `${scenario} battle`);
  await saveScreenshot(page, viewport.width, `${scenario}-actual-release`);
  if (scenario === 'tidal_charge') {
    await page.evaluate(async ({ replayKey }) => {
      const [{ loadContent }, { loadRun }, playback] = await Promise.all([
        import('/shanhai/content.js'),
        import('/shanhai/persistence.js'),
        import('/shanhai/battle-playback.js'),
      ]);
      const game = loadRun(await loadContent('/content/'));
      const frames = game.state.battle.frames;
      const interrupted = frames.findIndex(frame =>
        frame.kind === 'status' && frame.cue?.kind === 'enemy_charge');
      if (interrupted < 0) throw new Error('Actual boss replay has no interruption');
      const cursor = playback.combatPresentationStepEnd(frames, interrupted);
      const group = playback.combatPresentationGroup(frames, cursor);
      if (!group?.interruptedCharges || group.reaction) {
        throw new Error('Expected a main-action charge interruption group');
      }
      const key = [game.state.id, game.state.act, game.state.step, frames.length].join(':');
      localStorage.setItem(replayKey, JSON.stringify({ key, cursor }));
    }, { replayKey });
    await page.reload({ waitUntil: 'networkidle' });
    await waitForApp(page, 'battle');
    await pauseAtCurrentFrame(page, viewport);
    assert.match(await page.locator('[data-frame-text]').innerText(), /削减敌方蓄势/);
    assert.equal(await page.locator('.combat-arena').getAttribute('data-reaction-kind'), '');
    await page.locator('[data-action="battle-details"][data-tab="log"]').click();
    const interruption = page.locator('.battle-log-row').filter({ hasText: '削减蓄势' }).first();
    assert.match(await interruption.innerText(), /我方/);
    await page.keyboard.press('Escape');
    await saveScreenshot(page, viewport.width, 'tidal-charge-interrupted');
  }
}

async function testRewardSeeking(page, viewport) {
  const initial = await installBattleFixture(page, 'first_reward');
  assert.equal(initial.reason, 'guaranteed-core-offer');
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page, 'reward');
  const search = page.locator('.reward-search');
  await search.locator('summary').click();
  const confirm = search.locator('[data-action="seek-reward"]');
  await confirm.waitFor({ state: 'visible' });
  assert.equal(await confirm.isDisabled(), true,
    `${viewport.width}px: guaranteed first core offer allowed paid seeking`);
  assert.match(await search.innerText(), /首次必得核心法宝的候选不可寻缘/);
  await assertNoHorizontalOverflow(page, viewport, 'initial core reward');
  await saveScreenshot(page, viewport.width, 'initial-core-search-disabled');

  const fixture = await installBattleFixture(page, 'paid_reward');
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page, 'reward');
  const laterSearch = page.locator('.reward-search');
  await laterSearch.locator('summary').click();
  await laterSearch.locator('[data-seek-family]').selectOption(fixture.family);
  const paidConfirm = laterSearch.locator('[data-action="seek-reward"]');
  await paidConfirm.waitFor({ state: 'visible' });
  assert.equal(await paidConfirm.isDisabled(), false,
    `${viewport.width}px: a valid later family offer was not payable`);
  const previewRows = laterSearch.locator('.reward-search-preview li');
  const shownNames = await previewRows.locator('b').allInnerTexts();
  const paidFixture = await page.evaluate(async family => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    const preview = game.rewardSearchPreview(family);
    return {
      original: game.state.rewardCandidates,
      candidates: preview.candidates,
      names: preview.candidates.map(id => content.byId[id].name),
      coins: game.state.coins,
      cost: preview.cost,
      family,
    };
  }, fixture.family);
  assert.equal(paidFixture.cost, 8);
  assert.deepEqual(paidFixture.candidates, fixture.preview.candidates);
  assert.deepEqual(paidFixture.original, fixture.original);
  assert.equal(paidFixture.coins, fixture.coinsBefore);
  assert.equal(shownNames.length, paidFixture.candidates.length);
  assert.deepEqual(shownNames, paidFixture.names);
  if (paidFixture.candidates.length < paidFixture.original.length) {
    assert.ok(shownNames.length < paidFixture.original.length,
      `${viewport.width}px: short candidate preview was not reflected in UI`);
  }
  const coinsBefore = paidFixture.coins;
  await assertNoHorizontalOverflow(page, viewport, 'paid search preview');
  await saveScreenshot(page, viewport.width, 'paid-search-preview');
  await paidConfirm.click();
  await waitForApp(page, 'reward');
  const paidState = await page.evaluate(async () => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    return {
      coins: game.state.coins,
      coinsSpent: game.state.progress.coinsSpent,
      candidates: game.state.rewardCandidates,
      searches: game.state.rewardSearches,
    };
  });
  assert.equal(paidState.coins, coinsBefore - 8,
    `${viewport.width}px: search did not reduce actual coins by 8`);
  assert.equal(paidState.coinsSpent, 8,
    `${viewport.width}px: search spend was not recorded in the journey ledger`);
  assert.deepEqual(paidState.candidates, paidFixture.candidates,
    `${viewport.width}px: paid result differs from the free preview`);
  assert.equal(paidState.searches.length, 1);
  assert.equal(paidState.searches[0].resolved, false);
  assert.deepEqual(paidState.searches[0].candidates, paidFixture.candidates);

  const visibleCandidateIds = await page.locator('.reward-card').evaluateAll(cards =>
    cards.map(card => card.getAttribute('data-id')));
  assert.deepEqual(visibleCandidateIds, paidFixture.candidates,
    `${viewport.width}px: reward cards do not match the frozen paid candidate list`);
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page, 'reward');
  assert.deepEqual(
    await page.locator('.reward-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-id'))),
    paidFixture.candidates,
    `${viewport.width}px: paid candidates changed after reload`,
  );
  const reloadedSearch = page.locator('.reward-search');
  await reloadedSearch.locator('summary').click();
  assert.equal(await reloadedSearch.locator('[data-action="seek-reward"]').isDisabled(), true,
    `${viewport.width}px: a second paid use was available in the same act`);
  assert.match(await reloadedSearch.innerText(), /1\s*\/\s*1/);
  await assertNoHorizontalOverflow(page, viewport, 'reloaded reward');
  await saveScreenshot(page, viewport.width, 'paid-search-frozen-after-reload');

  const claimedId = paidFixture.candidates[0];
  await page.locator(`.reward-card[data-id="${claimedId}"] [data-action="reward"][data-id="${claimedId}"]`).click();
  try {
    await page.waitForFunction(() => {
      const phase = document.querySelector('.game-page')?.getAttribute('data-phase');
      return phase === 'map' || phase === 'talent';
    });
  } catch (error) {
    const diagnostic = await page.evaluate(async () => {
      const [{ loadContent }, { loadRun }] = await Promise.all([
        import('/shanhai/content.js'),
        import('/shanhai/persistence.js'),
      ]);
      const content = await loadContent('/content/');
      const game = loadRun(content);
      return {
        savedPhase: game?.state.phase ?? null,
        pages: [...document.querySelectorAll('.game-page')].map(element => ({
          phase: element.getAttribute('data-phase'),
          visible: Boolean(element.getClientRects().length),
        })),
        status: [...document.querySelectorAll('[role="status"]')]
          .map(element => element.innerText.trim()).filter(Boolean),
        stage: document.querySelector('.main-stage')?.innerText.trim().slice(0, 500) ?? '',
      };
    });
    throw new Error(
      `${viewport.width}px: claiming ${claimedId} did not return to the map; ` +
      `post-click state ${JSON.stringify(diagnostic)}; ${error.message}`,
    );
  }
  const claimed = await page.evaluate(async () => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    return {
      phase: game.state.phase,
      candidates: game.state.rewardCandidates,
      searches: game.state.rewardSearches,
      history: game.state.history,
      owned: game.state.artifacts,
    };
  });
  assert.ok(['map', 'talent'].includes(claimed.phase),
    `${viewport.width}px: claiming ${claimedId} reached unexpected phase ${claimed.phase}`);
  assert.equal(claimed.searches.length, 1);
  assert.equal(claimed.searches[0].resolved, true,
    `${viewport.width}px: claiming a paid candidate did not resolve its search record`);
  assert.equal(claimed.searches[0].candidates.filter(id => id === claimedId).length, 1);
  assert.equal(claimed.owned.find(stack => stack.id === claimedId)?.stacks, 1,
    `${viewport.width}px: selected artifact was not claimed exactly once`);
  assert.equal(await page.locator('[data-action="reward"]').count(), 0,
    `${viewport.width}px: reward claim action remained available after the claim`);
  let talentChoices = 0;
  const talentPhase = page.locator('.game-page.phase-talent');
  while (await talentPhase.count()) {
    talentChoices += 1;
    assert.ok(talentChoices <= 8,
      `${viewport.width}px: post-reward breakthrough did not settle after eight choices`);
    await talentPhase.locator('.talent-candidate-select').first().click();
  }
  await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
  const afterClaimReload = await page.evaluate(async () => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    return {
      count: game.state.artifacts.find(stack => stack.id === game.state.rewardSearches[0].candidates[0])?.stacks ?? 0,
      resolved: game.state.rewardSearches[0].resolved,
    };
  });
  assert.equal(afterClaimReload.count, 1,
    `${viewport.width}px: reloading duplicated the claimed artifact`);
  assert.equal(afterClaimReload.resolved, true);
}

async function run() {
  await mkdir(artifactDir, { recursive: true });
  const { chromium } = playwrightModule();
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: viewport.width < 700,
        hasTouch: viewport.width < 700,
        reducedMotion: viewport.reducedMotion ? 'reduce' : 'no-preference',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => pageErrors.push(`${viewport.width}: ${error.message}`));
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(`${viewport.width}: ${message.text()}`);
      });

      await page.goto(url, { waitUntil: 'networkidle' });
      await pauseBattleAtLoad(page);
      await page.locator('.landing-page, .game-page').first().waitFor({ state: 'visible' });
      const fixture = await installBattleFixture(page, viewport.battle, viewport.width !== 1440);
      const layout = await assertBattleFixture(page, viewport, fixture);
      console.log(
        `ok - ${viewport.width}px ${viewport.battle} real reaction; ${fixture.cueKind} at frame ${fixture.cueIndex}; ` +
        `${fixture.frames} replay frames; layout ${JSON.stringify(layout.boxes)}`,
      );

      if (viewport.width === 1440) {
        for (const bossId of ['EN-A1-B1', 'EN-A1-B2']) {
          await testBossDisclosure(page, viewport, bossId);
        }
        for (const scenario of ['tidal_charge', 'reviving_mist']) {
          await testBossReplay(page, viewport, scenario);
        }
        for (const scenario of ['guard', 'spring']) {
          const reaction = await installBattleFixture(page, scenario);
          await page.reload({ waitUntil: 'networkidle' });
          await waitForApp(page, 'battle');
          await pauseAtCurrentFrame(page, viewport, reaction.cueKind);
          await assertReactionLog(
            page,
            viewport,
            scenario === 'guard' ? '架势反击' : '春生回涌',
            `${reaction.methodName}·共鸣`,
          );
        }
      }
      await testRewardSeeking(page, viewport);

      assert.deepEqual(
        pageErrors.filter(error => error.startsWith(`${viewport.width}:`)),
        [],
        `${viewport.width}px: page reported uncaught JavaScript errors`,
      );
      assert.deepEqual(
        consoleErrors.filter(error => error.startsWith(`${viewport.width}:`)),
        [],
        `${viewport.width}px: browser console reported errors`,
      );
      await context.close();
    }
    assert.deepEqual(pageErrors, [], `Pages reported uncaught JavaScript errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(consoleErrors, [], `Browser console reported errors: ${consoleErrors.join(' | ')}`);
    console.log(`Screenshots: ${artifactDir}`);
    console.log('ok - V2 reaction replay, trial disclosure/release and paid seeking at 360/390/430/1440px');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
