import type { UpgradeDefinition } from '../types/progression';

/**
 * The garage catalogue: four upgrade tracks, each levellable five times.
 *
 * Every track answers one of the four progression levers — faster vehicle, better
 * armour, larger reward multiplier, longer delivery timer — and every cost follows the
 * geometric curve `round(baseCost * costGrowth^ownedLevel)` implemented in
 * `ProgressionMath.getUpgradeCost`, so balance lives here as data, not as code.
 */
export const UPGRADE_CATALOG: readonly UpgradeDefinition[] = [
  {
    id: 'upgrade_thrusters',
    category: 'engine',
    name: 'Overcharged Thrusters',
    description: '+10% top speed per tier, up to the frame safety limit.',
    maxLevel: 5,
    baseCost: 300,
    costGrowth: 1.6,
    effect: { speedBonusRatio: 0.1 },
  },
  {
    id: 'upgrade_reactive_plating',
    category: 'shield',
    name: 'Reactive Plating',
    description: '+30 hull integrity per tier.',
    maxLevel: 5,
    baseCost: 250,
    costGrowth: 1.55,
    effect: { maxHealthBonus: 30 },
  },
  {
    id: 'upgrade_broker_license',
    category: 'cargo',
    name: 'Black-Market Broker License',
    description: '+0.20× delivery payout per tier.',
    maxLevel: 5,
    baseCost: 400,
    costGrowth: 1.7,
    effect: { rewardMultiplierBonus: 0.2 },
  },
  {
    id: 'upgrade_chrono_manifest',
    category: 'utility',
    name: 'Chrono-Stamped Manifest',
    description: '+6 seconds on every delivery timer per tier.',
    maxLevel: 5,
    baseCost: 200,
    costGrowth: 1.5,
    effect: { timerBonusSeconds: 6 },
  },
];

/** Union of the shipped upgrade ids — handy for exhaustiveness checks in UI code. */
export type UpgradeId = (typeof UPGRADE_CATALOG)[number]['id'];
