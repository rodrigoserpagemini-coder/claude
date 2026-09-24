import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group,
  IcosahedronGeometry, Mesh, MeshStandardMaterial, PointLight, ShaderMaterial,
  SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, TorusGeometry, Vector3,
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

// Solar array texture: dark cells separated by silver bus bars.
function panelTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#9aa3ad';
  g.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const grad = g.createLinearGradient(0, y * 32, 0, y * 32 + 30);
      grad.addColorStop(0, '#1d2f5c');
      grad.addColorStop(1, '#0c1530');
      g.fillStyle = grad;
      g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
      g.fillStyle = 'rgba(160,190,255,0.12)';
      for (let k = 0; k < 4; k++) g.fillRect(x * 32 + 2, y * 32 + 6 + k * 7, 28, 1);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// Carbon-composite heat shield face: fine woven noise with a white coating.
function shieldTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e4ddce';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const px = (i / 4) % 256, py = Math.floor(i / 4 / 256);
    const weave = ((px >> 2) + (py >> 2)) % 2 ? 6 : -6;
    const n = (Math.random() - 0.5) * 18 + weave;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const SHIELD_COOL = new Color('#ff5a1f');
const SHIELD_HOT = new Color('#fff1c9');

// A small solar probe modelled on the Parker Solar Probe layout: a hexagonal
// carbon heat shield facing the Sun, the bus tucked behind it, solar arrays
// folded into the shield's shadow, four FIELDS antennas poking past the
// shield's rim (their tips glow red-hot), the magnetometer boom trailing
// behind and cyan ion-thruster glows.
export class Probe {
  constructor(scene) {
    this.group = new Group();
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.visible = true;

    const shieldMat = new MeshStandardMaterial({ map: shieldTexture(), roughness: 0.6, metalness: 0.1 });
    const busMat = new MeshStandardMaterial({ color: '#2a2e36', roughness: 0.32, metalness: 0.85 });
    const goldMat = new MeshStandardMaterial({ color: '#c8932e', roughness: 0.28, metalness: 1.0 });
    const steelMat = new MeshStandardMaterial({ color: '#8e949c', roughness: 0.35, metalness: 0.9 });
    const panelMat = new MeshStandardMaterial({ map: panelTexture(), roughness: 0.22, metalness: 0.6, emissive: '#0a1a3a', emissiveIntensity: 0.4 });
    this.rimMat = new MeshStandardMaterial({ color: '#000000', emissive: SHIELD_COOL.clone(), emissiveIntensity: 1.2 });
    this.tipMat = new MeshStandardMaterial({ color: '#000000', emissive: '#ff4a1a', emissiveIntensity: 3 });

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

    // Solar arrays with radiator fins above them.
    const panelGeo = new BoxGeometry(0.78, 0.03, 0.36);
    const finGeo = new BoxGeometry(0.5, 0.02, 0.26);
    for (const s of [-1, 1]) {
      const p = new Mesh(panelGeo, panelMat);
      p.position.set(s * 0.74, 0, 0.05);
      p.rotation.z = s * 0.35;
      const fin = new Mesh(finGeo, steelMat);
      fin.position.set(s * 0.3, 0.42, 0.2);
      fin.rotation.z = s * 0.5;
      this.group.add(p, fin);
    }

    // FIELDS antennas: four whips reaching past the shield edge.
    const whipGeo = new CylinderGeometry(0.008, 0.008, 1.0, 4);
    const tipGeo = new SphereGeometry(0.03, 8, 6);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const whip = new Mesh(whipGeo, steelMat);
      const ox = Math.cos(a), oy = Math.sin(a);
      whip.position.set(ox * 0.78, oy * 0.78, -0.95);
      whip.lookAt(ox * 1.3, oy * 1.3, -1.6);
      whip.rotateX(Math.PI / 2);
      const dir = new Vector3(ox * 0.52, oy * 0.52, -0.65).normalize();
      const tip = new Mesh(tipGeo, this.tipMat);
      tip.position.set(ox * 0.78, oy * 0.78, -0.95).addScaledVector(dir, 0.5);
      this.group.add(whip, tip);
    }

    // Magnetometer boom trailing behind the bus.
    const boom = new Mesh(new CylinderGeometry(0.012, 0.012, 1.4, 5), steelMat);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.32, 0.95);
    const mag = new Mesh(new BoxGeometry(0.07, 0.07, 0.1), goldMat);
    mag.position.set(0, 0.32, 1.62);
    const mast = new Mesh(new CylinderGeometry(0.015, 0.015, 0.9, 4), goldMat);
    mast.position.set(0, 0.6, 0.35);
    this.group.add(boom, mag, mast, shield, rim, truss, bus, foil);

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

    // Magnetic shield bubble: hexagonal field lines on a fresnel sphere.
    this.bubbleUniforms = { uTime: { value: 0 }, uAlpha: { value: 0 } };
    this.bubble = new Mesh(new IcosahedronGeometry(1.55, 4), new ShaderMaterial({
      uniforms: this.bubbleUniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vView; varying vec3 vP;
        void main() {
          vP = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlpha;
        varying vec3 vN; varying vec3 vView; varying vec3 vP;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.5);
          float lat = abs(sin(vP.y * 9.0 + uTime * 3.0));
          float lon = abs(sin(atan(vP.x, vP.z) * 6.0 - uTime * 2.0));
          float lines = pow(1.0 - min(lat, lon), 14.0);
          vec3 c = vec3(0.35, 0.95, 1.0) * (rim * 1.6 + lines * 0.5);
          gl_FragColor = vec4(c * uAlpha, 1.0);
        }
      `,
    }));
    this.bubble.visible = false;
    this.group.add(this.bubble);

    // Warm fill so the probe picks up the corridor's glow.
    this.fill = new PointLight('#ff7a2e', 30, 9, 1.6);
    this.fill.position.set(0, 1.2, -2.5);
    this.group.add(this.fill);

    scene.add(this.group);
  }

  // Steer toward a target on the cross-section disc.
  update(dt, tx, ty, time, heat, invulnerable, shield, showModel) {
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
    this.tipMat.emissiveIntensity = 2 + heat * 5 + Math.sin(time * 9) * 0.4;
    const flick = 0.85 + Math.sin(time * 40) * 0.08 + Math.random() * 0.07;
    for (const t of this.thrusters) t.scale.setScalar(0.42 * flick);

    this.bubbleUniforms.uTime.value = time;
    this.bubbleUniforms.uAlpha.value = damp(this.bubbleUniforms.uAlpha.value, shield ? 1 : 0, 10, dt);
    this.bubble.visible = this.bubbleUniforms.uAlpha.value > 0.01 && showModel;
    // From the cockpit the fill light would sit inside the cabin; it has its own lights.
    this.fill.intensity = showModel ? 30 : 0;

    // Blink while recovering from a hit; hidden entirely from the cockpit.
    g.visible = this.visible && (!invulnerable || Math.sin(time * 38) > -0.2);
    for (const child of g.children) {
      if (child !== this.fill && child !== this.bubble) child.visible = showModel;
    }
  }

  reset() {
    this.x = this.y = this.vx = this.vy = 0;
    this.group.rotation.set(0, 0, 0);
    this.visible = true;
  }
}
