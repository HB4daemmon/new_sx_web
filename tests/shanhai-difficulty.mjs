import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats } from '../build/shanhai/combat.js';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { amount, artifactScore, nextCommand } from './shanhai-policy.mjs';
import { aggregateDifficultyRuns } from './shanhai-difficulty-metrics.mjs';
import { renderDifficultyReport } from './shanhai-difficulty-report.mjs';

export const POLICY_NAMES = Object.freeze(['steady', 'balanced', 'tracking']);
export const RUN_STEP_GUARD = 600;
export const BATTLE_ROUND_LIMIT = 4096;
const ENEMY_STATS = Object.freeze(['attack', 'defense', 'max_hp']);
const ACT_NUMBERS = Object.freeze([1, 2, 3, 4, 5]);

function fail(message) {
  throw new Error(message);
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) fail(`${name} must be a positive integer`);
  return parsed;
}

function safePrefix(value) {
  const prefix = String(value).trim();
  if (!prefix || prefix.length > 80 || !/^[A-Za-z0-9._-]+$/.test(prefix)) {
    fail('seed prefix must use 1-80 letters, numbers, dots, underscores, or hyphens');
  }
  return prefix;
}

function parseMultiplierObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const result = { attack: 1, defense: 1, max_hp: 1 };
  for (const [stat, multiplier] of Object.entries(value)) {
    if (!ENEMY_STATS.includes(stat)) fail(`${label} has unsupported stat ${stat}`);
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) {
      fail(`${label}.${stat} must be a finite positive number`);
    }
    result[stat] = multiplier;
  }
  return result;
}

export function normalizeEnemyMultipliers(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('enemy multipliers must be a JSON object');
  }
  const keys = Object.keys(value);
  const actKeys = keys.filter(key => ACT_NUMBERS.map(String).includes(key));
  if (actKeys.length === 0) {
    const allActs = parseMultiplierObject(value, 'enemy multipliers');
    return Object.fromEntries(ACT_NUMBERS.map(act => [String(act), { ...allActs }]));
  }
  if (actKeys.length !== keys.length) {
    fail('enemy multipliers must use either stat keys or act keys 1-5, not both');
  }
  const result = Object.fromEntries(ACT_NUMBERS.map(act => [String(act), {
    attack: 1,
    defense: 1,
    max_hp: 1,
  }]));
  for (const [act, stats] of Object.entries(value)) {
    result[act] = parseMultiplierObject(stats, `enemy multipliers act ${act}`);
  }
  return result;
}

export function scaleEnemyBaseStats(content, enemyMultipliers) {
  const multipliers = normalizeEnemyMultipliers(enemyMultipliers);
  const entities = content.entities.map(entity => {
    if (entity.kind !== 'enemy') return structuredClone(entity);
    const acts = Array.isArray(entity.acts) ? entity.acts : [];
    const act = acts.length === 1 ? String(acts[0]) : null;
    const scale = multipliers[act] ?? { attack: 1, defense: 1, max_hp: 1 };
    const stats = { ...entity.stats };
    for (const stat of ENEMY_STATS) {
      if (typeof stats[stat] === 'number') stats[stat] *= scale[stat];
    }
    return { ...structuredClone(entity), stats };
  });
  return contentFromEntities(entities, content.version);
}

function startingMethods(content) {
  const methods = content.entities
    .filter(entity => entity.kind === 'method' && entity.rarity === 'common' &&
      entity.acquisition?.start === true)
    .map(entity => entity.id)
    .sort();
  if (methods.length !== 5) fail(`expected five legal common start methods, found ${methods.length}`);
  return methods;
}

function enemyIdForBattle(content, game) {
  const state = game.state;
  const node = game.node;
  if (!node) return null;
  if (node.type === 'C' || node.type === 'L' || node.type === 'B' || node.type === 'F') return node.id;

  const event = content.byId[node.id];
  const option = event?.options?.find(candidate => candidate.id === state.eventOption);
  const encounteredId = option?.encounter?.enemy_id;
  if (typeof encounteredId === 'string') return encounteredId;

  const matches = content.entities.filter(entity =>
    entity.kind === 'enemy' && entity.name === state.battleInput?.enemy?.name);
  return matches.length === 1 ? matches[0].id : null;
}

