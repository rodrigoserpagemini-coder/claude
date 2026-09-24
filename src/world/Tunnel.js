import {
  AdditiveBlending, BackSide, CylinderGeometry, Mesh, ShaderMaterial, Vector4,
} from 'three';
import { WORLD } from '../config.js';
import { bendGLSL, bendUniform } from '../core/bend.js';
import { noiseGLSL, rampGLSL } from '../fx/noise.glsl.js';

const vertexShader = /* glsl */ `
  ${bendGLSL}
  varying vec2 vUv;
  varying float vZ;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vZ = wp.z;
    wp.xyz = applyBend(wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// The corona corridor: an open cylinder seen from inside, shaded entirely in
// GLSL. Each of the four zones of the dive has its own wall pattern; the
// shader crossfades between them with uZoneW (wind, outer, inner, chromo).
// A second, slightly smaller translucent cylinder adds drifting plasma veils
// for parallax depth.
export class Tunnel {
  constructor(scene) {
    const { tunnelRadius: R, tunnelLength: L, tunnelNear: near } = WORLD;
    const geo = new CylinderGeometry(R, R, L, 112, 260, true);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, near - L / 2);

    this.uniforms = {
      uBend: bendUniform,
      uTime: { value: 0 },
      uTravel: { value: 0 },
      uDepth: { value: 0 },
      uHeat: { value: 0 },
      uFlash: { value: 0 },
      uStorm: { value: 0 },
      uFar: { value: L - near },
      uZoneW: { value: new Vector4(1, 0, 0, 0) },
    };

    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      side: BackSide,
      vertexShader,
      fragmentShader: /* glsl */ `
        ${noiseGLSL}
        ${rampGLSL}
        uniform float uTime, uTravel, uDepth, uHeat, uFlash, uStorm, uFar;
        uniform vec4 uZoneW;
        varying vec2 vUv;
        varying float vZ;
        void main() {
          float a = vUv.x * 6.28318530718;
          float s = uTravel - vZ;                 // distance along the corridor
          vec2 ring = vec2(cos(a), sin(a));

          float n  = fbm3(vec3(ring * 1.7, s * 0.045 - uTime * 0.22));
          float n2 = snoise(vec3(ring * 3.2, s * 0.12 + uTime * 0.5));
          float cells = snoise(vec3(ring * 7.0, s * 0.28 - uTime * 0.15));
          float base = n * 0.5 + 0.5;
          vec3 col = vec3(0.0);

          // Solar wind: long, nearly straight streamers over dark space.
          if (uZoneW.x > 0.001) {
            float str = pow(abs(sin(a * 7.0 + n * 0.8)), 60.0) * (0.5 + 0.5 * n2);
            float str2 = pow(abs(sin(a * 23.0 + n2 * 0.5 + 1.3)), 90.0) * 0.6;
            vec3 c = plasmaRamp(0.1 + 0.25 * base) * (0.05 + 0.45 * base * base);
            c += plasmaRamp(0.48) * (str + str2) * 1.2;
            col += c * uZoneW.x;
          }

          // Outer corona: field lines twisted by convection, loop bands.
          if (uZoneW.y > 0.001) {
            float twist = a * 14.0 + s * 0.055 + n * 2.4;
            float lines = pow(abs(sin(twist)), 34.0) * (0.55 + 0.45 * n2);
            lines += 0.5 * pow(abs(sin(a * 9.0 - s * 0.035 + n2 * 1.6)), 60.0);
            float band = fract(s / 18.0) - 0.5;
            float loops = exp(-band * band * 180.0) * smoothstep(-0.3, 0.7, n);
            float t = 0.12 + 0.3 * base + 0.06 * cells;
            vec3 c = plasmaRamp(t) * (0.08 + 0.6 * base * base);
            c += plasmaRamp(0.52) * lines * 1.25;
            c += plasmaRamp(0.64) * loops * 0.55;
            col += c * uZoneW.y;
          }

          // Inner corona: dense, bright coronal loops and tight twists.
          if (uZoneW.z > 0.001) {
            float band2 = fract(s / 9.0 + n * 0.15) - 0.5;
            float loops2 = exp(-band2 * band2 * 120.0) * smoothstep(-0.4, 0.5, n2);
            float lines = pow(abs(sin(a * 20.0 + s * 0.09 + n * 3.0)), 24.0);
            vec3 c = plasmaRamp(0.2 + 0.35 * base + 0.05 * cells) * (0.12 + 0.7 * base * base);
            c += plasmaRamp(0.62) * lines * 1.1;
            c += plasmaRamp(0.74) * loops2 * 1.0;
            col += c * uZoneW.z;
          }

          // Chromosphere: hair-like spicules in hydrogen-alpha red.
          if (uZoneW.w > 0.001) {
            float sp = snoise(vec3(ring * 18.0, s * 0.015 - uTime * 0.6));
            float spic = pow(max(sp, 0.0), 3.0);
            float fine = pow(abs(sin(a * 90.0 + sp * 2.0)), 12.0) * smoothstep(0.0, 0.6, sp);
            vec3 halpha = vec3(1.0, 0.13, 0.22);
            vec3 c = mix(plasmaRamp(0.15 + 0.3 * base), halpha * 0.9, 0.55) * (0.1 + 0.6 * base);
            c += halpha * spic * 1.7;
            c += plasmaRamp(0.72) * fine * 0.8;
            col += c * uZoneW.w;
          }

          col *= 1.0 + 0.1 * uHeat;

          // Coronal mass ejection: the walls flare white-magenta and pulse.
          float pulse = 0.5 + 0.5 * sin(s * 0.25 - uTime * 12.0);
          col += uStorm * (vec3(1.0, 0.35, 0.6) * 0.35 * pulse + vec3(0.25, 0.05, 0.1));

          // Toward the far end the corridor dissolves into the photosphere.
          float far = clamp(-vZ / uFar, 0.0, 1.0);
          vec3 core = plasmaRamp(0.8 + 0.12 * uDepth) * (1.5 + 0.7 * uDepth);
          col = mix(col, core, smoothstep(0.45, 1.0, far));

          // Keep the walls next to the probe darker so its silhouette reads.
          col *= mix(0.35, 1.0, smoothstep(-4.0, 40.0, -vZ));
          col += vec3(1.0, 0.35, 0.18) * uFlash;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Plasma veils: translucent wisps drifting slower than the walls.
    const veilGeo = new CylinderGeometry(R * 0.86, R * 0.86, L, 64, 160, true);
    veilGeo.rotateX(-Math.PI / 2);
    veilGeo.translate(0, 0, near - L / 2);
    const veilMat = new ShaderMaterial({
      uniforms: this.uniforms,
      side: BackSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader,
      fragmentShader: /* glsl */ `
        ${noiseGLSL}
        ${rampGLSL}
        uniform float uTime, uTravel, uStorm, uFar;
        uniform vec4 uZoneW;
        varying vec2 vUv;
        varying float vZ;
        void main() {
          float a = vUv.x * 6.28318530718;
          float s = uTravel * 0.7 - vZ;
          float w = snoise(vec3(cos(a) * 1.3, sin(a) * 1.3, s * 0.02 - uTime * 0.1));
          float wisp = smoothstep(0.35, 0.9, w);
          vec3 tint = mix(plasmaRamp(0.55), vec3(1.0, 0.2, 0.3), uZoneW.w);
          float fade = smoothstep(2.0, 20.0, -vZ) * (1.0 - smoothstep(0.35, 0.8, -vZ / uFar));
          gl_FragColor = vec4(tint * wisp * fade * (0.22 + 0.4 * uStorm), 1.0);
        }
      `,
    });
    this.veil = new Mesh(veilGeo, veilMat);
    this.veil.frustumCulled = false;
    scene.add(this.veil);
  }

  update(time, travel, depth, heat, flash, zoneW, storm) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uTravel.value = travel;
    u.uDepth.value = depth;
    u.uHeat.value = heat;
    u.uFlash.value = flash;
    u.uStorm.value = storm;
    u.uZoneW.value.set(zoneW[0], zoneW[1], zoneW[2], zoneW[3]);
  }
}
