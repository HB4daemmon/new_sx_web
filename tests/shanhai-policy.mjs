// Deterministic, legal decisions for regression only, not an estimate of player skill.
import { MAX_EQUIPMENT_SLOTS } from '../build/shanhai/equipment.js';

const BRANCHES = {
  RKF01: ['A', 'C', 'B', 'A'], RKF02: ['B', 'B', 'A', 'B'],
  RKF03: ['B', 'B', 'C', 'A'], RKF04: ['C', 'B', 'B', 'C'],
  RKF05: ['B', 'A', 'B', 'A'], RKF06: ['A', 'C', 'C', 'A'],
  RKF07: ['C', 'C', 'B', 'A'], RKF08: ['A', 'C', 'C', 'C'],
  RKF09: ['B', 'C', 'C', 'C'], RKF10: ['A', 'C', 'B', 'A'],
};

const ARTIFACT_VALUE = Object.freeze({
  RC09: 30,
  RC10: 18,
  RC11: 36,
  RC12: 23,
  RC14: 27,
  RC15: 26,
  RL01: 30,
  RL02: 30,
  RL03: 30,
  RL04: 30,
  RL05: 30,
});

const EQUIPMENT_PHASES = new Set(['map', 'reward', 'shop', 'rest', 'transition']);

export function artifactScore(game, id) {
  const entity = artifactEntity(game, id), { method, act } = game.state;
  if (!entity) return 0;
  const flat = entity.attributes.flat, percent = entity.attributes.percent;
  const stackCount = Math.max(1, game.state.artifacts?.find(stack => stack.id === id)?.stacks ?? 1);
  const statsByTier = game.content.rules.cultivation?.base_stats_by_tier;
  const baseStats = statsByTier?.[game.state.n] ?? game.stats;
  let score = ((flat.attack ?? 0) + (flat.defense ?? 0) * 0.9 +
    (flat.max_hp ?? 0) * 0.13 + (flat.crit_rate ?? 0) * 80) * stackCount +
    (percent.attack ?? 0) * baseStats.attack * stackCount +
    (percent.defense ?? 0) * baseStats.defense * stackCount +
    (percent.max_hp ?? 0) * baseStats.max_hp * 0.13 * stackCount;
  score += ARTIFACT_VALUE[id] ?? 0;
  if (id === 'RC17') score += 32 - act * 4;
  if (id === 'RC18') score += 25 - act * 4;
  if (id === 'RC16') score += 10 - act;
  if (id === 'RR06') score += 75;
  if (['RC19', 'RC20', 'RC21', 'RC22', 'RC23', 'RC24', 'RR01', 'RR08', 'RL04', 'RL05'].includes(id)) score += method === 'RKF02' ? 25 : 12;
  if (id === 'RC11' && ['RKF01', 'RKF04', 'RKF10'].includes(method)) score += 20;
  if (['RC12', 'RR02', 'RR12', 'RL01'].includes(id) && method === 'RKF03') score += 30;
  if (['RC13', 'RR09'].includes(id) && method === 'RKF01') score += 22;
  if (id === 'RC14' && method === 'RKF06') score += 25;
  if (['RC15', 'RR11', 'RL02'].includes(id) && ['RKF04', 'RKF09'].includes(method)) score += 25;
  if (['RR04', 'RL03', 'RR05'].includes(id)) score += 25;
  return score;
}

function artifactEntity(game, id) {
  const byId = game.content.byId;
  return byId instanceof Map ? byId.get(id) : byId?.[id];
}

export function equipmentCommand(game) {
  if (!EQUIPMENT_PHASES.has(game.state.phase) ||
    (typeof game.canChangeEquipment === 'function' && !game.canChangeEquipment())) return null;

  const inventory = (game.state.artifacts ?? [])
    .filter(stack => typeof stack?.id === 'string' && stack.stacks > 0);
  const slots = game.state.equipment?.slots ?? [];
  const equipped = new Set(slots);
  const candidates = inventory
    .map(stack => stack.id)
    .filter(id => !equipped.has(id))
    .sort((left, right) =>
      artifactScore(game, right) - artifactScore(game, left) ||
      left.localeCompare(right));

  if (slots.length < MAX_EQUIPMENT_SLOTS) {
    const best = candidates[0];
    return best ? { type: 'equip', id: best } : null;
  }

  const upgrades = candidates.flatMap(id => slots.flatMap(replace => {
    const gain = artifactScore(game, id) - artifactScore(game, replace);
    return gain > 0.001 ? [{ id, replace, gain }] : [];
  }));

  upgrades.sort((left, right) =>
    right.gain - left.gain || left.id.localeCompare(right.id));
  const best = upgrades[0];
  return best ? { type: 'equip', id: best.id, replace: best.replace } : null;
}

function talentBuild(talent) {
  const effects = Array.isArray(talent.effects) ? talent.effects : [];
  return effects.find(effect => typeof effect?.params?.build === 'string')?.params?.build;
}

