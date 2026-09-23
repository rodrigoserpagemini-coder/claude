import {
  AdditiveBlending, Mesh, PlaneGeometry, ShaderMaterial,
} from 'three';
import { WORLD } from '../config.js';
import { bendOffset } from '../core/bend.js';
import { noiseGLSL, rampGLSL } from '../fx/noise.glsl.js';

// The photosphere at the end of the corridor: a camera-facing disc with
// granulation, limb darkening and a halo, bright enough to drive the bloom.
export class SunCore {
  constructor(scene) {
    this.z = -(WORLD.tunnelLength - WORLD.tunnelNear) + 6;
    this.uniforms = {
      uTime: { value: 0 },
      uDepth: { value: 0 },
    };
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${noiseGLSL}
        ${rampGLSL}
        uniform float uTime, uDepth;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          float disc = smoothstep(0.62, 0.58, r);
          float mu = sqrt(max(0.0, 1.0 - pow(r / 0.6, 2.0)));
          float limb = 0.45 + 0.55 * pow(mu, 0.6);
          float gran = snoise(vec3(vUv * 26.0, uTime * 0.35)) * 0.5 + 0.5;
          float spots = fbm3(vec3(vUv * 3.0, uTime * 0.05));
          float t = 0.78 + 0.16 * gran * limb - 0.1 * smoothstep(0.35, 0.6, spots);
          vec3 surface = plasmaRamp(t) * (2.0 + 0.8 * uDepth) * limb;
          float halo = exp(-max(r - 0.55, 0.0) * 7.0) * (1.0 - disc);
          vec3 col = surface * disc + plasmaRamp(0.7) * halo * 1.6;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new Mesh(new PlaneGeometry(34, 34), mat);
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  update(time, depth, camera) {
    this.uniforms.uTime.value = time;
    this.uniforms.uDepth.value = depth;
    const [ox, oy] = bendOffset(this.z);
    this.mesh.position.set(ox, oy, this.z);
    this.mesh.quaternion.copy(camera.quaternion);
  }
}
