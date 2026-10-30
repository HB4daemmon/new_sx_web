import { calculateStats, simulateBattle } from './combat.js';
import type { BattleResult, Content, Loadout, RunState } from './types.js';

type FrozenBattleInput = NonNullable<RunState['battleInput']>;
type BattleOutcome = BattleResult['outcome'];

export interface BattleSideSummary {
  maxHp: number;
  startingHp: number;
  remainingHp: number;
}

export interface BattleScenarioSummary {
  outcome: BattleOutcome;
  outcomeLabel: '玩家胜' | '敌人胜' | '平局';
  rounds: number;
  player: BattleSideSummary;
  enemy: BattleSideSummary;
  /** Player remaining HP minus enemy remaining HP, in raw HP points. */
  remainingHpDifference: number;
  reason?: string;
}

export interface ArtifactBattleComparison {
  scope: 'same_seed_single_battle_counterfactual';
  interpretation: '单场同种子反事实对照，不代表跨种子的统计净收益。';
  healthDifferenceMeaning: '玩家剩余气血减去敌方剩余气血，单位为气血值；不是伤害占比。';
  roundLimit: number;
  rules: 'awakening-v1' | null;
  removedArtifact: { id: string; stacks: number };
  original: BattleScenarioSummary;
  withoutArtifact: BattleScenarioSummary;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateLoadoutShape(value: unknown, label: string): asserts value is Loadout {
  if (!isRecord(value)) throw new Error(`Invalid battle comparison input: ${label} loadout is required`);
  if (!Array.isArray(value.artifacts)) {
    throw new Error(`Invalid battle comparison input: ${label} artifacts must be an array`);
  }
  if (value.hp !== undefined && (typeof value.hp !== 'number' || !Number.isFinite(value.hp))) {
    throw new Error(`Invalid battle comparison input: ${label} hp must be finite`);
  }
  for (const stack of value.artifacts) {
    if (!isRecord(stack) || typeof stack.id !== 'string' || !stack.id ||
        !Number.isInteger(stack.stacks) || stack.stacks <= 0) {
      throw new Error(`Invalid battle comparison input: invalid ${label} artifact stack`);
    }
  }
}

function validateBattleInput(value: RunState['battleInput']): FrozenBattleInput {
  if (!isRecord(value)) throw new Error('Invalid battle comparison input: frozen battle input is required');
  if (typeof value.seed !== 'string') {
    throw new Error('Invalid battle comparison input: seed must be a string');
  }
  if (!Number.isInteger(value.roundLimit) || value.roundLimit <= 0) {
    throw new Error('Invalid battle comparison input: roundLimit must be a positive integer');
  }
  if (value.rules !== undefined && value.rules !== 'awakening-v1') {
    throw new Error(`Invalid battle comparison input: unsupported rules ${String(value.rules)}`);
  }
  validateLoadoutShape(value.player, 'player');
  validateLoadoutShape(value.enemy, 'enemy');
  return value as FrozenBattleInput;
}

function startHp(loadout: Loadout, maxHp: number): number {
  const requestedHp = typeof loadout.hp === 'number' && Number.isFinite(loadout.hp)
    ? loadout.hp
    : maxHp;
  return Math.min(maxHp, Math.max(0, requestedHp));
}

function outcomeLabel(outcome: BattleOutcome): BattleScenarioSummary['outcomeLabel'] {
  if (outcome === 'player') return '玩家胜';
  if (outcome === 'enemy') return '敌人胜';
  return '平局';
}

function summarize(
  result: BattleResult,
  player: Loadout,
  enemy: Loadout,
  playerMaxHp: number,
  enemyMaxHp: number,
): BattleScenarioSummary {
  const playerHp = Math.min(playerMaxHp, Math.max(0, result.playerHp));
  const enemyHp = Math.min(enemyMaxHp, Math.max(0, result.enemyHp));
  return {
    outcome: result.outcome,
    outcomeLabel: outcomeLabel(result.outcome),
    rounds: result.rounds,
    player: {
      maxHp: playerMaxHp,
      startingHp: startHp(player, playerMaxHp),
      remainingHp: playerHp,
    },
    enemy: {
      maxHp: enemyMaxHp,
      startingHp: startHp(enemy, enemyMaxHp),
      remainingHp: enemyHp,
    },
    remainingHpDifference: playerHp - enemyHp,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

/**
 * Replay one frozen battle and compare it with a counterfactual that removes
 * the selected player's equipped artifact stack. Both simulations use the
 * same seed, opponent, artifact order, rules and round limit. This is a single
 * battle comparison, not an estimate of statistical net benefit.
 */
export function compareArtifactRemoval(
  content: Content,
  battleInput: RunState['battleInput'],
  artifactId: string,
): ArtifactBattleComparison {
  const input = validateBattleInput(battleInput);
  if (typeof artifactId !== 'string' || artifactId.length === 0) {
    throw new Error('Invalid battle comparison input: artifactId must be a non-empty string');
  }
  if (!isRecord(content) || !isRecord(content.byId)) {
    throw new Error('Invalid battle comparison input: content is invalid');
  }
  const authoredArtifact = content.byId[artifactId];
  if (!authoredArtifact || authoredArtifact.kind !== 'artifact') {
    throw new Error(`Unknown Shanhai artifact ID: ${artifactId}`);
  }

  const matchingStacks = input.player.artifacts.filter(stack => stack.id === artifactId);
  if (matchingStacks.length === 0) {
    throw new Error(`Artifact ${artifactId} is not equipped in this battle`);
  }
  if (matchingStacks.length !== 1) {
    throw new Error(`Invalid battle comparison input: duplicate artifact ${artifactId}`);
  }

  // Work only with snapshots: the caller's frozen run input and content stay
  // untouched even if a downstream combat helper changes its local arguments.
  const originalInput = structuredClone(input);
  const counterfactualInput = structuredClone(input);
  counterfactualInput.player.artifacts = counterfactualInput.player.artifacts
    .filter(stack => stack.id !== artifactId);

  const originalPlayer = originalInput.player;
  const originalEnemy = originalInput.enemy;
  const counterfactualPlayer = counterfactualInput.player;
  const counterfactualEnemy = counterfactualInput.enemy;

  const originalPlayerStats = calculateStats(structuredClone(content), structuredClone(originalPlayer));
  const originalEnemyStats = calculateStats(structuredClone(content), structuredClone(originalEnemy));
  const counterfactualPlayerStats = calculateStats(structuredClone(content), structuredClone(counterfactualPlayer));
  const counterfactualEnemyStats = calculateStats(structuredClone(content), structuredClone(counterfactualEnemy));
  const options = {
    roundLimit: input.roundLimit,
    // RunState maps only the explicit awakening-v1 rule to enabled. Preserve
    // that contract instead of using simulateBattle's enabled-by-default mode.
    artifactAwakenings: input.rules === 'awakening-v1',
  };

  const originalResult = simulateBattle(
    structuredClone(content),
    structuredClone(originalPlayer),
    structuredClone(originalEnemy),
    input.seed,
    options,
  );
  const counterfactualResult = simulateBattle(
    structuredClone(content),
    structuredClone(counterfactualPlayer),
    structuredClone(counterfactualEnemy),
    input.seed,
    options,
  );

  return {
    scope: 'same_seed_single_battle_counterfactual',
    interpretation: '单场同种子反事实对照，不代表跨种子的统计净收益。',
    healthDifferenceMeaning: '玩家剩余气血减去敌方剩余气血，单位为气血值；不是伤害占比。',
    roundLimit: input.roundLimit,
    rules: input.rules ?? null,
    removedArtifact: { id: artifactId, stacks: matchingStacks[0].stacks },
    original: summarize(
      originalResult,
      originalPlayer,
      originalEnemy,
      originalPlayerStats.max_hp,
      originalEnemyStats.max_hp,
    ),
    withoutArtifact: summarize(
      counterfactualResult,
      counterfactualPlayer,
      counterfactualEnemy,
      counterfactualPlayerStats.max_hp,
      counterfactualEnemyStats.max_hp,
    ),
  };
}