function sharedTalentScore(game, build) {
  const state = game.state;
  const inventoryKinds = new Set((state.artifacts ?? [])
    .filter(stack => stack?.stacks > 0)
    .map(stack => stack.id)).size;
  const progress = state.progress ?? {};
  const coins = Math.max(0, state.coins ?? 0);

  switch (build) {
    case 'wealth_damage': return 14 + 6 * Math.min(1, coins / 150);
    case 'hunter': return 19;
    case 'speed_damage': return 16;
    case 'carapace': return 17;
    case 'spending_power':
      return 13 + 5 * Math.min(1, Math.max(0, progress.coinsSpent ?? 0) / 100);
    case 'collection_damage': return 14 + Math.min(8, inventoryKinds * 1.25);
    case 'bounty': return 16;
    case 'shop_discount': return 11 + (coins >= 20 ? 2 : 0);
    case 'basic_split': return 23;
    case 'hit_rage': return 16;
    case 'rage_echo': return 18;
    case 'veteran_shield':
      return 11 + Math.min(5, (progress.eliteWins ?? 0) + (progress.bossWins ?? 0));
    case 'wealth_shield': return 12 + 5 * Math.min(1, coins / 100);
    case 'trophy_damage':
      return 14 + Math.min(8, (progress.eliteWins ?? 0) * 2 + (progress.bossWins ?? 0) * 3);
    default:
      return 12;
  }
}

function talentScore(game, talent) {
  const build = talentBuild(talent);
  if (build) return sharedTalentScore(game, build);
  if (talent.id === 'V2-J4-C') return 24;
  const preferredBranch = BRANCHES[game.state.method]?.[(talent.tier ?? 1) - 1];
  return talent.branch === preferredBranch ? 16 : 12;
}

export function amount(game, reward) {
  const rules = game.content.rules;
  const basis = reward.basis === 'reference_hp' ? rules.economy.reference_hp_by_act[game.state.act - 1] :
    reward.basis === 'common_price' ? rules.economy.common_prices_by_act[game.state.act - 1] :
      reward.basis === 'next_xp' ? (rules.cultivation.requirements[game.state.n] ?? 0) : 1;
  return reward.amount * basis;
}

export function nextCommand(game, preference = 'balanced') {
  const state = game.state;
  const equipment = equipmentCommand(game);
  if (equipment) return equipment;
  switch (state.phase) {
    case 'map': {
      const available = game.availableNodes();
      if (!available.length) throw new Error('No reachable route map nodes');
      const rank = node => {
        if (preference === 'tracking') return ({ K: 0, E: 1, C: 2, R: 3, S: 4, L: 5 })[node.type] ?? 6;
        if (preference === 'avoid') return ({ R: 0, S: 1, E: 2, C: 3, K: 8, L: 9 })[node.type] ?? 6;
        return ({ C: 0, E: 1, R: 2, S: 3, K: 4, L: 8 })[node.type] ?? 6;
      };
      const node = available.slice().sort((left, right) =>
        rank(left) - rank(right) || left.lane - right.lane)[0];
      return { type: 'enter', id: node.key };
    }
    case 'preview': return { type: 'fight' };
    case 'battle':
      return { type: state.battle.outcome !== 'draw' ? 'battle_done' :
        state.battleInput.roundLimit >= 4096 ? 'retire' : 'continue_battle' };
    case 'reward': return { type: 'reward', id: [...state.rewardCandidates].sort((a, b) => artifactScore(game, b) - artifactScore(game, a))[0] ?? null };
    case 'talent': {
      const talents = game.availableTalents();
      const best = talents.slice().sort((left, right) =>
        talentScore(game, right) - talentScore(game, left) ||
        left.id.localeCompare(right.id))[0];
      if (!best) throw new Error('No available talents');
      return { type: 'talent', id: best.id };
    }
    case 'event': {
      const candidates = game.content.byId[game.node.id].options.filter(item => game.optionAvailability(item).available);
      const score = option => {
        let value = option.encounter ? -10000 : 0;
        for (const cost of option.costs) value -= amount(game, cost) * (cost.resource === 'hp' ? 2 : cost.resource === 'xp' ? 0.15 : 1);
        for (const reward of option.rewards) {
          if (reward.type === 'artifact') value += artifactScore(game, reward.id) * (reward.count ?? 1);
          if (reward.type === 'resource') value += reward.resource === 'hp' ? (state.bloodVow ? 0 : Math.min(amount(game, reward), game.stats.max_hp - state.hp) * 2) : amount(game, reward) * (reward.resource === 'xp' ? 0.15 : 1);
          if (reward.type === 'preparation') value += amount(game, reward) * 0.5;
          if (reward.type === 'method') value += 15;
        }
        return value;
      };
      if (!candidates.length) throw new Error(`No legal options: ${game.node.id}`);
      return { type: 'event', id: candidates.sort((a, b) => score(b) - score(a))[0].id };
    }
    case 'event_result':
    case 'transition': return { type: 'continue' };
    case 'rest': return state._restFromEvent ?
      { type: 'rest', choice: 'swap_method', method: state.ownedMethods.find(id => id !== state.method) } :
      { type: 'rest', choice: state.bloodVow ? 'preparation' : 'heal' };
    case 'shop': {
      const recovery = state.shop.find(item => item.kind === 'recovery' && !item.sold && item.price <= state.coins &&
        !state.bloodVow && (typeof game.shopPurchaseAvailability !== 'function' || game.shopPurchaseAvailability(item.id).available));
      if (recovery && state.hp < game.stats.max_hp - 30) return { type: 'buy', id: recovery.id };
      const candidates = state.shop.filter(item => item.kind === 'artifact' && !item.sold && item.price <= state.coins &&
        (state.artifacts.find(stack => stack.id === item.id)?.stacks ?? 0) < game.content.byId[item.id].max_stacks);
      const best = candidates.sort((a, b) => artifactScore(game, b.id) - artifactScore(game, a.id))[0];
      if (best && (state.coins - best.price >= 15 || artifactScore(game, best.id) > 22)) return { type: 'buy', id: best.id };
      return { type: 'leave_shop' };
    }
    default: throw new Error(`Unsupported policy phase ${state.phase}`);
  }
}
