import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group,
  Mesh, MeshStandardMaterial, PointLight, SphereGeometry, Sprite, SpriteMaterial,
  TorusGeometry,
} from 'three';
import { WORLD } from '../config.js';
import { clamp, damp } from '../core/math.js';

export function glowTexture(stops = [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

const SHIELD_COOL = new Color('#ff5a1f');
const SHIELD_HOT = new Color('#fff1c9');

// A small solar probe modelled on the Parker Solar Probe layout: a hexagonal
// carbon heat shield facing the Sun, the bus tucked behind it, solar arrays
// folded into the shield's shadow and cyan ion-thruster glows at the back.
export class Probe {
  constructor(scene) {
    this.group = new Group();
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.visible = true;

    const shieldMat = new MeshStandardMaterial({ color: '#d9d2c3', roughness: 0.55, metalness: 0.15 });
    const busMat = new MeshStandardMaterial({ color: '#2a2e36', roughness: 0.32, metalness: 0.85 });
    const goldMat = new MeshStandardMaterial({ color: '#c8932e', roughness: 0.28, metalness: 1.0 });
    const panelMat = new MeshStandardMaterial({ color: '#16223d', roughness: 0.25, metalness: 0.7, emissive: '#0a1a3a', emissiveIntensity: 0.6 });
    this.rimMat = new MeshStandardMaterial({ color: '#000000', emissive: SHIELD_COOL.clone(), emissiveIntensity: 2.2 });

    const shield = new Mesh(new CylinderGeometry(0.95, 0.95, 0.12, 6), shieldMat);
    shield.rotation.x = Math.PI / 2;
    shield.rotation.y = Math.PI / 6;
    shield.position.z = -0.75;
    const rim = new Mesh(new TorusGeometry(0.97, 0.035, 6, 6), this.rimMat);
    rim.position.z = -0.72;
    rim.rotation.z = Math.PI / 6 + Math.PI / 2;

    const truss = new Mesh(new CylinderGeometry(0.12, 0.28, 0.5, 6), goldMat);
    truss.rotation.x = Math.PI / 2;
    truss.position.z = -0.42;

    const bus = new Mesh(new CylinderGeometry(0.34, 0.42, 0.9, 6), busMat);
    bus.rotation.x = Math.PI / 2;
    bus.position.z = 0.15;
    const foil = new Mesh(new CylinderGeometry(0.43, 0.43, 0.2, 6), goldMat);
    foil.rotation.x = Math.PI / 2;
    foil.position.z = 0.35;

    const panelGeo = new BoxGeometry(0.72, 0.03, 0.34);
    for (const s of [-1, 1]) {
      const p = new Mesh(panelGeo, panelMat);
      p.position.set(s * 0.72, 0, 0.05);
      p.rotation.z = s * 0.35;
      this.group.add(p);
    }

    const mast = new Mesh(new CylinderGeometry(0.015, 0.015, 0.9, 4), goldMat);
    mast.position.set(0, 0.6, 0.35);
    this.group.add(mast);

    this.group.add(shield, rim, truss, bus, foil);

    // Ion thruster glows.
    const thrusterTex = glowTexture([[0, 'rgba(210,255,255,1)'], [0.2, 'rgba(92,242,255,0.8)'], [1, 'rgba(92,242,255,0)']]);
    this.thrusters = [];
    for (const s of [-1, 1]) {
      const core = new Mesh(new SphereGeometry(0.07, 10, 8), new MeshStandardMaterial({ color: '#000', emissive: '#7ff6ff', emissiveIntensity: 2.5 }));
      core.position.set(s * 0.22, -0.1, 0.62);
      const glow = new Sprite(new SpriteMaterial({ map: thrusterTex, blending: AdditiveBlending, depthWrite: false, color: '#8cf7ff' }));
      glow.scale.setScalar(0.7);
      glow.position.copy(core.position);
      this.group.add(core, glow);
      this.thrusters.push(glow);
    }

    // Warm fill so the probe picks up the corridor's glow.
    this.fill = new PointLight('#ff7a2e', 30, 9, 1.6);
    this.fill.position.set(0, 1.2, -2.5);
    this.group.add(this.fill);

    scene.add(this.group);
  }

  // Steer toward a target on the cross-section disc.
  update(dt, tx, ty, time, heat, invulnerable) {
    const r = Math.hypot(tx, ty);
    if (r > WORLD.moveRadius) { tx *= WORLD.moveRadius / r; ty *= WORLD.moveRadius / r; }
    const nx = damp(this.x, tx, 7.5, dt);
    const ny = damp(this.y, ty, 7.5, dt);
    this.vx = (nx - this.x) / Math.max(dt, 1e-4);
    this.vy = (ny - this.y) / Math.max(dt, 1e-4);
    this.x = nx; this.y = ny;

    const g = this.group;
    g.position.set(this.x, this.y + Math.sin(time * 2.1) * 0.04, 0);
    g.rotation.z = damp(g.rotation.z, clamp(-this.vx * 0.07, -0.9, 0.9), 8, dt);
    g.rotation.x = damp(g.rotation.x, clamp(this.vy * 0.04, -0.5, 0.5), 8, dt);
    g.rotation.y = damp(g.rotation.y, clamp(-this.vx * 0.02, -0.3, 0.3), 8, dt);

    this.rimMat.emissive.copy(SHIELD_COOL).lerp(SHIELD_HOT, heat);
    this.rimMat.emissiveIntensity = 0.9 + heat * 2.6;
    const flick = 0.85 + Math.sin(time * 40) * 0.08 + Math.random() * 0.07;
    for (const t of this.thrusters) t.scale.setScalar(0.42 * flick);

    // Blink while recovering from a hit.
    g.visible = this.visible && (!invulnerable || Math.sin(time * 38) > -0.2);
  }

  reset() {
    this.x = this.y = this.vx = this.vy = 0;
    this.group.rotation.set(0, 0, 0);
    this.visible = true;
  }
}