function battleAttempt(content, game) {
  const input = game.state.battleInput;
  const result = game.state.battle;
  if (!input || !result) fail('battle phase is missing battle input or result');
  const playerStats = calculateStats(content, input.player);
  const enemyStats = calculateStats(content, input.enemy);
  const playerEntryHp = Math.max(0, Math.min(input.player.hp ?? playerStats.max_hp, playerStats.max_hp));
  const enemyEntryHp = Math.max(0, Math.min(input.enemy.hp ?? enemyStats.max_hp, enemyStats.max_hp));
  const playerNetHpLoss = playerEntryHp - result.playerHp;
  return {
    outcome: result.outcome,
    rounds: result.rounds,
    roundLimit: input.roundLimit,
    playerEntryHp,
    playerPostHp: result.playerHp,
    playerNetHpLoss,
    playerNetHpLossPct: playerNetHpLoss / Math.max(1, playerStats.max_hp) * 100,
    enemyEntryHp,
    enemyPostHp: result.enemyHp,
    enemyNetHpLoss: enemyEntryHp - result.enemyHp,
  };
}

function beginBattle(content, game, enemyMultipliers) {
  const state = game.state;
  const enemyId = enemyIdForBattle(content, game);
  const enemy = enemyId ? content.byId[enemyId] : null;
  const enemyAct = enemy?.acts?.length === 1 ? String(enemy.acts[0]) : String(state.act);
  return {
    act: state.act,
    step: state.step,
    nodeType: game.node?.type ?? null,
    nodeId: game.node?.id ?? null,
    enemyId,
    enemyName: state.battleInput.enemy.name,
    enemyStatMultipliers: { ...(enemyMultipliers[enemyAct] ?? { attack: 1, defense: 1, max_hp: 1 }) },
    attempts: [battleAttempt(content, game)],
  };
}

function finishBattle(current, result = current.attempts.at(-1).outcome) {
  const last = current.attempts.at(-1);
  const normalizedResult = {
    player: 'won',
    enemy: 'lost',
    draw: 'undecided',
  }[result] ?? result;
  return {
    act: current.act,
    step: current.step,
    nodeType: current.nodeType,
    nodeId: current.nodeId,
    enemyId: current.enemyId,
    enemyName: current.enemyName,
    enemyStatMultipliers: current.enemyStatMultipliers,
    result: normalizedResult,
    outcome: last.outcome,
    rounds: last.rounds,
    continues: current.attempts.length - 1,
    roundLimits: current.attempts.map(attempt => attempt.roundLimit),
    playerEntryHp: last.playerEntryHp,
    playerPostHp: last.playerPostHp,
    playerNetHpLoss: last.playerNetHpLoss,
    playerNetHpLossPct: last.playerNetHpLossPct,
    enemyEntryHp: last.enemyEntryHp,
    enemyPostHp: last.enemyPostHp,
    enemyNetHpLoss: last.enemyNetHpLoss,
  };
}

function stateLocation(game) {
  return {
    phase: game?.state?.phase ?? null,
    act: game?.state?.act ?? null,
    step: game?.state?.step ?? null,
    nodeType: game?.node?.type ?? null,
    nodeId: game?.node?.id ?? null,
  };
}

