import { AdditiveBlending, ShaderMaterial } from 'three';
import { noiseGLSL, rampGLSL } from './noise.glsl.js';

// Emissive plasma for prominence loops, filaments and plasmoids. `displace`
// pushes vertices along their normals with noise, which turns a sphere into a
// churning blob; tubes use a small value so their surface ripples.
export function createPlasmaMaterial({ displace = 0.08, hue = 0.62, gain = 2.6, scale = 1.6 } = {}) {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDisplace: { value: displace },
      uHue: { value: hue },
      uGain: { value: gain },
      uScale: { value: scale },
    },
    vertexShader: /* glsl */ `
      ${noiseGLSL}
      uniform float uTime, uDisplace, uScale;
      varying vec3 vN;
      varying vec3 vView;
      varying float vNoise;
      void main() {
        float n = snoise(position * uScale + vec3(0.0, 0.0, uTime * 1.3));
        vNoise = n;
        vec3 p = position + normal * n * uDisplace;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${rampGLSL}
      uniform float uHue, uGain, uTime;
      varying vec3 vN;
      varying vec3 vView;
      varying float vNoise;
      void main() {
        float facing = abs(dot(normalize(vN), normalize(vView)));
        float core = pow(facing, 1.6);
        float t = uHue + 0.28 * core + 0.12 * vNoise;
        vec3 col = plasmaRamp(t) * uGain * (0.55 + 0.9 * core);
        col += plasmaRamp(uHue + 0.1) * pow(1.0 - facing, 3.0) * uGain * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// Soft additive halo drawn on a slightly larger copy of a hazard's mesh:
// bright at grazing angles, transparent face-on, which reads as a glowing
// atmosphere around the plasma.
export function createGlowMaterial({ hue = 0.55, gain = 1.2, power = 2.2 } = {}) {
  return new ShaderMaterial({
    uniforms: { uHue: { value: hue }, uGain: { value: gain }, uPower: { value: power } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${rampGLSL}
      uniform float uHue, uGain, uPower;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vN), normalize(vView)));
        float rim = pow(facing, uPower) * (1.0 - facing * 0.4);
        gl_FragColor = vec4(plasmaRamp(uHue) * rim * uGain, 1.0);
      }
    `,
  });
}
