import type { ArtifactStack, Content, EquipmentRole, RunState } from './types.js';

function entity(content: Content, id: string): Record<string, any> | undefined {
  const byId = content.byId as any;
  if (byId instanceof Map) return byId.get(id);
  return byId?.[id] ?? content.entities.find(item => item.id === id);
}

export function artifactRole(content: Content, id: string): EquipmentRole | undefined {
  const artifact = entity(content, id);
  if (artifact?.kind !== 'artifact') return undefined;
  if (artifact.equipment_role === 'core' || artifact.equipment_role === 'support') {
    return artifact.equipment_role;
  }
  return undefined;
}

export function equippedArtifactStacks(state: RunState): ArtifactStack[] {
  const ids = state.equipment?.slots ?? [];
  return ids.flatMap(id => {
    const stack = state.artifacts.find(item => item.id === id);
    return stack ? [{ id, stacks: stack.stacks }] : [];
  });
}

export function autoEquipArtifact(content: Content, state: RunState, id: string): void {
  if (!artifactRole(content, id) || state.equipment.slots.includes(id) ||
    state.equipment.slots.length >= 4) return;
  state.equipment.slots.push(id);
}

export function removeMissingEquipment(state: RunState): void {
  const owned = new Set(state.artifacts.map(stack => stack.id));
  state.equipment.slots = state.equipment.slots.filter(id => owned.has(id));
}

export function validateEquipment(content: Content, state: RunState): void {
  const slots = state.equipment?.slots;
  if (!Array.isArray(slots) || slots.length > 4 ||
    slots.some(id => typeof id !== 'string') || new Set(slots).size !== slots.length) {
    throw new Error('Invalid equipment slots');
  }
  const owned = new Set(state.artifacts.map(stack => stack.id));
  for (const id of slots) {
    if (!owned.has(id) || !artifactRole(content, id)) {
      throw new Error('Invalid equipped artifact');
    }
  }
}
