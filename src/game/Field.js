import {
  AdditiveBlending, CylinderGeometry, Group, IcosahedronGeometry, Mesh,
  MeshStandardMaterial, OctahedronGeometry, SphereGeometry, Sprite, SpriteMaterial,
  TorusGeometry,
} from 'three';
import { WORLD } from '../config.js';
import { bendOffset } from '../core/bend.js';
import { distToSegment, rand, weighted, wrapAngle } from '../core/math.js';
import { createPlasmaMaterial } from '../fx/plasmaMaterial.js';
import { glowTexture } from './Probe.js';

const TUBE = 0.32;

// Everything the probe flies through: coronal hazards and coolant cells.
// Objects live in straight simulation space (x, y, z); rendering adds the bend.
export class Field {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.items = [];
    this.nextWave = 60;

    this.mats = {
      arc: createPlasmaMaterial({ displace: 0.06, hue: 0.5, gain: 1.5, scale: 2.2 }),
      filament: createPlasmaMaterial({ displace: 0.05, hue: 0.56, gain: 1.7, scale: 2.8 }),
      plasmoid: createPlasmaMaterial({ displace: 0.32, hue: 0.42, gain: 1.4, scale: 0.9 }),
    };
    this.geo = {
      cap: new SphereGeometry(TUBE * 1.5, 16, 12),
      filament: new CylinderGeometry(TUBE, TUBE, 1, 12, 24, true),
      plasmoid: new IcosahedronGeometry(1, 12),
      crystal: new OctahedronGeometry(0.42, 0),
    };
    this.crystalMat = new MeshStandardMaterial({
      color: '#0b2a33', emissive: '#5cf2ff', emissiveIntensity: 3.2, roughness: 0.2, metalness: 0.3, flatShading: true,
    });
    this.haloMat = new SpriteMaterial({
      map: glowTexture([[0, 'rgba(200,255,255,0.9)'], [0.3, 'rgba(92,242,255,0.35)'], [1, 'rgba(92,242,255,0)']]),
      blending: AdditiveBlending, depthWrite: false,
    });
  }

  reset(firstWaveAt) {
    for (const it of this.items) this.dispose(it);
    this.items.length = 0;
    this.nextWave = firstWaveAt;
  }

  dispose(it) {
    this.scene.remove(it.obj);
    if (it.ownGeo) it.ownGeo.dispose();
  }

  // --- spawning -----------------------------------------------------------

  spawnWave(difficulty) {
    const kind = weighted([
      ['arc', 3],
      ['filament', 2.6],
      ['plasmoid', 2],
      ['cross', 0.6 + 2.2 * difficulty],
      ['gauntlet', 0.2 + 1.8 * difficulty],
    ]);
    const z = WORLD.spawnZ;
    switch (kind) {
      case 'arc': this.addArc(z); break;
      case 'filament': this.addFilament(z, rand(0, Math.PI * 2), rand(0, 3.6)); break;
      case 'plasmoid': this.addPlasmoid(z); break;
      case 'cross': {
        const a = rand(0, Math.PI * 2);
        this.addFilament(z, a, rand(0.5, 2.2));
        this.addFilament(z, a + Math.PI / 2 + rand(-0.4, 0.4), rand(0.5, 2.2));
        break;
      }
      case 'gauntlet': {
        this.addPlasmoid(z);
        this.addArc(z - 14);
        break;
      }
    }
    if (Math.random() < 0.34 - 0.1 * difficulty) {
      const a = rand(0, Math.PI * 2), r = rand(0.5, WORLD.moveRadius - 0.3);
      this.addCrystal(z + rand(10, 16), Math.cos(a) * r, Math.sin(a) * r);
    }
  }

  addArc(z) {
    const radius = rand(2.2, 4.8);
    const arc = rand(Math.PI * 1.15, Math.PI * 1.62);
    const phi = rand(0, Math.PI * 2);
    const geo = new TorusGeometry(radius, TUBE, 12, 96, arc);
    const obj = new Group();
    obj.add(new Mesh(geo, this.mats.arc));
    for (const a of [0, arc]) {
      const cap = new Mesh(this.geo.cap, this.mats.arc);
      cap.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      obj.add(cap);
    }
    obj.rotation.z = phi;
    this.push({
      kind: 'arc', obj, ownGeo: geo, z, half: TUBE * 1.5,
      // Distance from (x, y) to the loop's surface.
      dist: (x, y) => {
        const ang = wrapAngle(Math.atan2(y, x) - phi);
        if (ang <= arc) return Math.abs(Math.hypot(x, y) - radius) - TUBE;
        const e0 = Math.hypot(x - Math.cos(phi) * radius, y - Math.sin(phi) * radius);
        const e1 = Math.hypot(x - Math.cos(phi + arc) * radius, y - Math.sin(phi + arc) * radius);
        return Math.min(e0, e1) - TUBE * 1.5;
      },
    });
    // Reward threading the gap with a coolant cell.
    if (Math.random() < 0.3) {
      const gapMid = phi + arc + (Math.PI * 2 - arc) / 2;
      this.addCrystal(z, Math.cos(gapMid) * radius, Math.sin(gapMid) * radius);
    }
  }

  addFilament(z, psi, offset) {
    const R = WORLD.tunnelRadius;
    const half = Math.sqrt(R * R - offset * offset);
    const nx = Math.cos(psi), ny = Math.sin(psi);
    const cx = nx * offset, cy = ny * offset;
    const dx = -ny, dy = nx;
    const mesh = new Mesh(this.geo.filament, this.mats.filament);
    mesh.scale.y = half * 2;
    mesh.rotation.z = psi; // cylinder's axis (+y) rotated onto (−sinψ, cosψ)
    const obj = new Group();
    obj.add(mesh);
    mesh.position.set(cx, cy, 0);
    const ax = cx - dx * half, ay = cy - dy * half, bx = cx + dx * half, by = cy + dy * half;
    this.push({
      kind: 'filament', obj, z, half: TUBE,
      dist: (x, y) => distToSegment(x, y, ax, ay, bx, by) - TUBE,
    });
  }

  addPlasmoid(z) {
    const r = rand(1.0, 1.8);
    const a = rand(0, Math.PI * 2), d = rand(0, 3.6);
    const px = Math.cos(a) * d, py = Math.sin(a) * d;
    const mesh = new Mesh(this.geo.plasmoid, this.mats.plasmoid);
    mesh.scale.setScalar(r);
    const obj = new Group();
    obj.add(mesh);
    mesh.position.set(px, py, 0);
    const item = {
      kind: 'plasmoid', obj, z, half: r, spin: rand(-1, 1),
      dist: (x, y) => Math.hypot(x - mesh.position.x, y - mesh.position.y) - r * 1.05,
      drift: [rand(-0.6, 0.6), rand(-0.6, 0.6)],
      mesh,
    };
    this.push(item);
  }

  addCrystal(z, x, y) {
    const obj = new Group();
    const mesh = new Mesh(this.geo.crystal, this.crystalMat);
    const halo = new Sprite(this.haloMat);
    halo.scale.setScalar(2.2);
    obj.add(mesh, halo);
    mesh.position.set(x, y, 0);
    halo.position.set(x, y, 0);
    this.push({ kind: 'crystal', obj, z, half: 0.5, x, y, mesh });
  }

  push(item) {
    item.checked = false;
    this.scene.add(item.obj);
    this.items.push(item);
  }

  // --- simulation -----------------------------------------------------------

  update(dt, time, speed, travel, difficulty, probe, live) {
    for (const m of Object.values(this.mats)) m.uniforms.uTime.value = time;

    if (travel >= this.nextWave) {
      this.spawnWave(difficulty);
      this.nextWave = travel + 34 - 16 * difficulty;
    }

    const dz = speed * dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const prevZ = it.z;
      it.z += dz;

      if (it.kind === 'plasmoid') {
        it.mesh.position.x += it.drift[0] * dt;
        it.mesh.position.y += it.drift[1] * dt;
        it.mesh.rotation.x += it.spin * dt;
        it.mesh.rotation.y += it.spin * 0.7 * dt;
      } else if (it.kind === 'crystal') {
        it.mesh.rotation.y += dt * 2.4;
        it.mesh.rotation.x += dt * 1.1;
      }

      const [ox, oy] = bendOffset(it.z);
      it.obj.position.set(ox, oy, it.z);

      // Resolve each object once, as it crosses the probe's plane.
      const plane = -it.half - 0.2;
      if (live && !it.checked && prevZ < plane && it.z >= plane) {
        it.checked = true;
        this.resolve(it, probe);
      }

      if (it.z > WORLD.despawnZ) {
        this.dispose(it);
        this.items.splice(i, 1);
      }
    }
  }

  resolve(it, probe) {
    if (it.kind === 'crystal') {
      if (Math.hypot(probe.x - it.x, probe.y - it.y) < 1.05) {
        it.obj.visible = false;
        this.events.onCollect(it);
      }
      return;
    }
    const d = it.dist(probe.x, probe.y);
    if (d < WORLD.probeRadius) this.events.onHit(it);
    else if (d < WORLD.probeRadius + WORLD.nearMissMargin) this.events.onGraze(it);
  }
}
