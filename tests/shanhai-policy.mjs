// Deterministic, legal decisions for regression only, not an estimate of player skill.
const BRANCHES = {
  RKF01: ['A', 'C', 'B', 'A'], RKF02: ['B', 'B', 'A', 'B'],
  RKF03: ['B', 'B', 'C', 'A'], RKF04: ['C', 'B', 'B', 'C'],
  RKF05: ['B', 'A', 'B', 'A'], RKF06: ['A', 'C', 'C', 'A'],
  RKF07: ['C', 'C', 'B', 'A'], RKF08: ['A', 'C', 'C', 'C'],
  RKF09: ['B', 'C', 'C', 'C'], RKF10: ['A', 'C', 'B', 'A'],
};

export function artifactScore(game, id) {
  const entity = game.content.byId[id], { method, act } = game.state;
  if (!entity) return 0;
  const flat = entity.attributes.flat, percent = entity.attributes.percent;
  let score = (flat.attack ?? 0) + (flat.defense ?? 0) * 0.9 +
    (flat.max_hp ?? 0) * 0.13 + (flat.crit_rate ?? 0) * 80 +
    (percent.attack ?? 0) * game.stats.attack +
    (percent.defense ?? 0) * game.stats.defense +
    (percent.max_hp ?? 0) * game.stats.max_hp * 0.13;
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

export function amount(game, reward) {
  const rules = game.content.rules;
  const basis = reward.basis === 'reference_hp' ? rules.economy.reference_hp_by_act[game.state.act - 1] :
    reward.basis === 'common_price' ? rules.economy.common_prices_by_act[game.state.act - 1] :
      reward.basis === 'next_xp' ? (rules.cultivation.requirements[game.state.n] ?? 0) : 1;
  return reward.amount * basis;
}

export function nextCommand(game, route = 'steady') {
  const state = game.state;
  switch (state.phase) {
    case 'route': return { type: 'route', id: game.availableRoutes().find(item => item.id === route)?.id ?? 'steady' };
    case 'map': return { type: 'enter' };
    case 'preview': return { type: 'fight' };
    case 'battle':
      return { type: state.battle.outcome !== 'draw' ? 'battle_done' :
        state.battleInput.roundLimit >= 4096 ? 'retire' : 'continue_battle' };
    case 'reward': return { type: 'reward', id: [...state.rewardCandidates].sort((a, b) => artifactScore(game, b) - artifactScore(game, a))[0] ?? null };
    case 'talent': {
      const talents = game.availableTalents();
      return { type: 'talent', id: (talents.find(item => item.branch === BRANCHES[state.method][item.tier - 1]) ?? talents[0]).id };
    }
    case 'event': {
      const candidates = game.content.byId[game.node.id].options.filter(item => game.optionAvailability(item).available);
      const score = option => {
        let value = option.encounter ? -10000 : 0;
        for (const cost of option.costs) value -= amount(game, cost) * (cost.resource === 'hp' ? 2 : cost.resource === 'xp' ? 0.15 : 1);
        for (const reward of option.rewards) {
          if (reward.type === 'artifact') value += artifactScore(game, reward.id) * (reward.count ?? 1);
          if (reward.type === 'resource') value += reward.resource === 'hp' ? Math.min(amount(game, reward), game.stats.max_hp - state.hp) * 2 : amount(game, reward) * (reward.resource === 'xp' ? 0.15 : 1);
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
      { type: 'rest', choice: 'heal' };
    case 'shop': {
      const recovery = state.shop.find(item => item.kind === 'recovery' && !item.sold && item.price <= state.coins);
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
