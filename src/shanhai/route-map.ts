import type { RouteMapNode, RunNode, RunPhase } from './types.js';
import { routeProfilesForAct, type RouteLayoutProfile } from './route-profiles.js';

export const ACT1_CORE_DEPTHS = [1, 4, 7] as const;

export const ACT1_FUNCTION_LAYOUTS = {
  early_challenge: { restDepth: 3, shopDepth: 5, extraEliteDepth: 2 },
  late_preparation: { restDepth: 6, shopDepth: 8, extraEliteDepth: null },
} as const;

export type RouteMapNodeFactory = (depth: number, lane: number, key: string) => RunNode & {
  label?: string;
  description?: string;
};

function keyFor(act: number, depth: number, lane: number): string {
  return `a${act}-d${depth}-l${lane}`;
}

function nextLanes(depth: number, lane: number): number[] {
  if (depth === 10) return [];
  if (depth === 0) return [0, 1, 2];
  if (depth === 9) return [1];
  if (depth === 3 || depth === 6) return [0, 1, 2];
  return [lane];
}

export function createRouteMapNodes(
  act: number,
  makeNode: RouteMapNodeFactory,
): RouteMapNode[] {
  if (!Number.isInteger(act) || act < 1 || act > 5) throw new Error('Invalid route map act');
  if (act === 5) {
    const key = keyFor(act, 0, 1);
    return [{ ...makeNode(0, 1, key), key, depth: 0, lane: 1, next: [] }];
  }

  const nodes: RouteMapNode[] = [];
  const slots = [
    { depth: 0, lanes: [1] },
    ...Array.from({ length: 9 }, (_, index) => ({ depth: index + 1, lanes: [0, 1, 2] })),
    { depth: 10, lanes: [1] },
  ];
  for (const { depth, lanes } of slots) {
    for (const lane of lanes) {
      const key = keyFor(act, depth, lane);
      const next = nextLanes(depth, lane).map(nextLane =>
        keyFor(act, depth + 1, nextLane));
      nodes.push({ ...makeNode(depth, lane, key), key, depth, lane, next });
    }
  }
  return nodes;
}

function invalidRouteMap(): never {
  throw new Error('Invalid route map');
}

function act1TypeAllowedAtDepth(type: string, depth: number): boolean {
  if (depth === 0) return type === 'C';
  if ((ACT1_CORE_DEPTHS as readonly number[]).includes(depth)) return type === 'E' || type === 'K';
  if (depth === ACT1_FUNCTION_LAYOUTS.early_challenge.extraEliteDepth) return type === 'C' || type === 'L';
  if (depth === 3) return type === 'C' || type === 'R';
  if (depth === 5) return type === 'C' || type === 'S';
  if (depth === ACT1_FUNCTION_LAYOUTS.late_preparation.restDepth) return type === 'C' || type === 'R';
  if (depth === ACT1_FUNCTION_LAYOUTS.late_preparation.shopDepth) return type === 'C' || type === 'S';
  if (depth === 9) return type === 'C' || type === 'L';
  if (depth === 10) return type === 'B';
  if (depth === 2 || depth === 6 || depth === 8) return type === 'C';
  return false;
}

function laterActTypeAllowedAtDepth(type: string, depth: number): boolean {
  if (depth === 0) return type === 'C';
  if ((ACT1_CORE_DEPTHS as readonly number[]).includes(depth)) return type === 'E' || type === 'K';
  if (depth === 10) return type === 'B';
  if (depth === 9) return type === 'C' || type === 'L';
  if ([2, 3, 5, 6, 8].includes(depth)) return ['C', 'R', 'S', 'L'].includes(type);
  return false;
}

function isRouteLayoutProfile(layout: RouteLayoutProfile): boolean {
  const allowedDepths = new Set([2, 3, 5, 6, 8]);
  const featureDepths = [
    layout.restDepth,
    layout.shopDepth,
    ...(layout.extraEliteDepth === null ? [] : [layout.extraEliteDepth]),
  ];
  return featureDepths.every(depth => allowedDepths.has(depth)) &&
    new Set(featureDepths).size === featureDepths.length;
}

