import { seededRandom } from './content.js';
import type { Entity } from './types.js';

export interface RouteLayoutProfile {
  id: string;
  label: string;
  restDepth: number;
  shopDepth: number;
  extraEliteDepth: number | null;
}

export const ROUTE_PROFILES_BY_ACT: Readonly<Record<number, readonly RouteLayoutProfile[]>> = {
  1: [
    {
      id: 'early_challenge',
      label: '前段争战',
      restDepth: 3,
      shopDepth: 5,
      extraEliteDepth: 2,
    },
    {
      id: 'late_preparation',
      label: '后段整备',
      restDepth: 6,
      shopDepth: 8,
      extraEliteDepth: null,
    },
  ],
  2: [
    {
      id: 'bridge_trade',
      label: '桥市取舍',
      restDepth: 2,
      shopDepth: 5,
      extraEliteDepth: 8,
    },
    {
      id: 'elite_risk',
      label: '精英押注',
      restDepth: 6,
      shopDepth: 3,
      extraEliteDepth: 5,
    },
  ],
  3: [
    {
      id: 'ember_march',
      label: '火道连战',
      restDepth: 3,
      shopDepth: 8,
      extraEliteDepth: 6,
    },
    {
      id: 'ash_supply',
      label: '灰烬补给',
      restDepth: 8,
      shopDepth: 2,
      extraEliteDepth: 5,
    },
  ],
  4: [
    {
      id: 'late_provisions',
      label: '末段整备',
      restDepth: 6,
      shopDepth: 8,
      extraEliteDepth: 3,
    },
    {
      id: 'final_reserves',
      label: '关前储备',
      restDepth: 8,
      shopDepth: 6,
      extraEliteDepth: 2,
    },
  ],
};

const ACT_NUMBER_BY_ID: Readonly<Record<string, number>> = {
  RA01: 1,
  RA02: 2,
  RA03: 3,
  RA04: 4,
};

const FINAL_ACT_PLACEHOLDER: RouteLayoutProfile = {
  id: 'final_act_placeholder',
  label: '终局战',
  restDepth: 0,
  shopDepth: 0,
  extraEliteDepth: null,
};

export function routeProfilesForAct(actNumber: number): readonly RouteLayoutProfile[] {
  return ROUTE_PROFILES_BY_ACT[actNumber] ?? [];
}

export function routeLayoutForAct(act: Entity, seed: string): RouteLayoutProfile {
  if (act.id === 'RF01') return { ...FINAL_ACT_PLACEHOLDER };
  const actNumber = ACT_NUMBER_BY_ID[act.id];
  const profiles = actNumber === undefined ? undefined : ROUTE_PROFILES_BY_ACT[actNumber];
  if (!profiles?.length) throw new Error(`No route profiles for act: ${act.id}`);

  const profileIndex = Math.floor(
    seededRandom(`${seed}:route-map:${actNumber}:function-cadence`)() * profiles.length,
  );
  return { ...profiles[profileIndex]! };
}
