import {
  BackSide, CylinderGeometry, Mesh, ShaderMaterial,
} from 'three';
import { WORLD } from '../config.js';
import { bendGLSL, bendUniform } from '../core/bend.js';
import { noiseGLSL, rampGLSL } from '../fx/noise.glsl.js';

// The corona corridor: an open cylinder seen from inside, shaded entirely in
// GLSL — convective noise, twisted magnetic field lines and loop bands, fading
// into the white-hot photosphere at the far end.
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
      uFar: { value: L - near },
    };

    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      side: BackSide,
      vertexShader: /* glsl */ `
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
      `,
      fragmentShader: /* glsl */ `
        ${noiseGLSL}
        ${rampGLSL}
        uniform float uTime, uTravel, uDepth, uHeat, uFlash, uFar;
        varying vec2 vUv;
        varying float vZ;
        void main() {
          float a = vUv.x * 6.28318530718;
          float s = uTravel - vZ;                 // distance along the corridor
          vec2 ring = vec2(cos(a), sin(a));

          float n  = fbm3(vec3(ring * 1.7, s * 0.045 - uTime * 0.22));
          float n2 = snoise(vec3(ring * 3.2, s * 0.12 + uTime * 0.5));
          float cells = snoise(vec3(ring * 7.0, s * 0.28 - uTime * 0.15));

          // Magnetic field lines, twisted along the corridor and bent by convection.
          float twist = a * 14.0 + s * 0.055 + n * 2.4;
          float lines = pow(abs(sin(twist)), 34.0) * (0.55 + 0.45 * n2);
          float twist2 = a * 9.0 - s * 0.035 + n2 * 1.6;
          lines += 0.5 * pow(abs(sin(twist2)), 60.0);

          // Coronal loop bands every 18 units.
          float band = fract(s / 18.0) - 0.5;
          float loops = exp(-band * band * 180.0) * smoothstep(-0.3, 0.7, n);

          float base = n * 0.5 + 0.5;
          float t = 0.12 + 0.3 * base + 0.06 * cells + 0.1 * uDepth + 0.08 * uHeat;
          vec3 col = plasmaRamp(t) * (0.08 + 0.6 * base * base);
          col += plasmaRamp(0.5 + 0.25 * uDepth) * lines * 1.25;
          col += plasmaRamp(0.64) * loops * 0.55;

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
  }

  update(time, travel, depth, heat, flash) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uTravel.value = travel;
    u.uDepth.value = depth;
    u.uHeat.value = heat;
    u.uFlash.value = flash;
  }
}
