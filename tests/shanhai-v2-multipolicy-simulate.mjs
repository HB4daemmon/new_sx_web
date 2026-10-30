import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { MAX_EQUIPMENT_SLOTS } from '../build/shanhai/equipment.js';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { normalizeEnemyMultipliers, scaleEnemyBaseStats } from './shanhai-difficulty.mjs';
import { artifactScore, equipmentCommand, nextCommand } from './shanhai-policy.mjs';

const STRATEGIES = [
  { id: 'stable', name: '稳健路线', route: 'avoid' },
  { id: 'elite_hunt', name: '追逐精英并条件引雷', route: 'elite' },
  { id: 'service_lean', name: '偏向坊市、寻缘与炼宝', route: 'service' },
];
const ARTIFACT_REWARD_FAMILIES = ['sword', 'guard', 'vitality', 'affliction'];
const TERMINAL_PHASES = new Set(['won', 'lost']);
const MAX_COMMANDS_PER_RUN = 600;
const ENEMY_STATS = ['attack', 'defense', 'max_hp'];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function contentFingerprint(content) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(content.entities)))
    .digest('hex');
}

export function parseEnemyMultipliers(raw = undefined) {
  if (raw === undefined) return normalizeEnemyMultipliers({});
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`ENEMY_MULTIPLIERS must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeEnemyMultipliers(parsed);
}

function hasEnemyStatAdjustments(multipliers) {
  return Object.values(multipliers).some(stats => ENEMY_STATS.some(stat => stats[stat] !== 1));
}

function nodeKey(game) {
  return `${game.state.act}:${game.state.step}`;
}

function rankRouteNode(node, strategy) {
  const ranks = strategy === 'elite'
    ? { L: 0, C: 1, K: 2, E: 3, R: 4, S: 5, B: 6, F: 6 }
    : strategy === 'service'
      ? { S: 0, R: 1, E: 2, C: 3, K: 4, L: 5, B: 6, F: 6 }
      : { R: 0, S: 1, E: 2, C: 3, K: 8, L: 9, B: 10, F: 10 };
  return ranks[node.type] ?? 7;
}

function routeCommand(game, strategy) {
  const available = game.availableNodes();
  if (!available.length) throw new Error('No reachable route map nodes');
  const node = available.slice().sort((left, right) =>
    rankRouteNode(left, strategy) - rankRouteNode(right, strategy) ||
    left.lane - right.lane || left.key.localeCompare(right.key))[0];
  return { type: 'enter', id: node.key };
}

function temperCommand(game) {
  const candidates = game.warmableArtifacts()
    .slice()
    .sort((left, right) => artifactScore(game, right) - artifactScore(game, left) ||
      left.localeCompare(right));
  for (const artifact of candidates) {
    if (game.restChoiceAvailability('temper', undefined, artifact).available) {
      return { type: 'rest', choice: 'temper', artifact };
    }
  }
  return null;
}

function restCommand(game, strategy) {
  if (strategy === 'service_lean') {
    const temper = temperCommand(game);
    if (temper) return temper;
  }
  for (const choice of ['heal', 'preparation']) {
    if (game.restChoiceAvailability(choice).available) return { type: 'rest', choice };
  }
  const method = game.state.ownedMethods.find(id => id !== game.state.method);
  if (method && game.restChoiceAvailability('swap_method', method).available) {
    return { type: 'rest', choice: 'swap_method', method };
  }
  throw new Error('No available rest choice');
}

function serviceShopCommand(game) {
  const state = game.state;
  const shop = state.shop.filter(item => !item.sold);
  const recovery = shop.find(item => item.kind === 'recovery' &&
    state.hp <= game.stats.max_hp * 0.55 && game.shopPurchaseAvailability(item.id).available);
  if (recovery) return { type: 'buy', id: recovery.id };

  const artifacts = shop.filter(item => item.kind === 'artifact' &&
    game.shopPurchaseAvailability(item.id).available)
    .sort((left, right) => artifactScore(game, right.id) - artifactScore(game, left.id) ||
      left.id.localeCompare(right.id));
  const bestArtifact = artifacts[0];
  if (bestArtifact && artifactScore(game, bestArtifact.id) >= 18 &&
    state.coins - bestArtifact.price >= 5) {
    return { type: 'buy', id: bestArtifact.id };
  }

  const preparation = shop.find(item => item.kind === 'preparation' &&
    state.hp <= game.stats.max_hp * 0.75 && game.shopPurchaseAvailability(item.id).available);
  if (preparation) return { type: 'buy', id: preparation.id };
  return { type: 'leave_shop' };
}

function rewardRefinementCommand(game) {
  const slots = new Set(game.state.equipment?.slots ?? []);
  const inventory = game.state.artifacts ?? [];
  const sources = inventory.flatMap(stack => {
    const entity = game.content.byId instanceof Map
      ? game.content.byId.get(stack.id)
      : game.content.byId?.[stack.id];
    return stack.stacks > 0 && !slots.has(stack.id) && entity?.rarity === 'common'
      ? [stack.id]
      : [];
  });
  const targets = [...slots].filter(id => {
    const entity = game.content.byId instanceof Map ? game.content.byId.get(id) : game.content.byId?.[id];
    return entity?.rarity === 'common';
  });
  const currentReward = Math.max(0, ...game.state.rewardCandidates.map(id => artifactScore(game, id)));
  const options = [];
  for (const source of sources) {
    for (const target of targets) {
      if (source === target) continue;
      const preview = game.rewardRefinePreview(source, target);
      if (!preview.available) continue;
      const targetScore = artifactScore(game, target);
      if (preview.awakening || targetScore >= currentReward + 5) {
        options.push({ source, target, gain: targetScore + (preview.awakening ? 30 : 0) });
      }
    }
  }
  options.sort((left, right) => right.gain - left.gain ||
    left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
  const best = options[0];
  return best ? { type: 'refine_reward', source: best.source, target: best.target } : null;
}

function rewardSearchCommand(game) {
  const currentBest = Math.max(0, ...game.state.rewardCandidates.map(id => artifactScore(game, id)));
  const previews = ARTIFACT_REWARD_FAMILIES.flatMap(family => {
    const preview = game.rewardSearchPreview(family);
    if (!preview.available) return [];
    const score = Math.max(0, ...preview.candidates.map(id => artifactScore(game, id)));
    return score >= currentBest + 5 ? [{ family, score }] : [];
  });
  previews.sort((left, right) => right.score - left.score || left.family.localeCompare(right.family));
  return previews.length ? { type: 'seek_reward', family: previews[0].family } : null;
}

function previewCommand(game, strategy, tracker) {
  if (strategy.id === 'elite_hunt' && game.canChallengeElite() &&
    game.state.hp / Math.max(1, game.stats.max_hp) >= 0.78) {
    return { type: 'challenge_elite' };
  }
  if (strategy.id === 'elite_hunt' && game.canThunderChallenge() &&
    game.state.hp / Math.max(1, game.stats.max_hp) >= 0.78 &&
    !tracker.thunderNodes.has(nodeKey(game))) {
    return { type: 'thunder_challenge', enabled: true };
  }
  return { type: 'fight' };
}

function serviceCommand(game) {
  if (game.state.phase === 'reward') {
    const refine = rewardRefinementCommand(game);
    if (refine) return refine;
    const seek = rewardSearchCommand(game);
    if (seek) return seek;
  }
  if (game.state.phase === 'rest') return restCommand(game, 'service_lean');
  if (game.state.phase === 'shop') return serviceShopCommand(game);
  return null;
}

function chooseCommand(game, strategy, tracker) {
  const equipment = equipmentCommand(game);
  if (equipment) return equipment;
  if (game.state.phase === 'map') return routeCommand(game, strategy.route);
  if (game.state.phase === 'preview') return previewCommand(game, strategy, tracker);
  if (strategy.id === 'service_lean') {
    const service = serviceCommand(game);
    if (service) return service;
  }
  if (game.state.phase === 'rest') return restCommand(game, strategy.id);
  return nextCommand(game, strategy.route === 'elite' ? 'tracking' : strategy.route === 'service' ? 'avoid' : 'avoid');
}

function commandAvailability(game, command) {
  const state = game.state;
  switch (command.type) {
    case 'enter':
      return game.availableNodes().some(node => node.key === command.id);
    case 'challenge_elite':
      return game.canChallengeElite();
    case 'thunder_challenge':
      return game.canThunderChallenge() && command.enabled === true;
    case 'fight':
      return state.phase === 'preview';
    case 'battle_done':
      return state.phase === 'battle' && state.battle?.outcome !== 'draw';
    case 'continue_battle':
      return state.phase === 'battle' && state.battle?.outcome === 'draw' &&
        state.battleInput?.roundLimit < 4096;
    case 'retire':
      return !TERMINAL_PHASES.has(state.phase);
    case 'reward':
      return state.phase === 'reward' &&
        (command.id === null || state.rewardCandidates.includes(command.id));
    case 'seek_reward':
      return game.rewardSearchPreview(command.family).available;
    case 'refine_reward':
      return game.rewardRefinePreview(command.source, command.target).available;
    case 'event':
      return game.optionAvailability(command.id).available;
    case 'continue':
      return state.phase === 'event_result' || state.phase === 'transition';
    case 'buy':
      return game.shopPurchaseAvailability(command.id).available;
    case 'leave_shop':
      return state.phase === 'shop';
    case 'rest':
      return game.restChoiceAvailability(command.choice, command.method, command.artifact).available;
    case 'talent':
      return game.availableTalents().some(talent => talent.id === command.id);
    case 'equip':
      return game.canChangeEquipment() && state.artifacts.some(stack => stack.id === command.id && stack.stacks > 0) &&
        !state.equipment.slots.includes(command.id) &&
        (command.replace === undefined
          ? state.equipment.slots.length < MAX_EQUIPMENT_SLOTS
          : state.equipment.slots.includes(command.replace));
    default:
      return false;
  }
}

function noteAcceptedCommand(game, command, counters, tracker) {
  if (command.type === 'challenge_elite') counters.eliteChallenges += 1;
  if (command.type === 'thunder_challenge' && command.enabled) {
    counters.thunderChallenges += 1;
    tracker.thunderNodes.add(nodeKey(game));
  }
  if (command.type === 'seek_reward') counters.rewardSearches += 1;
  if (command.type === 'refine_reward') counters.rewardRefinements += 1;
  if (command.type === 'rest' && command.choice === 'temper') counters.tempers += 1;
  if (command.type === 'reforge') counters.reforges += 1;
  if (command.type === 'buy') {
    const item = game.state.shop.find(candidate => candidate.id === command.id);
    const kind = item?.kind ?? 'unknown';
    counters.purchases[kind] = (counters.purchases[kind] ?? 0) + 1;
  }
}

function updateRunObservations(game, observations) {
  const state = game.state;
  if (state.phase === 'transition' && state.act >= 1 && state.act <= 4 &&
    state.nodes.at(-1)?.type === 'B') {
    observations.actClears.add(state.act);
  }
  const node = state.nodes[state.step] ?? state.nodes.at(-1);
  if (state.battle && node && ['C', 'L', 'B', 'F'].includes(node.type)) {
    observations.battles.set(nodeKey(game), {
      act: state.act,
      step: state.step,
      nodeType: node.type,
      nodeId: node.id,
      outcome: state.battle.outcome,
      rounds: state.battle.rounds,
    });
    if (state.act === 5 && node.type === 'F') observations.terminalBattleRounds = state.battle.rounds;
  }
}

function makeCounters() {
  return {
    eliteChallenges: 0,
    thunderChallenges: 0,
    rewardSearches: 0,
    rewardRefinements: 0,
    tempers: 0,
    reforges: 0,
    purchases: { artifact: 0, recovery: 0, preparation: 0, talent_reset: 0 },
  };
}

function deathPosition(game, status) {
  if (status !== 'lost') return null;
  const node = game.state.nodes[game.state.step] ?? game.state.nodes.at(-1);
  const battle = game.state.battle;
  return {
    act: game.state.act,
    step: game.state.step,
    nodeType: node?.type ?? null,
    nodeId: node?.id ?? null,
    cause: battle?.outcome === 'enemy' ? 'combat_loss' : game.state.hp <= 0 ? 'zero_hp' : 'retired_or_event_failure',
    enemyRounds: battle?.rounds ?? null,
  };
}

function runOne(content, method, seed, strategy) {
  let game = ShanhaiGame.create(content, { seed, name: '策略仿真行者', method: method.id });
  const counters = makeCounters();
  const tracker = { thunderNodes: new Set() };
  const observations = { actClears: new Set(), battles: new Map(), terminalBattleRounds: null };
  const errors = [];
  let commands = 0;

  while (!TERMINAL_PHASES.has(game.state.phase) && commands < MAX_COMMANDS_PER_RUN) {
    const phase = game.state.phase;
    let command;
    try {
      command = chooseCommand(game, strategy, tracker);
    } catch (error) {
      errors.push({ command: null, phase, message: error instanceof Error ? error.message : String(error) });
      break;
    }
    if (!commandAvailability(game, command)) {
      errors.push({ command, phase, message: 'Policy selected a command that public availability checks reject' });
      break;
    }
    try {
      game.dispatch(command);
      commands += 1;
      noteAcceptedCommand(game, command, counters, tracker);
      updateRunObservations(game, observations);
    } catch (error) {
      errors.push({ command, phase, message: error instanceof Error ? error.message : String(error) });
      break;
    }
  }

  let status = game.state.phase;
  if (!TERMINAL_PHASES.has(status) && !errors.length && commands >= MAX_COMMANDS_PER_RUN) {
    status = 'step_limit';
    errors.push({ command: null, phase: game.state.phase, message: `Reached ${MAX_COMMANDS_PER_RUN} command safety limit` });
  } else if (errors.length) {
    status = 'error';
  }
  const run = {
    strategy: strategy.id,
    seed,
    method: method.id,
    status,
    commands,
    actClears: [...observations.actClears].sort((left, right) => left - right),
    end: { act: game.state.act, step: game.state.step, phase: game.state.phase },
    totalWins: {
      elite: game.state.progress?.eliteWins ?? 0,
      boss: game.state.progress?.bossWins ?? 0,
    },
    terminalBattleRounds: observations.terminalBattleRounds,
    deathPosition: deathPosition(game, status),
    serviceUses: counters,
    stateRecordedUses: {
      thunderChallenges: game.state.thunderChallenges?.length ?? 0,
      rewardSearches: game.state.rewardSearches?.length ?? 0,
      rewardRefinements: game.state.rewardRefinements?.length ?? 0,
      coinsSpent: game.state.progress?.coinsSpent ?? 0,
    },
    battles: [...observations.battles.values()],
    errors,
  };
  return run;
}

function sumServiceUses(runs) {
  const totals = makeCounters();
  for (const run of runs) {
    for (const key of ['eliteChallenges', 'thunderChallenges', 'rewardSearches',
      'rewardRefinements', 'tempers', 'reforges']) {
      totals[key] += run.serviceUses[key];
    }
    for (const [kind, count] of Object.entries(run.serviceUses.purchases)) {
      totals.purchases[kind] = (totals.purchases[kind] ?? 0) + count;
    }
  }
  return totals;
}

function summarizeStrategy(runs) {
  const wins = runs.filter(run => run.status === 'won');
  const terminalRounds = wins.map(run => run.terminalBattleRounds).filter(Number.isInteger);
  return {
    runs: runs.length,
    totalWins: wins.length,
    losses: runs.filter(run => run.status === 'lost').length,
    errors: runs.filter(run => run.status === 'error' || run.status === 'step_limit').length,
    cumulativeActClears: Object.fromEntries([1, 2, 3, 4].map(act => [
      `act${act}`,
      runs.filter(run => [1, 2, 3, 4].slice(0, act).every(required => run.actClears.includes(required))).length,
    ])),
    terminalBattleRounds: {
      measuredWins: terminalRounds.length,
      perRun: runs.map(run => ({ seed: run.seed, method: run.method, rounds: run.terminalBattleRounds })),
      meanAmongWins: terminalRounds.length
        ? Number((terminalRounds.reduce((sum, rounds) => sum + rounds, 0) / terminalRounds.length).toFixed(2))
        : null,
    },
    deathPositions: runs.filter(run => run.deathPosition).map(run => ({
      seed: run.seed,
      method: run.method,
      ...run.deathPosition,
    })),
    serviceUses: sumServiceUses(runs),
    stateRecordedUses: {
      thunderChallenges: runs.reduce((sum, run) => sum + run.stateRecordedUses.thunderChallenges, 0),
      rewardSearches: runs.reduce((sum, run) => sum + run.stateRecordedUses.rewardSearches, 0),
      rewardRefinements: runs.reduce((sum, run) => sum + run.stateRecordedUses.rewardRefinements, 0),
      coinsSpent: runs.reduce((sum, run) => sum + run.stateRecordedUses.coinsSpent, 0),
    },
    errorDetails: runs.flatMap(run => run.errors.map(error => ({
      seed: run.seed,
      method: run.method,
      error,
    }))),
  };
}

export async function simulateMultiPolicy(
  seedCount = 1,
  rawEnemyMultipliers = process.env.ENEMY_MULTIPLIERS,
  seedPrefix = process.env.SIM_SEED_PREFIX ?? 'v2-multipolicy',
) {
  if (!Number.isInteger(seedCount) || seedCount < 1 || seedCount > 100) {
    throw new Error('SIM_SEEDS must be an integer from 1 through 100');
  }
  if (typeof seedPrefix !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(seedPrefix)) {
    throw new Error('SIM_SEED_PREFIX must use 1-80 letters, numbers, dots, underscores, or hyphens');
  }
  const model = await loadContent();
  const sourceContent = contentFromEntities(model.entities, model.manifest.content_version);
  const enemyMultipliers = parseEnemyMultipliers(rawEnemyMultipliers);
  const content = hasEnemyStatAdjustments(enemyMultipliers)
    ? scaleEnemyBaseStats(sourceContent, enemyMultipliers)
    : sourceContent;
  const sourceContentFingerprint = contentFingerprint(sourceContent);
  const simulationContentFingerprint = contentFingerprint(content);
  const methods = content.entities
    .filter(entity => entity.kind === 'method' && entity.acquisition?.start === true)
    .sort((left, right) => left.id.localeCompare(right.id));
  const seeds = Array.from({ length: seedCount }, (_, index) =>
    `${seedPrefix}-${String(index + 1).padStart(3, '0')}`);
  const runs = [];
  for (const strategy of STRATEGIES) {
    for (const method of methods) {
      for (const seed of seeds) runs.push(runOne(content, method, seed, strategy));
    }
  }
  const byStrategy = Object.fromEntries(STRATEGIES.map(strategy => [
    strategy.id,
    summarizeStrategy(runs.filter(run => run.strategy === strategy.id)),
  ]));
  const inputText = rawEnemyMultipliers ?? null;
  const reproductionCommand = [
    inputText === null ? null : `ENEMY_MULTIPLIERS='${inputText}'`,
    `SIM_SEEDS=${seedCount}`,
    `SIM_SEED_PREFIX='${seedPrefix}'`,
    'node tests/shanhai-v2-multipolicy-simulate.mjs',
  ].filter(Boolean).join(' ');
  return {
    experiment: hasEnemyStatAdjustments(enemyMultipliers)
      ? 'V2 real-flow multi-policy balance trial; enemy base stats are scaled in a temporary in-memory content copy'
      : 'V2 real-flow multi-policy sample; authored content and battle stats unchanged',
    contentVersion: content.version,
    contentFingerprint: {
      algorithm: 'SHA-256',
      scope: 'canonical JSON of loaded source entities before trial scaling',
      sourceContent: sourceContentFingerprint,
      simulationContent: simulationContentFingerprint,
    },
    enemyStatAdjustment: {
      mode: hasEnemyStatAdjustments(enemyMultipliers)
        ? 'offline_memory_enemy_entity_base_stats_only'
        : 'disabled_identity_multipliers',
      fields: [...ENEMY_STATS],
      input: inputText,
      multipliers: enemyMultipliers,
      note: 'Scales only enemy entity stats.attack, stats.defense, and stats.max_hp in the temporary simulation content. Enemy artifact loadouts and artifact entities remain unchanged and are applied by combat once; player state, authored YAML, and runtime combat source are not edited.',
    },
    policySource: 'tests/shanhai-policy.mjs plus local route/service heuristics',
    seedPairing: 'Each method/seed pair is repeated under every strategy for a deterministic comparison.',
    simSeeds: seedCount,
    seedPrefix,
    seedValues: seeds,
    startingMethods: methods.map(method => method.id),
    commandSafetyLimitPerRun: MAX_COMMANDS_PER_RUN,
    reproductionCommand,
    strategies: STRATEGIES.map(strategy => ({ id: strategy.id, name: strategy.name })),
    note: 'This is a deterministic heuristic policy experiment. Its observed wins are not a player win rate, a player-skill estimate, or a balance approval.',
    limitations: [
      'Observed outcomes cover only the configured seeds and five start methods; expand SIM_SEEDS for a broader deterministic sample.',
      'Policies use authored heuristics and public availability checks; the counts do not estimate human choices or skill.',
      'With ENEMY_MULTIPLIERS, only the named enemy base-stat fields are changed in memory; equipment, player state, and authored content remain fixed. Results describe this exact adjustment and content fingerprint only.',
      'A deterministic policy sample cannot establish human-player win rates or general balance; real player behavior, skill, and broader seed coverage are not represented.',
      'Only terminal phase won counts as a win; command-limit stops and policy/dispatch errors are reported separately.',
    ],
    totalRuns: runs.length,
    totalWins: runs.filter(run => run.status === 'won').length,
    byStrategy,
    runs,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rawSeeds = process.env.SIM_SEEDS ?? '1';
  const report = await simulateMultiPolicy(Number(rawSeeds), process.env.ENEMY_MULTIPLIERS,
    process.env.SIM_SEED_PREFIX ?? 'v2-multipolicy');
  console.log(JSON.stringify(report, null, 2));
}
