import { Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Heat shimmer, chromatic aberration, vignette and grain, applied in linear HDR
// before tone mapping so the bloom and the fringing share the same highlights.
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.002 },
    uShimmer: { value: 0 },
    uVignette: { value: 1.1 },
    uFlash: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uShimmer, uVignette, uFlash, uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      c.x *= uAspect;
      float r = length(c);

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

      col *= 1.0 - smoothstep(0.35, 1.25, r * uVignette);
      col += vec3(1.0, 0.45, 0.25) * uFlash;
      col += (hash(uv * 900.0 + fract(uTime)) - 0.5) * 0.035;
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
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.lens.uniforms.uAspect.value = w / h;
  }

  update(time, { aberration, shimmer, flash, bloom }) {
    const u = this.lens.uniforms;
    u.uTime.value = time;
    u.uAberration.value = aberration;
    u.uShimmer.value = shimmer;
    u.uFlash.value = flash;
    this.bloom.strength = bloom;
  }

  render(dt) {
    this.composer.render(dt);
  }
}
