import {
  AdditiveBlending, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh,
  MeshStandardMaterial, OctahedronGeometry, SphereGeometry, Sprite, SpriteMaterial,
  TorusGeometry,
} from 'three';
import { WORLD } from '../config.js';
import { bendOffset } from '../core/bend.js';
import { distToSegment, rand, weighted, wrapAngle } from '../core/math.js';
import { createGlowMaterial, createPlasmaMaterial } from '../fx/plasmaMaterial.js';
import { glowTexture } from './Probe.js';

const TUBE = 0.32;

// Wave mixes per zone (wind, outer, inner, chromo). Later zones are denser
// and introduce their own hazards: double loops in the inner corona and
// spicule clusters in the chromosphere.
const MIX = [
  { filament: 3.2, plasmoid: 2.2, arc: 0.8, cross: 0.4 },
  { arc: 3, filament: 2.4, plasmoid: 2, cross: 1.2, gauntlet: 0.6 },
  { arc: 2.4, doubleArc: 2.2, filament: 1.2, plasmoid: 1.4, cross: 1.4, gauntlet: 1.4 },
  { spicules: 3.4, plasmoid: 1.8, arc: 1.2, doubleArc: 1, cross: 1 },
];
const SPACING = [36, 30, 25, 22];

// Everything the probe flies through: coronal hazards and pickups.
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
      spicule: createPlasmaMaterial({ displace: 0.04, hue: 0.4, gain: 1.6, scale: 3.0 }),
    };
    this.glow = {
      arc: createGlowMaterial({ hue: 0.5, gain: 0.9 }),
      plasmoid: createGlowMaterial({ hue: 0.45, gain: 0.8, power: 1.6 }),
      spicule: createGlowMaterial({ hue: 0.35, gain: 1.0 }),
    };
    this.mats.spicule.uniforms.uHue.value = 0.36;
    this.geo = {
      cap: new SphereGeometry(TUBE * 1.5, 16, 12),
      filament: new CylinderGeometry(TUBE, TUBE, 1, 12, 24, true),
      filamentGlow: new CylinderGeometry(TUBE * 2.6, TUBE * 2.6, 1, 12, 1, true),
      plasmoid: new IcosahedronGeometry(1, 12),
      plasmoidGlow: new IcosahedronGeometry(1.45, 3),
      spicule: new ConeGeometry(0.42, 1, 12, 8, true),
      spiculeGlow: new ConeGeometry(0.95, 1, 12, 1, true),
      crystal: new OctahedronGeometry(0.42, 0),
      cell: new CylinderGeometry(0.34, 0.34, 0.22, 6),
    };
    this.crystalMat = new MeshStandardMaterial({
      color: '#0b2a33', emissive: '#5cf2ff', emissiveIntensity: 3.2, roughness: 0.2, metalness: 0.3, flatShading: true,
    });
    this.cellMat = new MeshStandardMaterial({
      color: '#1d1233', emissive: '#b58cff', emissiveIntensity: 3.4, roughness: 0.25, metalness: 0.5, flatShading: true,
    });
    this.haloMat = new SpriteMaterial({
      map: glowTexture([[0, 'rgba(200,255,255,0.9)'], [0.3, 'rgba(92,242,255,0.35)'], [1, 'rgba(92,242,255,0)']]),
      blending: AdditiveBlending, depthWrite: false,
    });
    this.cellHaloMat = new SpriteMaterial({
      map: glowTexture([[0, 'rgba(240,225,255,0.9)'], [0.3, 'rgba(181,140,255,0.4)'], [1, 'rgba(181,140,255,0)']]),
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
    if (it.ownGeo) for (const g of it.ownGeo) g.dispose();
  }

  // --- spawning -----------------------------------------------------------

  spawnWave(zone, difficulty, storm) {
    const z = WORLD.spawnZ;
    if (storm) {
      // Coronal mass ejection: a barrage of plasmoids with one guaranteed lane.
      const lane = rand(0, Math.PI * 2);
      const count = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < count; i++) this.addPlasmoid(z - i * 6, lane + Math.PI * (0.45 + 1.1 * Math.random()));
      if (Math.random() < 0.25) this.addCell(z + 12, Math.cos(lane) * 3, Math.sin(lane) * 3);
      return;
    }
    const mix = Object.entries(MIX[zone]).map(([k, w]) => [k, w * (k === 'gauntlet' || k === 'cross' ? 0.6 + difficulty : 1)]);
    switch (weighted(mix)) {
      case 'arc': this.addArc(z); break;
      case 'doubleArc': {
        const r = rand(3.6, 4.6);
        const phi = rand(0, Math.PI * 2);
        this.addArc(z, r, phi, rand(Math.PI * 1.2, Math.PI * 1.5));
        this.addArc(z - 9, r - 1.8, phi + Math.PI + rand(-0.5, 0.5), rand(Math.PI * 1.2, Math.PI * 1.5));
        break;
      }
      case 'filament': this.addFilament(z, rand(0, Math.PI * 2), rand(0, 3.6)); break;
      case 'plasmoid': this.addPlasmoid(z); break;
      case 'cross': {
        const a = rand(0, Math.PI * 2);
        this.addFilament(z, a, rand(0.5, 2.2));
        this.addFilament(z, a + Math.PI / 2 + rand(-0.4, 0.4), rand(0.5, 2.2));
        break;
      }
      case 'gauntlet':
        this.addPlasmoid(z);
        this.addArc(z - 14);
        break;
      case 'spicules': this.addSpicules(z, difficulty); break;
    }
    const roll = Math.random();
    const a = rand(0, Math.PI * 2), r = rand(0.5, WORLD.moveRadius - 0.3);
    if (roll < 0.3 - 0.08 * difficulty) this.addCrystal(z + rand(10, 16), Math.cos(a) * r, Math.sin(a) * r);
    else if (roll > 0.9) this.addCell(z + rand(10, 16), Math.cos(a) * r, Math.sin(a) * r);
  }

  addArc(z, radius = rand(2.2, 4.8), phi = rand(0, Math.PI * 2), arc = rand(Math.PI * 1.15, Math.PI * 1.62)) {
    const geo = new TorusGeometry(radius, TUBE, 12, 96, arc);
    const glowGeo = new TorusGeometry(radius, TUBE * 2.8, 8, 48, arc);
    const obj = new Group();
    obj.add(new Mesh(geo, this.mats.arc), new Mesh(glowGeo, this.glow.arc));
    for (const a of [0, arc]) {
      const cap = new Mesh(this.geo.cap, this.mats.arc);
      cap.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      obj.add(cap);
    }
    obj.rotation.z = phi;
    this.push({
      kind: 'arc', obj, ownGeo: [geo, glowGeo], z, half: TUBE * 1.5,
      radar: { radius, phi, arc },
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
    const obj = new Group();
    for (const [g, m] of [[this.geo.filament, this.mats.filament], [this.geo.filamentGlow, this.glow.arc]]) {
      const mesh = new Mesh(g, m);
      mesh.scale.y = half * 2;
      mesh.rotation.z = psi; // cylinder's axis (+y) rotated onto (−sinψ, cosψ)
      mesh.position.set(cx, cy, 0);
      obj.add(mesh);
    }
    const ax = cx - dx * half, ay = cy - dy * half, bx = cx + dx * half, by = cy + dy * half;
    this.push({
      kind: 'filament', obj, z, half: TUBE,
      radar: { ax, ay, bx, by },
      dist: (x, y) => distToSegment(x, y, ax, ay, bx, by) - TUBE,
    });
  }

  addPlasmoid(z, angle = rand(0, Math.PI * 2)) {
    const r = rand(1.0, 1.8);
    const d = rand(0, 3.6);
    const mesh = new Mesh(this.geo.plasmoid, this.mats.plasmoid);
    const glow = new Mesh(this.geo.plasmoidGlow, this.glow.plasmoid);
    mesh.scale.setScalar(r);
    glow.scale.setScalar(r);
    const obj = new Group();
    obj.add(mesh, glow);
    mesh.position.set(Math.cos(angle) * d, Math.sin(angle) * d, 0);
    this.push({
      kind: 'plasmoid', obj, z, half: r, spin: rand(-1, 1), r,
      dist: (x, y) => Math.hypot(x - mesh.position.x, y - mesh.position.y) - r * 1.05,
      drift: [rand(-0.6, 0.6), rand(-0.6, 0.6)],
      mesh, glowMesh: glow,
    });
  }

  // Spicules: jets rising from the wall toward the axis, spread around the
  // circumference with at least one wide gap.
  addSpicules(z, difficulty) {
    const R = WORLD.tunnelRadius;
    const n = 3 + Math.round(rand(0, 2 + difficulty * 2));
    const start = rand(0, Math.PI * 2);
    const span = Math.PI * 2 * rand(0.62, 0.78); // leaves a gap of 80–135°
    const obj = new Group();
    const segs = [];
    for (let i = 0; i < n; i++) {
      const a = start + (span * i) / (n - 1);
      const len = rand(2.6, 4.6);
      const bx = Math.cos(a) * R, by = Math.sin(a) * R;
      const tx = Math.cos(a) * (R - len), ty = Math.sin(a) * (R - len);
      for (const [g, m] of [[this.geo.spicule, this.mats.spicule], [this.geo.spiculeGlow, this.glow.spicule]]) {
        const cone = new Mesh(g, m);
        cone.scale.y = len;
        // Cone points along +y; aim its tip at the axis.
        cone.rotation.z = a + Math.PI / 2;
        cone.position.set(Math.cos(a) * (R - len / 2), Math.sin(a) * (R - len / 2), 0);
        obj.add(cone);
      }
      segs.push([bx, by, tx, ty]);
    }
    this.push({
      kind: 'spicules', obj, z, half: 0.45,
      radar: { segs },
      dist: (x, y) => {
        let best = Infinity;
        for (const [ax, ay, bx, by] of segs) {
          const d = distToSegment(x, y, ax, ay, bx, by);
          // Cones taper: thicker at the wall, thin at the tip.
          const along = Math.min(1, Math.hypot(x - bx, y - by) / Math.hypot(ax - bx, ay - by));
          best = Math.min(best, d - (0.08 + 0.34 * along));
        }
        return best;
      },
    });
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

  addCell(z, x, y) {
    const obj = new Group();
    const mesh = new Mesh(this.geo.cell, this.cellMat);
    const halo = new Sprite(this.cellHaloMat);
    halo.scale.setScalar(2.4);
    obj.add(mesh, halo);
    mesh.position.set(x, y, 0);
    halo.position.set(x, y, 0);
    this.push({ kind: 'cell', obj, z, half: 0.5, x, y, mesh });
  }

  push(item) {
    item.checked = false;
    this.scene.add(item.obj);
    this.items.push(item);
  }

  // --- simulation -----------------------------------------------------------

  update(dt, time, speed, travel, zone, difficulty, storm, probe, live) {
    for (const m of Object.values(this.mats)) m.uniforms.uTime.value = time;

    if (travel >= this.nextWave) {
      this.spawnWave(zone, difficulty, storm);
      this.nextWave = travel + (storm ? 11 : SPACING[zone] - 8 * difficulty);
    }

    const dz = speed * dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const prevZ = it.z;
      it.z += dz;

      if (it.kind === 'plasmoid') {
        it.mesh.position.x += it.drift[0] * dt;
        it.mesh.position.y += it.drift[1] * dt;
        it.glowMesh.position.copy(it.mesh.position);
        it.mesh.rotation.x += it.spin * dt;
        it.mesh.rotation.y += it.spin * 0.7 * dt;
      } else if (it.kind === 'crystal') {
        it.mesh.rotation.y += dt * 2.4;
        it.mesh.rotation.x += dt * 1.1;
      } else if (it.kind === 'cell') {
        it.mesh.rotation.x = Math.PI / 2;
        it.mesh.rotation.z += dt * 3;
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
    if (it.kind === 'crystal' || it.kind === 'cell') {
      if (Math.hypot(probe.x - it.x, probe.y - it.y) < 1.1) {
        it.obj.visible = false;
        if (it.kind === 'crystal') this.events.onCollect(it);
        else this.events.onEnergy(it);
      }
      return;
    }
    const d = it.dist(probe.x, probe.y);
    if (d < WORLD.probeRadius) this.events.onHit(it);
    else if (d < WORLD.probeRadius + WORLD.nearMissMargin) this.events.onGraze(it);
  }

  // Closest hazard ahead within `range`, for the proximity warning.
  nearestThreat(probe, range) {
    let best = null;
    for (const it of this.items) {
      if (it.checked || !it.dist || it.z > 0 || it.z < -range) continue;
      if (it.dist(probe.x, probe.y) < WORLD.probeRadius + 0.2 && (!best || it.z > best.z)) best = it;
    }
    return best;
  }
}
