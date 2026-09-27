import { PackageDefinition, DeliveryLocation } from '../types/delivery';

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
 * Pre-designated drop and pickup locations across Sector 04 (1280 x 720 canvas).
 * In future phases, these can come from Tiled map object layers or procedurally generated streets.
 */
export const SECTOR_LOCATIONS: DeliveryLocation[] = [
  {
    id: 'loc_slums_depot',
    name: 'District 4 Underpass Depot',
    zone: 'Neon Slums',
    x: 140,
    y: 130,
  },
  {
    id: 'loc_cyber_clinic',
    name: 'OmniMed Black Clinic',
    zone: 'Midtown Alley',
    x: 1140,
    y: 140,
  },
  {
    id: 'loc_dock_warehouse',
    name: 'Sector Docks Bay 9',
    zone: 'Industrial Basin',
    x: 180,
    y: 600,
  },
  {
    id: 'loc_syndicate_tower',
    name: 'Nexis High-Rise Helipad',
    zone: 'Corporate Terrace',
    x: 1100,
    y: 580,
  },
  {
    id: 'loc_arcade_den',
    name: 'Akira Arcade Back-Door',
    zone: 'Commercial Strip',
    x: 640,
    y: 120,
  },
  {
    id: 'loc_subway_terminal',
    name: 'Sub-Level Metro Gate 3',
    zone: 'Sub-City',
    x: 640,
    y: 600,
  },
];
