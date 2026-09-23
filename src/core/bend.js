import { Vector2 } from 'three';

// The tunnel is straight in simulation space. Everything ahead of the probe is
// displaced sideways by bend * z², which reads on screen as a winding corridor
// while collisions stay trivial (the probe sits at z = 0, where the offset is 0).
export const bendUniform = { value: new Vector2() };

export function bendOffset(z) {
  const d = Math.min(z, 0);
  const k = d * d;
  return [bendUniform.value.x * k, bendUniform.value.y * k];
}

// Drift the curvature from the distance travelled, so the path is deterministic
// for a given run and always smooth.
export function updateBend(travel) {
  const s = travel * 0.0021;
  bendUniform.value.set(
    0.00042 * Math.sin(s * 1.0) + 0.00018 * Math.sin(s * 2.7 + 1.3),
    0.00032 * Math.sin(s * 0.83 + 2.1) + 0.00014 * Math.cos(s * 2.1)
  );
}

export const bendGLSL = /* glsl */ `
uniform vec2 uBend;
vec3 applyBend(vec3 wp) {
  float d = min(wp.z, 0.0);
  wp.xy += uBend * d * d;
  return wp;
}
`;
