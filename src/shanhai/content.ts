import type { Content, Entity } from './types.js';

export function contentFromEntities(entities: Entity[], version = 'shanhai-content-0.1'): Content {
  const byId: Record<string, Entity> = Object.create(null);
  for (const entity of entities) {
    if (!entity.id || byId[entity.id]) throw new Error(`Duplicate or missing content ID: ${entity.id}`);
    byId[entity.id] = entity;
  }
  if (!byId.RULES) throw new Error('Missing RULES content');
  return { entities, byId, rules: byId.RULES, version };
}

export async function loadContent(base = './content/'): Promise<Content> {
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok) throw new Error('无法读取山海内容目录');
  const manifest = await response.json() as { version: string; files: string[] };
  const entities = await Promise.all(manifest.files.map(async file => {
    if (!/^[a-zA-Z0-9/_-]+\.json$/.test(file) || file.includes('..')) throw new Error('Invalid content path');
    const result = await fetch(`${base}${file}`);
    if (!result.ok) throw new Error(`无法读取内容：${file}`);
    return await result.json() as Entity;
  }));
  return contentFromEntities(entities, manifest.version);
}

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function seededRandom(seed: string): () => number {
  let value = hashSeed(seed);
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sample<T>(values: readonly T[], count: number, seed: string): T[] {
  const pool = [...values], random = seededRandom(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
