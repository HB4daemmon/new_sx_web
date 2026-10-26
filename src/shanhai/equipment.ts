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
  const ids = [state.equipment?.core, ...(state.equipment?.support ?? [])]
    .filter((id): id is string => typeof id === 'string');
  return ids.flatMap(id => {
    const stack = state.artifacts.find(item => item.id === id);
    return stack ? [{ id, stacks: stack.stacks }] : [];
  });
}

export function autoEquipArtifact(content: Content, state: RunState, id: string): void {
  const role = artifactRole(content, id);
  if (!role || (state.equipment.core === id) || state.equipment.support.includes(id)) return;
  if (role === 'core') {
    if (state.equipment.core === null) state.equipment.core = id;
  } else if (state.equipment.support.length < 3) {
    state.equipment.support.push(id);
  }
}

export function removeMissingEquipment(state: RunState): void {
  const owned = new Set(state.artifacts.map(stack => stack.id));
  if (state.equipment.core && !owned.has(state.equipment.core)) state.equipment.core = null;
  state.equipment.support = state.equipment.support.filter(id => owned.has(id));
}

export function validateEquipment(content: Content, state: RunState): void {
  const equipment = state.equipment;
  if (!equipment || (equipment.core !== null && typeof equipment.core !== 'string') ||
    !Array.isArray(equipment.support) || equipment.support.length > 3 ||
    equipment.support.some(id => typeof id !== 'string') ||
    new Set(equipment.support).size !== equipment.support.length ||
    (equipment.core !== null && equipment.support.includes(equipment.core))) {
    throw new Error('Invalid equipment slots');
  }
  const owned = new Set(state.artifacts.map(stack => stack.id));
  const validateSlot = (id: string, expected: EquipmentRole): void => {
    if (!owned.has(id) || artifactRole(content, id) !== expected) {
      throw new Error('Invalid equipped artifact');
    }
  };
  if (equipment.core !== null) validateSlot(equipment.core, 'core');
  for (const id of equipment.support) validateSlot(id, 'support');
}