export function difficultyCommand(game, policy) {
  const state = game.state;
  if (state.phase === 'map' && policy === 'steady') {
    const missing = game.stats.max_hp - state.hp;
    const recoveryPrice = game.content.rules.economy.non_artifact_prices.recovery.price;
    const rank = node => {
      if (node.type === 'R' && missing >= game.stats.max_hp * 0.18) return -2;
      if (node.type === 'S' && missing >= game.stats.max_hp * 0.2 &&
        state.coins >= recoveryPrice) return -1;
      return ({ C: 0, E: 1, R: 2, S: 3, K: 4, L: 8 })[node.type] ?? 6;
    };
    const node = game.availableNodes().slice().sort((left, right) =>
      rank(left) - rank(right) || left.lane - right.lane)[0];
    if (!node) fail('No reachable route map nodes');
    return { type: 'enter', id: node.key };
  }
  if (state.phase === 'event') {
    const candidates = game.content.byId[game.node.id].options
      .filter(option => game.optionAvailability(option).available);
    const score = option => {
      let value = option.encounter ? -10000 : 0;
      for (const cost of option.costs) {
        value -= amount(game, cost) *
          (cost.resource === 'hp' ? 2 : cost.resource === 'xp' ? 0.15 : 1);
      }
      // Hinted outcomes are not public reward cards; the conservative policy never reads them.
      if (option.reveal === 'hint') return value - 1;
      for (const reward of option.rewards) {
        if (reward.type === 'artifact') value += artifactScore(game, reward.id) * (reward.count ?? 1);
        if (reward.type === 'resource') {
          value += reward.resource === 'hp'
            ? Math.min(amount(game, reward), game.stats.max_hp - state.hp) * 2
            : amount(game, reward) * (reward.resource === 'xp' ? 0.15 : 1);
        }
        if (reward.type === 'preparation') value += amount(game, reward) * 0.5;
        if (reward.type === 'method') value += 15;
      }
      return value;
    };
    if (!candidates.length) fail(`No legal event options: ${game.node.id}`);
    return { type: 'event', id: candidates.sort((left, right) => score(right) - score(left))[0].id };
  }
  return nextCommand(game, policy);
}

function runOne({ content, method, seed, policy, enemyMultipliers }) {
  let game;
  let commandCount = 0;
  let lastCommand = null;
  let activeBattle = null;
  let retiredForBattleHorizon = false;
  const run = {
    seed,
    method,
    result: 'error',
    enteredActs: [],
    clearedActs: [],
    battles: [],
    finalBattle: null,
  };

  try {
    game = ShanhaiGame.create(content, { seed, name: '难度校准行者', method });
    run.enteredActs.push(game.state.act);
    while (!['won', 'lost'].includes(game.state.phase) && commandCount < RUN_STEP_GUARD) {
      const command = difficultyCommand(game, policy);
      lastCommand = command;
      if (command.type === 'retire' && activeBattle?.attempts.at(-1)?.outcome === 'draw' &&
        activeBattle.attempts.at(-1).roundLimit >= BATTLE_ROUND_LIMIT) {
        const battle = finishBattle(activeBattle, 'undecided');
        run.battles.push(battle);
        if (battle.act === 5 && battle.nodeType === 'F') run.finalBattle = battle;
        activeBattle = null;
        retiredForBattleHorizon = true;
      }

      game.dispatch(command);
      commandCount += 1;
      if (!run.enteredActs.includes(game.state.act)) run.enteredActs.push(game.state.act);
      if (game.state.phase === 'transition' && game.state.act <= 4 &&
        !run.clearedActs.includes(game.state.act)) {
        run.clearedActs.push(game.state.act);
      }

      if (command.type === 'fight' && game.state.phase === 'battle') {
        activeBattle = beginBattle(content, game, enemyMultipliers);
      } else if (command.type === 'continue_battle' && game.state.phase === 'battle' && activeBattle) {
        activeBattle.attempts.push(battleAttempt(content, game));
      }
      if (activeBattle && activeBattle.attempts.at(-1).outcome !== 'draw') {
        const battle = finishBattle(activeBattle);
        run.battles.push(battle);
        if (battle.act === 5 && battle.nodeType === 'F') run.finalBattle = battle;
        activeBattle = null;
      }
    }

    if (activeBattle) {
      run.battles.push(finishBattle(activeBattle, 'error'));
      activeBattle = null;
    }
    if (commandCount >= RUN_STEP_GUARD && !['won', 'lost'].includes(game.state.phase)) {
      throw new Error(`run_step_guard_exceeded:${RUN_STEP_GUARD}`);
    }
    if (retiredForBattleHorizon) {
      run.result = 'undecided';
      run.endReason = 'battle_draw_at_4096_round_limit';
    } else if (game.state.phase === 'won') {
      run.result = 'won';
    } else {
      run.result = 'lost';
      const fatalBattle = [...run.battles].reverse().find(battle => battle.result === 'lost');
      run.fatal = fatalBattle ? {
        act: fatalBattle.act,
        step: fatalBattle.step,
        nodeType: fatalBattle.nodeType,
        nodeId: fatalBattle.nodeId,
        enemyId: fatalBattle.enemyId,
      } : null;
      if (!fatalBattle) run.endReason = 'lost_without_recorded_fatal_battle';
    }
    run.act = game.state.act;
    run.step = game.state.step;
    run.nodes = game.state.history.length;
    run.n = game.state.n;
    run.hp = game.state.hp;
    run.xp = game.state.xp;
    run.coins = game.state.coins;
    run.commandCount = commandCount;
  } catch (error) {
    if (activeBattle) {
      const battle = {
        ...finishBattle(activeBattle, 'error'),
        error: error instanceof Error ? error.message : String(error),
      };
      run.battles.push(battle);
      if (battle.act === 5 && battle.nodeType === 'F') run.finalBattle = battle;
      activeBattle = null;
    }
    run.result = 'error';
    run.error = {
      message: error instanceof Error ? error.message : String(error),
      ...stateLocation(game),
      command: lastCommand,
      commandCount,
    };
    run.act = game?.state?.act ?? null;
    run.step = game?.state?.step ?? null;
    run.nodes = game?.state?.history?.length ?? 0;
    run.commandCount = commandCount;
  }
  return run;
}