function isProfileDistribution(
  nodes: RouteMapNode[],
  layout: RouteLayoutProfile,
  act: number,
): boolean {
  if (!isRouteLayoutProfile(layout)) return false;
  const rests = nodes.filter(node => node.type === 'R');
  const shops = nodes.filter(node => node.type === 'S');
  const elites = nodes.filter(node => node.type === 'L');
  const lateElites = elites.filter(node => node.depth === 9);
  const extraElites = layout.extraEliteDepth === null ? [] :
    elites.filter(node => node.depth === layout.extraEliteDepth);
  return nodes.filter(node => node.type === 'K').length <= (act === 1 ? 1 : 3) &&
    rests.length === 1 && rests[0]!.depth === layout.restDepth &&
    shops.length === 1 && shops[0]!.depth === layout.shopDepth &&
    lateElites.length <= 1 && extraElites.length <= 1 &&
    elites.every(node => node.depth === 9 ||
      (layout.extraEliteDepth !== null && node.depth === layout.extraEliteDepth)) &&
    (layout.extraEliteDepth === null ||
      !elites.some(node => node.depth === layout.extraEliteDepth) ||
      elites.some(node => node.depth === 9));
}

function everyRoutePathHasThreeCommonBattles(nodes: RouteMapNode[]): boolean {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const memo = new Map<string, number>();
  const minCommonFrom = (key: string): number => {
    if (memo.has(key)) return memo.get(key)!;
    const node = byKey.get(key);
    if (!node) return Number.NEGATIVE_INFINITY;
    const own = node.type === 'C' ? 1 : 0;
    if (node.depth === 10) {
      memo.set(key, own);
      return own;
    }
    const children = node.next.map(next => byKey.get(next));
    if (!children.length || children.some(child => !child)) return Number.NEGATIVE_INFINITY;
    const result = own + Math.min(...children.map(child => minCommonFrom(child!.key)));
    memo.set(key, result);
    return result;
  };
  const starts = nodes.filter(node => node.depth === 0);
  return starts.length > 0 && Math.min(...starts.map(node => minCommonFrom(node.key))) >= 3;
}

function canReach(
  byKey: ReadonlyMap<string, RouteMapNode>,
  startKey: string,
  targetKey: string,
  excludedKey?: string,
): boolean {
  const queue = [startKey];
  const visited = new Set<string>();
  while (queue.length) {
    const key = queue.shift()!;
    if (key === excludedKey || visited.has(key)) continue;
    if (key === targetKey) return true;
    visited.add(key);
    queue.push(...(byKey.get(key)?.next ?? []));
  }
  return false;
}

function hasRequiredRouteAccess(nodes: RouteMapNode[]): boolean {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const starts = nodes.filter(node => node.depth === 0);
  const bosses = nodes.filter(node => node.depth === 10);
  if (starts.length !== 1 || bosses.length !== 1) return false;

  const start = starts[0]!;
  const boss = bosses[0]!;
  const reachable = new Set<string>();
  const queue = [start.key];
  while (queue.length) {
    const key = queue.shift()!;
    if (reachable.has(key)) continue;
    reachable.add(key);
    queue.push(...(byKey.get(key)?.next ?? []));
  }
  if (reachable.size !== nodes.length || !reachable.has(boss.key)) return false;

  for (const service of nodes.filter(node => node.type === 'R' || node.type === 'S')) {
    if (!reachable.has(service.key) || !canReach(byKey, service.key, boss.key)) return false;
  }
  return nodes.filter(node => node.type === 'L')
    .every(elite => canReach(byKey, start.key, boss.key, elite.key));
}

export function isValidRouteDistribution(
  act: number,
  nodes: RouteMapNode[],
  legacyKeys: ReadonlySet<string> = new Set(),
): boolean {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  if ((counts.get('C') ?? 0) < 3 || (counts.get('R') ?? 0) > 1 ||
    (counts.get('S') ?? 0) > 1 || (counts.get('L') ?? 0) > 2 ||
    (counts.get('K') ?? 0) > 3) return false;
  const coreCountsByDepth = new Map<number, number>();
  for (const node of nodes) {
    if (node.type === 'K') {
      coreCountsByDepth.set(node.depth, (coreCountsByDepth.get(node.depth) ?? 0) + 1);
    }
  }
  if ([...coreCountsByDepth.values()].some(count => count > 1)) return false;

  const authored = nodes.filter(node => !legacyKeys.has(node.key));
  if (!authored.every(node =>
    act === 1
      ? act1TypeAllowedAtDepth(node.type, node.depth)
      : laterActTypeAllowedAtDepth(node.type, node.depth))) return false;
  if (!hasRequiredRouteAccess(nodes) || !everyRoutePathHasThreeCommonBattles(nodes)) return false;
  if (legacyKeys.size) return true;

  const layouts = routeProfilesForAct(act);
  return layouts.some(layout => isProfileDistribution(nodes, layout, act));
}

export function isValidAct1RouteDistribution(
  nodes: RouteMapNode[],
  legacyKeys: ReadonlySet<string> = new Set(),
): boolean {
  return isValidRouteDistribution(1, nodes, legacyKeys);
}

