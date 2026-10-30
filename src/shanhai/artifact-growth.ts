import type { ArtifactStack, Content } from './types.js';

export const DEVOURING_ARTIFACT_ID = 'RL09';

export interface ArtifactDevourRule {
  kind: 'stack_consumption_damage';
  multiplier_per_stack: number;
  maximum_multiplier: number;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function entity(content: Content, id: string): Record<string, any> | undefined {
  const byId = content.byId as any;
  if (byId instanceof Map) return byId.get(id);
  return byId?.[id] ?? content.entities.find(item => item.id === id);
}

export function assertArtifactDevouredField(stack: unknown, label = 'artifact stack'): void {
  if (!isRecord(stack) || !Object.hasOwn(stack, 'devoured')) return;
  if (stack.id !== DEVOURING_ARTIFACT_ID || !Number.isSafeInteger(stack.devoured) || stack.devoured < 0) {
    throw new Error(`Invalid ${label} devoured counter`);
  }
}

export function artifactDevouredCount(stack: ArtifactStack | undefined): number {
  if (!stack) return 0;
  assertArtifactDevouredField(stack);
  return stack.id === DEVOURING_ARTIFACT_ID ? stack.devoured ?? 0 : 0;
}

export function artifactDevourRule(content: Content): ArtifactDevourRule {
  const artifact = entity(content, DEVOURING_ARTIFACT_ID);
  const rule = artifact?.devour_rule;
  if (!isRecord(rule) || rule.kind !== 'stack_consumption_damage' ||
    !Number.isFinite(rule.multiplier_per_stack) || rule.multiplier_per_stack <= 1 ||
    !Number.isFinite(rule.maximum_multiplier) || rule.maximum_multiplier < rule.multiplier_per_stack) {
    throw new Error(`Invalid ${DEVOURING_ARTIFACT_ID} devour rule`);
  }
  return rule as ArtifactDevourRule;
}

export function devouredDamageMultiplier(rule: ArtifactDevourRule, devoured: number): number {
  if (!Number.isSafeInteger(devoured) || devoured < 0 ||
    !Number.isFinite(rule.multiplier_per_stack) || rule.multiplier_per_stack <= 1 ||
    !Number.isFinite(rule.maximum_multiplier) || rule.maximum_multiplier < rule.multiplier_per_stack) {
    throw new Error('Invalid artifact devour growth input');
  }
  if (devoured === 0) return 1;
  // Keep the exponent bounded before exp so even a forged large counter yields
  // a finite configured multiplier.
  const exponent = Math.min(
    Math.log(rule.maximum_multiplier),
    devoured * Math.log(rule.multiplier_per_stack),
  );
  return Math.exp(exponent);
}

export function devouredMultiplierForContent(content: Content, devoured: number): number {
  return devouredDamageMultiplier(artifactDevourRule(content), devoured);
}
