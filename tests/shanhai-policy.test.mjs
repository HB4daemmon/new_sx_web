import assert from 'node:assert/strict';
import test from 'node:test';
import { equipmentCommand, nextCommand } from './shanhai-policy.mjs';

const ARTIFACTS = {
  RC10: { kind: 'artifact', equipment_role: 'core', attributes: { flat: { attack: 2 }, percent: {} } },
  RC11: { kind: 'artifact', equipment_role: 'core', attributes: { flat: { defense: 2 }, percent: {} } },
  RC01: { kind: 'artifact', equipment_role: 'support', attributes: { flat: { attack: 6 }, percent: {} } },
  RC03: { kind: 'artifact', equipment_role: 'support', attributes: { flat: { defense: 5 }, percent: {} } },
  RC04: { kind: 'artifact', equipment_role: 'support', attributes: { flat: {}, percent: {} } },
  RR06: { kind: 'artifact', equipment_role: 'support', attributes: { flat: {}, percent: {} } },
};

function game({ core = null, support = [], artifacts = [] } = {}) {
  return {
    state: {
      phase: 'map',
      method: 'RKF01',
      act: 1,
      n: 0,
      equipment: { core, support },
      artifacts,
    },
    content: {
      byId: ARTIFACTS,
      rules: {
        cultivation: {
          base_stats_by_tier: [{ attack: 100, defense: 100, max_hp: 500 }],
        },
      },
    },
    canChangeEquipment: () => true,
    stats: { attack: 100, defense: 100, max_hp: 500 },
  };
}

test('equipment policy fills compatible empty slots from owned inventory', () => {
  const candidate = game({
    artifacts: [{ id: 'RC11', stacks: 1 }, { id: 'RC01', stacks: 1 }],
  });

  assert.deepEqual(equipmentCommand(candidate), { type: 'equip', id: 'RC11' });
  candidate.state.equipment.core = 'RC11';
  assert.deepEqual(equipmentCommand(candidate), { type: 'equip', id: 'RC01' });
});

test('equipment policy replaces the weakest same-role slot only for a strict score gain', () => {
  const candidate = game({
    core: 'RC10',
    support: ['RC01', 'RC03', 'RC04'],
    artifacts: [
      { id: 'RC10', stacks: 1 },
      { id: 'RC11', stacks: 1 },
      { id: 'RC01', stacks: 1 },
      { id: 'RC03', stacks: 1 },
      { id: 'RC04', stacks: 1 },
      { id: 'RR06', stacks: 1 },
    ],
  });
  const upgrade = equipmentCommand(candidate);
  assert.deepEqual(upgrade, { type: 'equip', id: 'RR06', replace: 'RC04' });

  candidate.state.equipment.support[2] = 'RR06';
  candidate.state.equipment.core = 'RC11';
  assert.equal(equipmentCommand(candidate), null);
  assert.equal(equipmentCommand(candidate), null);
});

test('talent policy accepts the randomly sampled shared insight candidate', () => {
  const candidate = {
    state: { phase: 'talent', method: 'RKF01' },
    availableTalents: () => [{ id: 'V2-J1-C', branch: 'C' }],
  };

  assert.deepEqual(nextCommand(candidate), { type: 'talent', id: 'V2-J1-C' });
});
