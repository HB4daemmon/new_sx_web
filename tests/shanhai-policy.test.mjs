import assert from 'node:assert/strict';
import test from 'node:test';
import { equipmentCommand, nextCommand } from './shanhai-policy.mjs';

const ARTIFACTS = {
  RC10: { kind: 'artifact', equipment_role: 'core', attributes: { flat: { attack: 2 }, percent: {} } },
  RC11: { kind: 'artifact', equipment_role: 'core', attributes: { flat: { defense: 2 }, percent: {} } },
  RC01: { kind: 'artifact', equipment_role: 'support', attributes: { flat: { attack: 6 }, percent: {} } },
  RC03: { kind: 'artifact', equipment_role: 'support', attributes: { flat: { defense: 5 }, percent: {} } },
  RC04: { kind: 'artifact', equipment_role: 'support', attributes: { flat: {}, percent: {} } },
  RR06: { kind: 'artifact', equipment_role: 'core', attributes: { flat: {}, percent: {} } },
};

function game({ slots = [], artifacts = [], coins = 0, progress = {} } = {}) {
  return {
    state: {
      phase: 'map',
      method: 'RKF01',
      act: 1,
      n: 0,
      coins,
      progress,
      equipment: { slots },
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

test('equipment policy fills four generic slots from multiple descriptive roles', () => {
  const candidate = game({
    artifacts: [
      { id: 'RC10', stacks: 1 },
      { id: 'RC11', stacks: 1 },
      { id: 'RC01', stacks: 1 },
      { id: 'RC03', stacks: 1 },
    ],
  });

  while (candidate.state.equipment.slots.length < 4) {
    const command = equipmentCommand(candidate);
    assert.ok(command, 'an owned artifact fills each empty generic slot');
    candidate.state.equipment.slots.push(command.id);
  }
  assert.equal(candidate.state.equipment.slots.length, 4);
  assert.equal(new Set(candidate.state.equipment.slots).size, 4);
  assert.equal(candidate.state.equipment.slots.filter(id => ARTIFACTS[id].equipment_role === 'core').length, 2);
  assert.equal(candidate.state.equipment.slots.filter(id => ARTIFACTS[id].equipment_role === 'support').length, 2);
  assert.equal(equipmentCommand(candidate), null);
});

test('equipment policy replaces the weakest generic slot for the best strict score gain', () => {
  const candidate = game({
    slots: ['RC10', 'RC01', 'RC03', 'RC04'],
    artifacts: [
      { id: 'RC10', stacks: 1 },
      { id: 'RC11', stacks: 1 },
      { id: 'RC01', stacks: 1 },
      { id: 'RC03', stacks: 1 },
      { id: 'RC04', stacks: 1 },
      { id: 'RR06', stacks: 1 },
    ],
  });
  assert.deepEqual(equipmentCommand(candidate), { type: 'equip', id: 'RR06', replace: 'RC04' });

  candidate.state.equipment.slots[3] = 'RR06';
  assert.deepEqual(equipmentCommand(candidate), { type: 'equip', id: 'RC11', replace: 'RC03' });
  candidate.state.equipment.slots[2] = 'RC11';
  assert.equal(equipmentCommand(candidate), null);
});

test('talent policy values current wealth and inventory diversity among shared candidates', () => {
  const candidate = {
    state: {
      phase: 'talent',
      method: 'RKF01',
      coins: 300,
      artifacts: [{ id: 'RC01', stacks: 1 }],
      progress: { coinsSpent: 0, eliteWins: 0, bossWins: 0 },
    },
    availableTalents: () => [
      { id: 'V2-J1-A', branch: 'A', effects: [{ params: { build: 'wealth_damage' } }] },
      { id: 'V2-J1-C', branch: 'C', effects: [{ params: { build: 'speed_damage' } }] },
      { id: 'V2-J1-D', branch: 'D', effects: [{ params: { build: 'carapace' } }] },
    ],
  };
  assert.deepEqual(nextCommand(candidate), { type: 'talent', id: 'V2-J1-A' });

  candidate.state.coins = 0;
  assert.deepEqual(nextCommand(candidate), { type: 'talent', id: 'V2-J1-D' });
  candidate.state.artifacts = Array.from({ length: 10 }, (_, index) => ({
    id: `RC${String(index + 1).padStart(2, '0')}`,
    stacks: 1,
  }));
  candidate.availableTalents = () => [
    { id: 'V2-J1-A', branch: 'A', effects: [{ params: { build: 'wealth_damage' } }] },
    { id: 'V2-J1-F', branch: 'F', effects: [{ params: { build: 'collection_damage' } }] },
    { id: 'V2-J1-D', branch: 'D', effects: [{ params: { build: 'carapace' } }] },
  ];
  assert.deepEqual(nextCommand(candidate), { type: 'talent', id: 'V2-J1-F' });
});

test('talent policy can select a high-value shared build over its local branch preference', () => {
  const candidate = {
    state: { phase: 'talent', method: 'RKF01', n: 1, coins: 0, artifacts: [], progress: {} },
    availableTalents: () => [
      { id: 'RKF01-T2-A', tier: 2, branch: 'A' },
      { id: 'V2-J2-C', tier: 2, branch: 'C', effects: [{ params: { build: 'basic_split' } }] },
    ],
  };

  assert.deepEqual(nextCommand(candidate), { type: 'talent', id: 'V2-J2-C' });
});