export function validateRouteMap(
  routeMap: unknown,
  act: number,
  nodes: RunNode[],
  step: number,
  phase: RunPhase,
  legacyPath = false,
): asserts routeMap is { nodes: RouteMapNode[]; path: string[] } {
  if (!routeMap || typeof routeMap !== 'object' || Array.isArray(routeMap)) invalidRouteMap();
  const map = routeMap as { nodes?: unknown; path?: unknown };
  if (!Array.isArray(map.nodes) || !Array.isArray(map.path) ||
    map.path.some(key => typeof key !== 'string')) invalidRouteMap();

  const expectedNodes = act === 5 ? 1 : 29;
  if (map.nodes.length !== expectedNodes) invalidRouteMap();
  const byKey = new Map<string, RouteMapNode>();
  for (const candidate of map.nodes) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) invalidRouteMap();
    const node = candidate as RouteMapNode;
    if (typeof node.key !== 'string' || typeof node.id !== 'string' ||
      !['C', 'E', 'K', 'L', 'S', 'R', 'B', 'F'].includes(node.type) ||
      typeof node.completed !== 'boolean' || !Number.isInteger(node.depth) ||
      !Number.isInteger(node.lane) || !Array.isArray(node.next) ||
      node.next.some(key => typeof key !== 'string') ||
      (node.label !== undefined && typeof node.label !== 'string') ||
      (node.description !== undefined && typeof node.description !== 'string') ||
      byKey.has(node.key)) invalidRouteMap();
    byKey.set(node.key, node);
  }

  const expected = createRouteMapNodes(act, (depth, lane, key) => {
    const actual = byKey.get(key);
    return actual ?? { type: 'C', id: '', completed: false };
  });
  if (byKey.size !== expected.length) invalidRouteMap();
  const path = map.path as string[];
  const legacyKeys = new Set(legacyPath ? path : []);
  for (const shape of expected) {
    const node = byKey.get(shape.key);
    if (!node || node.depth !== shape.depth || node.lane !== shape.lane ||
      JSON.stringify(node.next) !== JSON.stringify(shape.next)) invalidRouteMap();
    if (legacyKeys.has(node.key)) continue;
    if (act === 1) {
      if (!act1TypeAllowedAtDepth(node.type, node.depth)) invalidRouteMap();
    } else if (act === 5) {
      if (node.type !== 'F' || node.next.length) invalidRouteMap();
    } else if (!laterActTypeAllowedAtDepth(node.type, node.depth)) {
      invalidRouteMap();
    }
  }
  if (act < 5 &&
    !isValidRouteDistribution(act, map.nodes as RouteMapNode[], legacyKeys)) {
    invalidRouteMap();
  }

  const pathNodes: RouteMapNode[] = [];
  if (path.length > (act === 5 ? 1 : 11) || path.length !== nodes.length) invalidRouteMap();
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!;
    const node = byKey.get(key);
    if (!node || node.depth !== index || pathNodes.some(previous => previous.key === key) ||
      (index > 0 && !pathNodes[index - 1]!.next.includes(key))) invalidRouteMap();
    const selected = nodes[index];
    if (!selected || selected.type !== node.type || selected.id !== node.id ||
      selected.completed !== node.completed) invalidRouteMap();
    pathNodes.push(node);
  }
  for (const candidate of map.nodes as RouteMapNode[]) {
    if (!path.includes(candidate.key) && candidate.completed) invalidRouteMap();
  }

  const finalWin = phase === 'won' && act === 5;
  const atTransition = phase === 'transition' && act < 5;
  const currentIsOpen = nodes[step] !== undefined && !nodes[step]!.completed;
  const expectedStep = finalWin ? 0 : atTransition ? nodes.length :
    currentIsOpen ? step : nodes.length;
  if (step !== expectedStep) invalidRouteMap();
  const expectedPathLength = finalWin ? 1 : atTransition ? 11 :
    currentIsOpen ? step + 1 : step;
  if (path.length !== expectedPathLength) invalidRouteMap();
  for (let index = 0; index < pathNodes.length; index++) {
    const shouldBeComplete = finalWin || atTransition || index < step;
    if (pathNodes[index]!.completed !== shouldBeComplete) invalidRouteMap();
  }
  if (finalWin && (pathNodes[0]?.type !== 'F' || !pathNodes[0]?.completed)) invalidRouteMap();
  if (atTransition && (nodes.length !== 11 || pathNodes.at(-1)?.type !== 'B')) invalidRouteMap();
  if (act === 5 && phase !== 'won' && nodes.length && pathNodes[0]?.type !== 'F') invalidRouteMap();
}
