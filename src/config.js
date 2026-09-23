// World scale: 1 unit ≈ 1 probe length. Travel speed is in units per second.
export const WORLD = {
  tunnelRadius: 6,
  tunnelLength: 280,
  tunnelNear: 24,        // how far the tunnel extends behind the camera
  spawnZ: -240,          // where hazards and pickups appear
  despawnZ: 12,          // where they are recycled
  moveRadius: 4.5,       // how far from the axis the probe may fly
  probeRadius: 0.5,      // collision radius
  nearMissMargin: 0.85,  // extra clearance that still counts as a graze
};

export const PACE = {
  startSpeed: 38,
  maxExtraSpeed: 46,
  speedRamp: 5200,       // travel units for the ramp to reach ~63%
  kmPerUnit: 3.2,        // speed readout: units/s → km/s
};

// Heliocentric distance in solar radii (R☉) as a function of travel.
export const SUN = {
  startRadii: 20,
  floorRadii: 1.05,
  depthScale: 9000,
  parkerRadii: 9.86,     // Parker Solar Probe perihelion, 24 Dec 2024
  parkerSpeed: 191.7,    // km/s at that perihelion
};

export const HEAT = {
  start: 18,
  baseRate: 2.1,         // %/s at the start of a dive
  depthRate: 3.4,        // extra %/s at full depth
  coolant: 22,
  hit: 30,
  shieldMinC: 320,       // shield temperature readout range
  shieldMaxC: 1650,
};

export function radiiAt(travel) {
  return SUN.floorRadii + (SUN.startRadii - SUN.floorRadii) * Math.exp(-travel / SUN.depthScale);
}

// 0 at the start of a dive, approaching 1 as the probe nears the photosphere.
export function depthAt(travel) {
  return 1 - Math.exp(-travel / SUN.depthScale);
}

// Coronal temperature in MK — rises from ~1 MK in the outer corona.
export function coronaMK(travel) {
  return 0.9 + 2.3 * depthAt(travel);
}
