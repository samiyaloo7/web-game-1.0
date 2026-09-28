/**
 * Data-driven flavour text for procedurally generated districts and locations.
 *
 * The generator owns geometry; the names live here. That way new districts can be
 * added (or later loaded from Supabase / JSON) without touching the algorithm.
 */

/** Rotated by column so the city reads as a series of vertical districts. */
export const CITY_ZONE_NAMES: string[] = [
  'Neon Slums',
  'Midtown Alley',
  'Corporate Terrace',
  'Industrial Basin',
  'Commercial Strip',
  'Sub-City',
  'Chrome Gardens',
  'Ghost Harbor',
];

/** Prefix for a location name. A grid code is appended for uniqueness. */
export const LOCATION_TEMPLATES: string[] = [
  'Underpass Depot',
  'Back-Alley Loading Bay',
  'Rooftop Relay Tower',
  'Sub-Level Metro Gate',
  'Arcade Back-Door',
  'Black Clinic Overflow',
  'Dock Bay Crane Access',
  'Ramen Bar Service Hatch',
  'Data Vault Airlock',
  'Skybridge Freight Lift',
  'Recycling Co-Op Yard',
  'Currency Exchange Kiosk',
];