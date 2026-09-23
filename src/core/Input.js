import { WORLD } from '../config.js';
import { clamp } from './math.js';

// Maps mouse, touch and keyboard to a steering target on the tunnel's
// cross-section disc. Mouse steers absolutely (cursor position = probe
// position); touch steers relatively so the finger never covers the probe.
export class Input {
  constructor(el) {
    this.el = el;
    this.tx = 0;
    this.ty = 0;
    this.keys = new Set();
    this.touchId = null;
    this.last = null;
    this.onPause = null;

    el.addEventListener('pointermove', (e) => this.pointer(e));
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') {
        this.touchId = e.pointerId;
        this.last = [e.clientX, e.clientY];
      }
      this.pointer(e);
    });
    const end = (e) => { if (e.pointerId === this.touchId) { this.touchId = null; this.last = null; } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'p') { this.onPause?.(); return; }
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  pointer(e) {
    const R = WORLD.moveRadius;
    const rect = this.el.getBoundingClientRect();
    if (e.pointerType === 'mouse') {
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const aspect = rect.width / rect.height;
      this.tx = clamp(nx * R * 1.25 * Math.min(aspect, 1.6), -R, R);
      this.ty = clamp(ny * R * 1.25, -R, R);
    } else if (e.pointerId === this.touchId && this.last) {
      const s = (R * 2.6) / Math.min(rect.width, rect.height);
      this.tx += (e.clientX - this.last[0]) * s;
      this.ty -= (e.clientY - this.last[1]) * s;
      this.last = [e.clientX, e.clientY];
    }
    this.clampTarget();
  }

  update(dt) {
    const v = WORLD.moveRadius * 1.6 * dt;
    const k = this.keys;
    if (k.has('arrowleft') || k.has('a')) this.tx -= v;
    if (k.has('arrowright') || k.has('d')) this.tx += v;
    if (k.has('arrowup') || k.has('w')) this.ty += v;
    if (k.has('arrowdown') || k.has('s')) this.ty -= v;
    this.clampTarget();
  }

  clampTarget() {
    const R = WORLD.moveRadius;
    const r = Math.hypot(this.tx, this.ty);
    if (r > R) { this.tx *= R / r; this.ty *= R / r; }
  }

  reset() { this.tx = 0; this.ty = 0; }
}