function inputHash(configuration) {
  return createHash('sha256')
    .update(JSON.stringify(configuration))
    .digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function contentHash(content) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(content.entities)))
    .digest('hex');
}

function runtimeHash() {
  const runtime = new URL('../build/shanhai/', import.meta.url);
  const files = [
    ...readdirSync(runtime).filter(name => name.endsWith('.js')).sort()
      .map(name => new URL(name, runtime)),
    new URL('./shanhai-policy.mjs', import.meta.url),
    new URL('./shanhai-difficulty.mjs', import.meta.url),
    new URL('./shanhai-difficulty-metrics.mjs', import.meta.url),
  ];
  const hash = createHash('sha256');
  for (const file of files) hash.update(path.basename(file.pathname)).update(readFileSync(file));
  return hash.digest('hex');
}

export function runDifficulty({
  content,
  seedCount = 10,
  seedPrefix = 'difficulty',
  split = 'train',
  policy = 'steady',
  enemyMultipliers = {},
} = {}) {
  if (!content?.entities || !content?.byId) fail('content is required');
  if (!Number.isInteger(seedCount) || seedCount < 1) fail('seedCount must be a positive integer');
  if (!['train', 'holdout'].includes(split)) fail('split must be train or holdout');
  if (!POLICY_NAMES.includes(policy)) fail(`policy must be one of: ${POLICY_NAMES.join(', ')}`);
  const methods = startingMethods(content);
  const targets = content.rules.calibration?.cumulative_act_pass_rates;
  if (!Array.isArray(targets) || targets.length !== 4 ||
    targets.some((value, index) => typeof value !== 'number' || value < 0 || value > 1 ||
      (index > 0 && value > targets[index - 1]))) {
    fail('calibration.cumulative_act_pass_rates must contain four non-increasing probabilities');
  }
  const normalizedMultipliers = normalizeEnemyMultipliers(enemyMultipliers);
  const simulationContent = scaleEnemyBaseStats(content, normalizedMultipliers);
  const sourceContentHash = contentHash(content);
  const effectiveSeedPrefix = `${safePrefix(seedPrefix)}-${split}`;
  const runs = [];
  for (const method of methods) {
    for (let seedIndex = 1; seedIndex <= seedCount; seedIndex += 1) {
      const seed = `${effectiveSeedPrefix}-${method}-${String(seedIndex).padStart(4, '0')}`;
      runs.push(runOne({
        content: simulationContent,
        method,
        seed,
        policy,
        enemyMultipliers: normalizedMultipliers,
      }));
    }
  }
  const configuration = {
    mode: 'real_shanhai_game_stratified_difficulty',
    contentVersion: content.version,
    sourceContentHash,
    runtimeAndPolicyHash: runtimeHash(),
    methods,
    seedsPerMethod: seedCount,
    split,
    seedPrefix: effectiveSeedPrefix,
    seeds: runs.map(run => run.seed),
    seedDesign: 'independent method-specific seed labels; each of the five methods receives exactly N seeds',
    policy,
    policySource: 'tests/shanhai-difficulty.mjs difficultyCommand; tests/shanhai-policy.mjs nextCommand',
    policyContract: 'uses current phase, reachable nodes, current visible rewards and public costs; never reads hinted event rewards, future battle results, or future reward candidates',
    policyNotes: policy === 'steady'
      ? 'Prioritizes reachable rest at 18% missing HP or shop at 20% missing HP when recovery is affordable; otherwise prefers common battles. Uses a fixed talent plan; does not use reforge or temper.'
      : 'Uses the existing reachable-node preference, with hinted event rewards excluded.',
    runStepGuard: RUN_STEP_GUARD,
    battleRoundLimit: BATTLE_ROUND_LIMIT,
    enemyStatAdjustment: {
      mode: 'offline_memory_enemy_entity_base_stats_only',
      fields: [...ENEMY_STATS],
      multipliers: normalizedMultipliers,
      note: 'Applies only to cloned enemy entity stats in memory; player stats, runtime node values, seed, and YAML files are unchanged.',
    },
  };
  return {
    schemaVersion: 1,
    configuration,
    inputHash: inputHash(configuration),
    targets: {
      cumulativeActPassRates: Object.fromEntries(targets.map((rate, index) => [`act${index + 1}`, rate])),
      finalAct: 'standalone final battle; reported only among runs entering act 5',
      measuredContentFieldsRemainNull: true,
      interpretation: 'Pass rates are conditional on the selected deterministic policy; they are not measured human-player win rates.',
    },
    metrics: aggregateDifficultyRuns(runs, methods),
    runs,
  };
}

