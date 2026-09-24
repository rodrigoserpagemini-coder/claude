import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial,
} from 'three';
import { bendGLSL, bendUniform } from '../core/bend.js';

const tmp = new Color();

// Pooled CPU particle system for thruster exhaust, grazes, pickups and the
// final shield breach. One draw call; a ring buffer recycles the oldest slot.
export class Sparks {
  constructor(scene, capacity = 2400) {
    this.cap = capacity;
    this.head = 0;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    this.size = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);

    const geo = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.colAttr = new BufferAttribute(this.col, 3);
    this.sizeAttr = new BufferAttribute(this.size, 1);
    this.alphaAttr = new BufferAttribute(this.alpha, 1);
    for (const a of [this.posAttr, this.colAttr, this.sizeAttr, this.alphaAttr]) a.setUsage(35048); // DynamicDrawUsage
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);

    this.points = new Points(geo, new ShaderMaterial({
      uniforms: { uBend: bendUniform, uScale: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        ${bendGLSL}
        attribute vec3 color;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vCol;
        varying float vA;
        void main() {
          vCol = color;
          vec4 mv = viewMatrix * vec4(applyBend(position), 1.0);
          // Particles spawned at the probe would fill the view from the cockpit.
          vA = aAlpha * smoothstep(0.8, 2.5, -mv.z);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float f = exp(-dot(d, d) * 14.0);
          gl_FragColor = vec4(vCol * f * vA, 1.0);
        }
      `,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, color, life, size, drag = 1.5, intensity = 1) {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    tmp.set(color);
    this.col[j] = tmp.r * intensity; this.col[j + 1] = tmp.g * intensity; this.col[j + 2] = tmp.b * intensity;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.drag[i] = drag;
  }

  burst(x, y, z, count, { color = '#ffb347', speed = 8, life = 0.9, size = 40, spread = 1, drag = 2.2, boost = 1 } = {}) {
    for (let n = 0; n < count; n++) {
      // Uniform direction on a sphere, flattened by `spread` along z.
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * (0.35 + Math.random() * 0.65);
      this.emit(x, y, z, Math.cos(t) * s * v, Math.sin(t) * s * v, u * v * spread,
        color, life * (0.5 + Math.random() * 0.5), size * (0.5 + Math.random()), drag, boost);
    }
  }

  update(dt, worldSpeed) {
    const { pos, vel, life, maxLife, drag, alpha } = this;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) { alpha[i] = 0; continue; }
      life[i] -= dt;
      const j = i * 3;
      const k = Math.exp(-drag[i] * dt);
      vel[j] *= k; vel[j + 1] *= k; vel[j + 2] *= k;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += (vel[j + 2] + worldSpeed) * dt;
      const t = Math.max(life[i], 0) / maxLife[i];
      alpha[i] = t * t;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
