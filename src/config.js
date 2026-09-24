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
  radarRange: 170,       // how far ahead the radar sees
};

export const PACE = {
  startSpeed: 38,
  maxExtraSpeed: 46,
  speedRamp: 5200,       // travel units for the ramp to reach ~63%
  kmPerUnit: 3.2,        // speed readout: units/s → km/s
  boostMult: 1.45,
};

// Heliocentric distance in solar radii (R☉) as a function of travel.
export const SUN = {
  startRadii: 20,
  floorRadii: 1.05,
  depthScale: 7000,
  parkerRadii: 9.86,     // Parker Solar Probe perihelion, 24 Dec 2024
  parkerSpeed: 191.7,    // km/s at that perihelion
  earthRadii: 215,       // 1 AU in solar radii, for the sunlight readout
};

export const HEAT = {
  start: 18,
  baseRate: 2.1,         // %/s at the start of a dive
  depthRate: 3.4,        // extra %/s at full depth
  boostRate: 2.6,        // extra %/s while boosting
  stormMult: 1.6,        // multiplier during a coronal mass ejection
  coolant: 22,
  hit: 30,
  shieldMinC: 320,       // shield temperature readout range
  shieldMaxC: 1650,
};

export const ENERGY = {
  start: 40,
  passive: 1.6,          // %/s
  graze: 12,
  cell: 35,
  boostDrain: 24,        // %/s
  shieldCost: 60,
  shieldTime: 3.5,       // s
};

// The dive's map: four real layers of the solar atmosphere, keyed by the
// heliocentric distance (R☉) at which each one begins.
export const ZONES = [
  {
    id: 'wind', name: 'Vento solar', from: 20,
    note: 'Partículas escapam do Sol a 300–800 km/s. Serpentinas longas e retas.',
  },
  {
    id: 'outer', name: 'Coroa externa', from: 13,
    note: 'Plasma a mais de 1 milhão de kelvin, torcido pelo campo magnético.',
  },
  {
    id: 'inner', name: 'Coroa interna', from: 8,
    note: 'Laços coronais presos às manchas solares. Arcos duplos.',
  },
  {
    id: 'chromo', name: 'Cromosfera', from: 4,
    note: 'Jatos de plasma chamados espículas e o brilho vermelho do hidrogênio (H-alfa).',
  },
];

export function radiiAt(travel) {
  return SUN.floorRadii + (SUN.startRadii - SUN.floorRadii) * Math.exp(-travel / SUN.depthScale);
}

// 0 at the start of a dive, approaching 1 as the probe nears the photosphere.
export function depthAt(travel) {
  return 1 - Math.exp(-travel / SUN.depthScale);
}

// Sunlight relative to Earth's: falls off with the square of distance.
export function sunlightAt(radii) {
  return (SUN.earthRadii / radii) ** 2;
}

export function zoneIndex(radii) {
  let i = 0;
  while (i < ZONES.length - 1 && radii <= ZONES[i + 1].from) i++;
  return i;
}

// Crossfade weights for the four zones, blended over ±0.6 R☉ at each border.
export function zoneWeights(radii, out = [0, 0, 0, 0]) {
  const band = 0.6;
  let prev = 1;
  for (let i = 0; i < ZONES.length; i++) {
    const next = i + 1 < ZONES.length
      ? Math.min(1, Math.max(0, (radii - (ZONES[i + 1].from - band)) / (2 * band)))
      : 0;
    // `prev` = how much we are past this zone's start; `next` = how much we have not yet reached the next.
    out[i] = i === 0 ? next : prev * (i + 1 < ZONES.length ? next : 1);
    prev = 1 - next;
  }
  // Normalise.
  const sum = out.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}
