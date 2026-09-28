import { PackageDefinition } from '../types/delivery';

/**
 * Catalog of package definitions.
 * In later steps, this can be loaded from Supabase or external JSON configs.
 */
export const PACKAGE_CATALOG: PackageDefinition[] = [
  {
    id: 'pkg_neural_chip',
    name: 'Neural Coprocessor V4',
    weightCategory: 'light',
    fragility: 'fragile',
    baseRewardCredits: 120,
    baseRewardXp: 45,
  },
  {
    id: 'pkg_cryo_serum',
    name: 'Cryogenic Regen Serum',
    weightCategory: 'light',
    fragility: 'fragile',
    baseRewardCredits: 160,
    baseRewardXp: 60,
  },
  {
    id: 'pkg_power_core',
    name: 'Hyper-Capacitor Core',
    weightCategory: 'heavy',
    fragility: 'durable',
    baseRewardCredits: 210,
    baseRewardXp: 80,
  },
  {
    id: 'pkg_data_drive',
    name: 'Encrypted Syndicate Drive',
    weightCategory: 'standard',
    fragility: 'durable',
    baseRewardCredits: 95,
    baseRewardXp: 35,
  },
];

/**
 * NOTE: pickup/drop-off coordinates are no longer hardcoded here.
 * `CityGenerator` produces mission locations for the generated district, and
 * `DeliveryManager` receives them as plain data. See `src/game/data/cityData.ts`
 * for the naming pools used while generating those locations.
 */