function parseJson(value, option) {
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(`${option} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseDifficultyArgs(argv) {
  const options = {
    seedCount: 10,
    seedPrefix: 'difficulty',
    split: 'train',
    policy: 'steady',
    enemyMultipliers: {},
    outputDir: 'verification/shanhai/difficulty',
    outputFile: null,
    summaryOnly: false,
    help: false,
  };
  let selectedOutputMode = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--summary-only') {
      options.summaryOnly = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const equalsIndex = argument.indexOf('=');
    const name = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    const value = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : argv[++index];
    if (!value || value.startsWith('--')) fail(`missing value for ${name}`);
    switch (name) {
      case '--seeds':
      case '--seed-count':
        options.seedCount = positiveInteger(value, name);
        break;
      case '--seed-prefix':
      case '--prefix':
        options.seedPrefix = safePrefix(value);
        break;
      case '--split':
        options.split = value;
        break;
      case '--policy':
        options.policy = value;
        break;
      case '--enemy-multipliers':
        options.enemyMultipliers = normalizeEnemyMultipliers(parseJson(value, name));
        break;
      case '--output-dir':
        if (selectedOutputMode && selectedOutputMode !== 'dir') {
          fail('--output-dir and --output-file are mutually exclusive');
        }
        selectedOutputMode = 'dir';
        options.outputDir = value;
        options.outputFile = null;
        options.outputPathMode = 'dir';
        break;
      case '--output-file':
        if (selectedOutputMode && selectedOutputMode !== 'file') {
          fail('--output-dir and --output-file are mutually exclusive');
        }
        selectedOutputMode = 'file';
        options.outputFile = value;
        options.outputDir = null;
        options.outputPathMode = 'file';
        break;
      default:
        fail(`unknown option: ${name}`);
    }
  }
  if (options.outputPathMode === undefined) options.outputPathMode = 'dir';
  if (!['train', 'holdout'].includes(options.split)) fail('--split must be train or holdout');
  if (!POLICY_NAMES.includes(options.policy)) fail(`--policy must be one of: ${POLICY_NAMES.join(', ')}`);
  return options;
}

function safeFileSegment(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'difficulty';
}

function summaryForStdout(report) {
  const { seeds, ...configuration } = report.configuration;
  const compactRate = rate => ({
    successes: rate.successes,
    total: rate.total,
    rate: rate.rate,
    wilson95: rate.wilson95,
  });
  const compactMethods = Object.fromEntries(Object.entries(report.metrics.byMethod).map(([method, metrics]) => [
    method,
    {
      runs: metrics.runs,
      outcomes: metrics.outcomes,
      acts: Object.fromEntries(Object.entries(metrics.acts).map(([act, pass]) => [act, {
        cumulative: compactRate(pass.cumulative),
        conditional: compactRate(pass.conditional),
      }])),
      finalBattle: {
        eligibleRuns: metrics.finalBattle.eligibleRuns,
        wins: metrics.finalBattle.wins,
        winRate: compactRate(metrics.finalBattle.winRate),
      },
      battles: {
        count: metrics.battles.battles,
        rounds: metrics.battles.rounds,
        playerNetHpLoss: metrics.battles.playerNetHpLoss,
      },
    },
  ]));
  return {
    inputHash: report.inputHash,
    configuration: { ...configuration, seedLabels: seeds.length },
    targets: report.targets,
    outcomes: report.metrics.outcomes,
    acts: report.metrics.acts,
    finalBattle: report.metrics.finalBattle,
    byMethod: compactMethods,
    deaths: report.metrics.deaths,
    errors: {
      total: report.metrics.errors.total,
      records: report.metrics.errors.records.slice(0, 20),
      omittedRecords: Math.max(0, report.metrics.errors.records.length - 20),
    },
    reportFile: report.reportFile,
  };
}

export async function writeDifficultyReport(report, options) {
  let outputFile;
  if (options.outputPathMode === 'file') {
    outputFile = options.outputFile;
  } else {
    const name = [
      safeFileSegment(`${options.seedPrefix}-${options.split}`),
      safeFileSegment(options.policy),
      `${options.seedCount}-seeds-per-method`,
      report.inputHash.slice(0, 10),
    ].join('-');
    outputFile = path.join(options.outputDir, `${name}.json`);
  }
  await mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${outputFile}.md`, renderDifficultyReport(report));
  return outputFile;
}

