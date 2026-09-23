import {
  AdditiveBlending, BufferAttribute, BufferGeometry, LineSegments, ShaderMaterial,
} from 'three';
import { WORLD } from '../config.js';
import { bendGLSL, bendUniform } from '../core/bend.js';

// Solar-wind streaks: line segments whose length follows the probe's speed.
// Positions are computed on the GPU from a seed, so there is no per-frame upload.
export class Streaks {
  constructor(scene, count = 420) {
    const span = 260;
    const seeds = new Float32Array(count * 2 * 3);
    const tails = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = 1.0 + Math.sqrt(Math.random()) * (WORLD.tunnelRadius - 1.4);
      const z0 = Math.random() * span;
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        seeds.set([theta, r, z0], j * 3);
        tails[j] = k;
      }
    }
    const geo = new BufferGeometry();
    // `position` is required by three.js; the shader ignores it.
    geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 2 * 3), 3));
    geo.setAttribute('aSeed', new BufferAttribute(seeds, 3));
    geo.setAttribute('aTail', new BufferAttribute(tails, 1));

    this.uniforms = {
      uBend: bendUniform,
      uTravel: { value: 0 },
      uSpeed: { value: 0 },
      uSpan: { value: span },
      uGain: { value: 1 },
    };

    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        ${bendGLSL}
        attribute vec3 aSeed;
        attribute float aTail;
        uniform float uTravel, uSpeed, uSpan;
        varying float vA;
        void main() {
          float z = mod(aSeed.z + uTravel * 1.35, uSpan) - uSpan + 16.0;
          float len = 0.4 + uSpeed * 0.09;
          z += aTail * len;
          vec3 p = vec3(cos(aSeed.x) * aSeed.y, sin(aSeed.x) * aSeed.y, z);
          vA = (1.0 - aTail) * smoothstep(-uSpan + 16.0, -uSpan + 90.0, z) * smoothstep(16.0, 4.0, z);
          gl_Position = projectionMatrix * viewMatrix * vec4(applyBend(p), 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uGain;
        varying float vA;
        void main() {
          gl_FragColor = vec4(vec3(1.1, 0.7, 0.36) * vA * uGain, 1.0);
        }
      `,
    });

    this.mesh = new LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(travel, speed) {
    this.uniforms.uTravel.value = travel;
    this.uniforms.uSpeed.value = speed;
  }
}
