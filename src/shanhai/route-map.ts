import type { RouteMapNode, RunNode, RunPhase } from './types.js';

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
  if (lane === 0) return [0, 1];
  if (lane === 1) return [0, 1, 2];
  return [1, 2];
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
    if (act === 5) {
      if (node.type !== 'F' || node.next.length) invalidRouteMap();
    } else if (node.depth === 0 && node.type !== 'C') {
      invalidRouteMap();
    } else if (node.depth === 2 || node.depth === 6 || node.depth === 8) {
      if (node.type !== 'C') invalidRouteMap();
    } else if (node.depth === 10 && node.type !== 'B') {
      invalidRouteMap();
    } else if ([1, 4, 7].includes(node.depth) && !['E', 'K'].includes(node.type)) {
      invalidRouteMap();
    } else if (node.depth === 3 && !['C', 'R'].includes(node.type)) {
      invalidRouteMap();
    } else if (node.depth === 5 && !['C', 'S'].includes(node.type)) {
      invalidRouteMap();
    } else if (node.depth === 9 && !['C', 'L'].includes(node.type)) {
      invalidRouteMap();
    }
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
