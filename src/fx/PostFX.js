import { Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

// One full-screen pass in linear HDR, before tone mapping:
//  · crepuscular rays streaming from the photosphere's screen position,
//  · a radial zoom blur while boosting,
//  · heat shimmer, chromatic aberration,
//  · alarm (red) and magnetic shield (cyan) edge tints, vignette and grain.
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.002 },
    uShimmer: { value: 0 },
    uVignette: { value: 1.1 },
    uFlash: { value: 0 },
    uAspect: { value: 1 },
    uSun: { value: new Vector2(0.5, 0.5) },
    uRays: { value: 0 },
    uZoom: { value: 0 },
    uAlarm: { value: 0 },
    uShield: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uShimmer, uVignette, uFlash, uAspect, uRays, uZoom, uAlarm, uShield;
    uniform vec2 uSun;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      c.x *= uAspect;
      float r = length(c);
      float jitter = hash(uv * 731.0 + fract(uTime * 7.0));

      // Rising-air shimmer, strongest at the edges of the frame.
      uv += uShimmer * r * vec2(
        sin(uv.y * 38.0 + uTime * 9.0) + sin(uv.y * 71.0 - uTime * 13.0) * 0.5,
        cos(uv.x * 33.0 - uTime * 7.0)
      ) * 0.0035;

      vec2 dir = (uv - 0.5) * uAberration * (0.4 + r * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;

      // Zoom blur toward the centre while boosting.
      if (uZoom > 0.001) {
        vec3 acc = vec3(0.0);
        for (int i = 1; i <= 8; i++) {
          float k = (float(i) + jitter) / 8.0;
          acc += texture2D(tDiffuse, mix(uv, vec2(0.5), k * uZoom * 0.12)).rgb;
        }
        col = mix(col, acc / 8.0, clamp(uZoom * r * 1.6, 0.0, 0.85));
      }

      // Crepuscular rays: march toward the sun, accumulating bright samples.
      if (uRays > 0.001) {
        vec2 toSun = (uSun - uv) / 12.0;
        vec2 p = uv + toSun * jitter;
        float decay = 1.0;
        vec3 rays = vec3(0.0);
        for (int i = 0; i < 12; i++) {
          vec3 s = texture2D(tDiffuse, p).rgb;
          // Only the photosphere emits shafts: mask samples to the sun's disc,
          // so anything drawn in front of it (hazards, the probe, the canopy)
          // casts a shadow ray instead of glowing on its own.
          vec2 fromSun = (p - uSun) * vec2(uAspect, 1.0);
          float disc = smoothstep(0.22, 0.04, length(fromSun));
          float l = max(dot(s, vec3(0.3, 0.5, 0.2)) - 1.0, 0.0) * disc;
          rays += s * l * decay;
          decay *= 0.92;
          p += toSun;
        }
        col += rays * uRays * 0.04;
      }

      float edge = smoothstep(0.35, 1.0, r);
      col = mix(col, vec3(1.4, 0.08, 0.04) * (0.6 + 0.4 * sin(uTime * 12.0)), uAlarm * edge * 0.5);
      col += vec3(0.25, 0.9, 1.0) * uShield * edge * 0.35;

      col *= 1.0 - smoothstep(0.35, 1.25, r * uVignette);
      col += vec3(1.0, 0.45, 0.25) * uFlash;
      col += (jitter - 0.5) * 0.01;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.6, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.lens = new ShaderPass(LensShader);
    this.composer.addPass(this.lens);
    this.composer.addPass(new OutputPass());
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.lens.uniforms.uAspect.value = w / h;
  }

  update(time, p) {
    const u = this.lens.uniforms;
    u.uTime.value = time;
    u.uAberration.value = p.aberration;
    u.uShimmer.value = p.shimmer;
    u.uFlash.value = p.flash;
    u.uRays.value = p.rays;
    u.uSun.value.copy(p.sun);
    u.uZoom.value = p.zoom;
    u.uAlarm.value = p.alarm;
    u.uShield.value = p.shield;
    this.bloom.strength = p.bloom;
  }

  render(dt) {
    this.composer.render(dt);
  }
}