export function helpText() {
  return [
    'Usage: node tests/shanhai-difficulty.mjs [options]',
    '',
    'Options:',
    '  --seeds N                      Seeds per each of the five start methods (default: 10)',
    '  --split train|holdout           Appended to every seed prefix (default: train)',
    '  --seed-prefix PREFIX            Base seed prefix (default: difficulty)',
    '  --policy steady|balanced|tracking (default: steady)',
    '  --enemy-multipliers JSON        Shared stat factors or per-act factors for attack/defense/max_hp',
    '  --output-dir DIR                Write the full JSON report in DIR',
    '  --output-file FILE              Write the full JSON report to FILE',
    '  --summary-only                  Keep raw runs in the report; print compact metrics to stdout',
    '  --help                          Show this help',
    '',
    'Train and holdout seed prefixes are independent, for example balance-train-RKF01-0001 and balance-holdout-RKF01-0001.',
    'The default steady policy uses only current reachable nodes and current frozen choices.',
  ].join('\n');
}

async function main(argv) {
  const options = parseDifficultyArgs(argv);
  if (options.help) {
    console.log(helpText());
    return;
  }
  const loaded = await loadContent();
  if (loaded.issues.length) {
    fail(`content loading reported ${loaded.issues.length} issue(s): ${loaded.issues[0].message}`);
  }
  const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);
  const report = runDifficulty({ content, ...options });
  report.reportFile = await writeDifficultyReport(report, options);
  const { seeds, ...configuration } = report.configuration;
  const stdout = options.summaryOnly
    ? summaryForStdout(report)
    : {
      inputHash: report.inputHash,
      configuration: { ...configuration, seedLabels: seeds.length },
      metrics: report.metrics,
      reportFile: report.reportFile,
    };
  console.log(JSON.stringify(stdout, null, 2));
  if (report.metrics.errors.total > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
