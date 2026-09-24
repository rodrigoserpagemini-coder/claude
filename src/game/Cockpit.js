import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, ShaderMaterial,
  SRGBColorSpace, Vector2, Vector3,
} from 'three';
import { HEAT, PACE, ZONES } from '../config.js';
import { clamp, damp } from '../core/math.js';
import { noiseGLSL } from '../fx/noise.glsl.js';
import { drawRadar } from '../ui/Radar.js';

const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
const DISPLAY = "'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif";
const MAX_CRACKS = 6;
const tmpM = new Matrix4();
const tmpC = new Color();

function canvasTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return { canvas: c, ctx: c.getContext('2d'), tex: t };
}

// Panel face: brushed dark composite with seams, screws and the names of the
// Parker Solar Probe's instrument suites stencilled above their switches.
function dashboardTexture() {
  const { canvas, ctx, tex } = canvasTexture(1024, 256);
  ctx.fillStyle = '#17120f';
  ctx.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(255,240,220,${Math.random() * 0.035})`;
    ctx.fillRect(Math.random() * 1024, Math.random() * 256, Math.random() * 60, 1);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  for (const x of [170, 340, 684, 854]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,240,220,0.06)';
  ctx.lineWidth = 1;
  for (const x of [172, 342, 686, 856]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
  for (const [x, y] of [[14, 14], [1010, 14], [14, 242], [1010, 242], [184, 14], [840, 14]]) {
    ctx.fillStyle = '#3a3230'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0b0807'; ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.stroke();
  }
  ctx.font = `500 15px ${MONO}`;
  ctx.fillStyle = 'rgba(247,235,219,0.55)';
  ctx.textAlign = 'center';
  const labels = ['FIELDS', 'WISPR', 'SWEAP', 'ISʘIS'];
  labels.forEach((l, i) => ctx.fillText(l, 60 + i * 60 - (i > 1 ? 0 : 0), 186));
  ctx.fillText('TPS', 930, 186);
  ctx.fillText('RCS', 990, 186);
  ctx.fillStyle = 'rgba(255,106,26,0.7)';
  ctx.font = `600 13px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText('ÍCARO-1 · CABINE DE MERGULHO', 24, 36);
  // Hazard stripes along the bottom edge.
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 226, 1024, 30); ctx.clip();
  for (let x = -40; x < 1064; x += 28) {
    ctx.fillStyle = 'rgba(255,200,87,0.22)';
    ctx.beginPath(); ctx.moveTo(x, 256); ctx.lineTo(x + 14, 256); ctx.lineTo(x + 44, 226); ctx.lineTo(x + 30, 226); ctx.fill();
  }
  ctx.restore();
  return tex;
}

// First-person cabin: a hexagonal canopy frame with LED strips, a dashboard
// carrying three live displays (radar, telemetry, systems), a glass pane that
// chars with heat and cracks on impacts, a heads-up reticle with a
// flight-path marker, interior lighting and alarm beacons. Everything hangs
// off the camera and is laid out from the view frustum so it fits any
// aspect ratio.
export class Cockpit {
  constructor(camera) {
    this.camera = camera;
    this.root = new Group();
    this.root.visible = false;
    camera.add(this.root);
    this.frame = new Group();
    this.root.add(this.frame);

    this.mats = {
      strut: new MeshStandardMaterial({ color: '#1c1917', roughness: 0.45, metalness: 0.7 }),
      trim: new MeshStandardMaterial({ color: '#4a4038', roughness: 0.3, metalness: 0.9 }),
      led: new MeshStandardMaterial({ color: '#000000', emissive: '#ff7a2e', emissiveIntensity: 1.6 }),
      dash: new MeshStandardMaterial({ map: dashboardTexture(), roughness: 0.7, metalness: 0.3 }),
      body: new MeshStandardMaterial({ color: '#120e0c', roughness: 0.6, metalness: 0.5 }),
      bezel: new MeshStandardMaterial({ color: '#0a0808', roughness: 0.35, metalness: 0.6 }),
    };

    // Displays.
    this.screens = {
      radar: canvasTexture(320, 320),
      tele: canvasTexture(640, 320),
      sys: canvasTexture(320, 320),
    };
    this.screenMats = {};
    for (const [k, s] of Object.entries(this.screens)) {
      this.screenMats[k] = new MeshBasicMaterial({ map: s.tex, color: new Color(1.25, 1.25, 1.25) });
    }
    this.redrawIn = 0;
    this.history = new Array(80).fill(0);
    this.historyIn = 0;

    // Glass.
    this.cracks = [];
    this.glassUniforms = {
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uShield: { value: 0 },
      uAspect: { value: 1 },
      uMarker: { value: new Vector2() },
      uReticle: { value: 1 },
      uCracks: { value: Array.from({ length: MAX_CRACKS }, () => new Vector3()) },
      uFlash: { value: 0 },
    };
    this.glassMat = new ShaderMaterial({
      uniforms: this.glassUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        ${noiseGLSL}
        uniform float uTime, uHeat, uShield, uAspect, uReticle, uFlash;
        uniform vec2 uMarker;
        uniform vec3 uCracks[${MAX_CRACKS}];
        varying vec2 vUv;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          vec2 q = (vUv - 0.5) * 2.2;              // ≈ normalised screen coords
          vec2 qa = q * vec2(uAspect, 1.0);
          float edge = smoothstep(0.55, 1.15, length(q * vec2(0.85, 1.0)));

          // Soot and ablation from the corona, heavier as the shield heats.
          float soot = fbm3(vec3(q * 3.5, 1.7)) * 0.5 + 0.5;
          float dirt = edge * smoothstep(0.4, 0.85, soot) * (0.12 + uHeat * 0.35);
          vec3 col = vec3(0.05, 0.02, 0.015);
          float alpha = dirt * 0.85;

          // Sheen streak.
          float sheen = smoothstep(0.03, 0.0, abs(q.x * 0.5 + q.y - 0.9)) * 0.06;
          col += vec3(1.0, 0.8, 0.6) * sheen; alpha += sheen;

          // Impact cracks: radial fractures plus a couple of concentric rings.
          float crack = 0.0;
          for (int i = 0; i < ${MAX_CRACKS}; i++) {
            vec3 c = uCracks[i];
            if (c.z <= 0.0) continue;
            vec2 d = (q - c.xy) * vec2(uAspect, 1.0);
            float r = length(d);
            float ang = atan(d.y, d.x);
            float seed = float(i) * 7.13;
            float wob = snoise(vec3(d * 6.0, seed)) * 0.35;
            float radial = pow(abs(sin(ang * (4.0 + hash(seed) * 3.0) + seed + wob)), 90.0);
            radial *= smoothstep(0.42 * c.z, 0.0, r);
            float rings = smoothstep(0.006, 0.0, abs(r - 0.05 - wob * 0.02)) + 0.6 * smoothstep(0.005, 0.0, abs(r - 0.11 + wob * 0.03));
            rings *= step(0.2, fract(ang * 1.3 + seed));
            float star = smoothstep(0.03, 0.0, r) * 0.8;
            crack += (radial + rings + star) * c.z;
          }
          crack = clamp(crack, 0.0, 1.0);
          col = mix(col, vec3(0.92, 0.95, 1.0), crack);
          alpha = max(alpha, crack * 0.7);

          // Heads-up reticle and flight-path marker, drawn in amber.
          vec3 amber = vec3(1.0, 0.72, 0.3);
          float rr = length(qa);
          float ret = smoothstep(0.004, 0.0, abs(rr - 0.06)) * step(0.35, abs(fract(atan(qa.y, qa.x) / 1.5708) - 0.5) * 2.0);
          ret += smoothstep(0.003, 0.0, abs(qa.y)) * step(0.1, abs(qa.x)) * step(abs(qa.x), 0.16);
          vec2 m = (q - uMarker) * vec2(uAspect, 1.0);
          float mk = smoothstep(0.004, 0.0, abs(length(m) - 0.022));
          mk += smoothstep(0.003, 0.0, abs(m.y)) * step(0.022, abs(m.x)) * step(abs(m.x), 0.045);
          mk += smoothstep(0.003, 0.0, abs(m.x)) * step(0.022, m.y) * step(m.y, 0.04);
          float hud = (ret * 0.8 + mk) * uReticle;
          col = mix(col, amber * 1.4, clamp(hud, 0.0, 1.0));
          alpha = max(alpha, hud * 0.85);

          // Magnetic shield: cyan field shimmer at the edges of the pane.
          float fieldLines = pow(abs(sin(q.y * 30.0 + uTime * 6.0 + snoise(vec3(q * 2.0, uTime)) * 3.0)), 20.0);
          float sh = uShield * edge * (0.35 + 0.65 * fieldLines);
          col = mix(col, vec3(0.4, 0.95, 1.0) * 1.5, clamp(sh, 0.0, 1.0));
          alpha = max(alpha, sh * 0.6);

          col += vec3(1.0, 0.4, 0.2) * uFlash; alpha = max(alpha, uFlash * 0.3);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
        }
      `,
    });

    // Interior light, alarm beacon and shield light.
    this.cabinLight = new PointLight('#ffb27a', 0.35, 2.5, 1.5);
    this.alarmLight = new PointLight('#ff2a1a', 0, 2.2, 1.5);
    this.shieldLight = new PointLight('#5cf2ff', 0, 2.2, 1.5);
    this.root.add(this.cabinLight, this.alarmLight, this.shieldLight);

    this.shake = new Vector3();
    this.lag = new Vector2();
  }

  // Build geometry from the frustum at a reference depth.
  layout(aspect, fovDeg) {
    for (const child of [...this.frame.children]) {
      child.geometry?.dispose();
      this.frame.remove(child);
    }
    const D = 0.6;
    const hh = D * Math.tan((fovDeg * Math.PI) / 360);
    const hw = hh * aspect;
    const P = (u, v) => [u * hw, v * hh];
    this.glassUniforms.uAspect.value = aspect;
    this.dims = { hh, hw, D };

    const strut = (a, b, thick, z, mat) => {
      const [x1, y1] = a, [x2, y2] = b;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const m = new Mesh(new BoxGeometry(len, thick, 0.05), mat);
      m.position.set((x1 + x2) / 2, (y1 + y2) / 2, z);
      m.rotation.z = Math.atan2(y2 - y1, x2 - x1);
      this.frame.add(m);
      return m;
    };

    // Canopy: two slanted pillars, a top bow and two upper braces.
    const t = hh * 0.07;
    const zF = -D * 1.05;
    const frame = [
      [P(-1.02, -0.52), P(-0.66, 1.08)],
      [P(1.02, -0.52), P(0.66, 1.08)],
      [P(-0.72, 0.84), P(0.72, 0.84)],
      [P(-0.8, 0.25), P(-1.2, 0.35)],
      [P(0.8, 0.25), P(1.2, 0.35)],
    ];
    for (const [a, b] of frame) {
      strut(a, b, t, zF, this.mats.strut);
      // LED strip on the inner lip, a hair closer to the pilot.
      const inward = a[0] < 0 || b[0] < 0 ? 1 : -1;
      const off = t * 0.35;
      const vertical = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]);
      const shift = vertical ? [off * inward, 0] : [0, -off];
      strut([a[0] + shift[0], a[1] + shift[1]], [b[0] + shift[0], b[1] + shift[1]], t * 0.12, zF + 0.03, this.mats.led);
      strut([a[0] - shift[0], a[1] - shift[1]], [b[0] - shift[0], b[1] - shift[1]], t * 0.18, zF + 0.028, this.mats.trim);
    }

    // Dashboard body, face and glare shield.
    const dashTop = -0.5 * hh;
    const dashH = 0.62 * hh;
    const body = new Mesh(new BoxGeometry(hw * 2.4, dashH, 0.4), this.mats.body);
    body.position.set(0, dashTop - dashH / 2, -D - 0.201);
    const face = new Mesh(new PlaneGeometry(hw * 2.3, dashH), this.mats.dash);
    face.position.set(0, dashTop - dashH / 2, -D);
    const shelf = new Mesh(new BoxGeometry(hw * 2.4, 0.012, 0.42), this.mats.strut);
    shelf.position.set(0, dashTop + 0.004, -D - 0.2);
    this.frame.add(body, face, shelf);

    // Screens: radar | telemetry | systems, scaled to fit narrow views.
    const sH = 0.3 * hh;
    const sizes = { radar: [sH, sH], tele: [sH * 2, sH], sys: [sH, sH] };
    const gap = sH * 0.18;
    const total = sH * 4 + gap * 2;
    const scale = Math.min(1, (hw * 1.9) / total);
    const cy = dashTop - dashH * 0.42;
    let x = -total * scale / 2;
    for (const key of ['radar', 'tele', 'sys']) {
      const [w, h] = sizes[key].map((v) => v * scale);
      const bezel = new Mesh(new BoxGeometry(w * 1.08, h * 1.12, 0.02), this.mats.bezel);
      bezel.position.set(x + w / 2, cy, -D + 0.004);
      const screen = new Mesh(new PlaneGeometry(w, h), this.screenMats[key]);
      screen.position.set(x + w / 2, cy, -D + 0.016);
      this.frame.add(bezel, screen);
      x += w + gap * scale;
    }

    // Binnacle hood over the centre display.
    const hood = new Mesh(new CylinderGeometry(sH * scale * 1.15, sH * scale * 1.15, 0.12, 24, 1, true, -Math.PI / 2, Math.PI), this.mats.strut);
    hood.rotation.x = -Math.PI / 2; // open half-cylinder arching upward
    hood.scale.set(1.05, 1, 0.35);
    hood.position.set(0, dashTop - 0.002, -D - 0.06);
    this.frame.add(hood);

    // Switch banks and indicator LEDs along the lower dashboard.
    const count = 26;
    const switchGeo = new CylinderGeometry(hh * 0.008, hh * 0.008, hh * 0.05, 6);
    switchGeo.rotateX(Math.PI / 2 - 0.4);
    this.switches = new InstancedMesh(switchGeo, this.mats.trim, count);
    const ledGeo = new BoxGeometry(hh * 0.018, hh * 0.01, 0.004);
    this.leds = new InstancedMesh(ledGeo, new MeshBasicMaterial({ color: '#ffffff' }), count);
    const rowY = dashTop - dashH * 0.82;
    for (let i = 0; i < count; i++) {
      const side = i < count / 2 ? -1 : 1;
      const j = i % (count / 2);
      const sx = side * (hw * 0.55 + j * hw * 0.028) * Math.min(1, scale * 1.1);
      tmpM.makeTranslation(sx, rowY, -D + 0.02);
      this.switches.setMatrixAt(i, tmpM);
      tmpM.makeTranslation(sx, rowY + hh * 0.045, -D + 0.01);
      this.leds.setMatrixAt(i, tmpM);
      this.leds.setColorAt(i, tmpC.set(i % 5 === 0 ? '#ff3b3b' : i % 3 === 0 ? '#5cf2ff' : '#ffc857'));
    }
    this.frame.add(this.switches, this.leds);

    // Glass pane covering the whole view, just beyond the frame.
    const G = 1.3;
    const glass = new Mesh(new PlaneGeometry(hw * 2.2 * G, hh * 2.2 * G), this.glassMat);
    glass.position.set(0, 0, -D * G);
    glass.renderOrder = 10;
    this.frame.add(glass);

    this.cabinLight.position.set(0, hh * 0.2, -0.05);
    this.alarmLight.position.set(-hw * 0.6, hh * 0.7, -0.35);
    this.shieldLight.position.set(0, 0, -0.5);
  }

  setVisible(v) { this.root.visible = v; }

  crack() {
    const c = this.glassUniforms.uCracks.value;
    const slot = this.cracks.length < MAX_CRACKS ? this.cracks.length : Math.floor(Math.random() * MAX_CRACKS);
    c[slot].set((Math.random() - 0.5) * 1.4, Math.random() * 0.9 - 0.15, 0.7 + Math.random() * 0.3);
    if (this.cracks.length < MAX_CRACKS) this.cracks.push(slot);
    this.glassUniforms.uFlash.value = 0.6;
  }

  repair() {
    for (const c of this.glassUniforms.uCracks.value) c.set(0, 0, 0);
    this.cracks.length = 0;
  }

  // s: { dt, time, heat, energy, speed, radii, zone, sunlight, boosting, shield,
  //      storm, stormWarn, items, probe, target, accel, combo, score, cells, bend }
  update(s) {
    const u = this.glassUniforms;
    u.uTime.value = s.time;
    u.uHeat.value = s.heat / 100;
    u.uShield.value = damp(u.uShield.value, s.shield ? 1 : 0, 8, s.dt);
    u.uFlash.value = damp(u.uFlash.value, 0, 4, s.dt);
    // Flight-path marker: where the probe is steering, relative to the nose.
    const { hh, hw } = this.dims;
    u.uMarker.value.set(
      clamp((s.target[0] - s.probe.x) * 0.09 / (hw / hh), -0.8, 0.8),
      clamp((s.target[1] - s.probe.y) * 0.09 - 0.02, -0.5, 0.6),
    );

    // Cabin sways against acceleration.
    this.lag.x = damp(this.lag.x, clamp(-s.accel[0] * 0.0012, -0.02, 0.02), 6, s.dt);
    this.lag.y = damp(this.lag.y, clamp(-s.accel[1] * 0.0012, -0.02, 0.02), 6, s.dt);
    this.frame.position.set(this.lag.x, this.lag.y, 0);

    const critical = s.heat > 78;
    const blink = Math.sin(s.time * 12) > 0;
    this.alarmLight.intensity = critical || s.stormWarn ? (blink ? 1.1 : 0.1) : 0;
    this.shieldLight.intensity = u.uShield.value * 2.2;
    this.cabinLight.color.set(s.boosting ? '#ffd7a0' : '#ffb27a');
    this.mats.led.emissive.set(critical ? (blink ? '#ff2a1a' : '#401008') : s.shield ? '#5cf2ff' : '#ff7a2e');

    // Indicator LEDs flicker through a slow pseudo-random pattern.
    if (this.leds && Math.floor(s.time * 6) !== this.ledTick) {
      this.ledTick = Math.floor(s.time * 6);
      for (let i = 0; i < this.leds.count; i++) {
        const on = Math.sin(i * 12.9898 + this.ledTick * 0.7) > -0.2;
        tmpC.set(i % 5 === 0 ? (critical ? '#ff3b3b' : '#401010') : i % 3 === 0 ? '#5cf2ff' : '#ffc857');
        if (!on) tmpC.multiplyScalar(0.12);
        this.leds.setColorAt(i, tmpC);
      }
      this.leds.instanceColor.needsUpdate = true;
    }

    this.historyIn -= s.dt;
    if (this.historyIn <= 0) {
      this.historyIn = 0.25;
      this.history.push(s.heat);
      this.history.shift();
    }

    this.redrawIn -= s.dt;
    if (this.redrawIn <= 0) {
      this.redrawIn = 1 / 15;
      this.drawRadar(s);
      this.drawTelemetry(s);
      this.drawSystems(s);
    }
  }

  frameScreen(ctx, w, h, title, accent = '#ffc857') {
    ctx.fillStyle = '#080405';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, 'rgba(255,120,40,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.font = `500 15px ${MONO}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, 14, 12);
  }

  scanlines(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  }

  drawRadar(s) {
    const { ctx, tex, canvas } = this.screens.radar;
    const w = canvas.width, h = canvas.height;
    this.frameScreen(ctx, w, h, 'RADAR · 170 u');
    drawRadar(ctx, w / 2, h / 2 + 12, w * 0.4, s.items, s.probe, s.time, { background: 'rgba(20,8,6,0.9)' });
    this.scanlines(ctx, w, h);
    tex.needsUpdate = true;
  }

  drawTelemetry(s) {
    const { ctx, tex, canvas } = this.screens.tele;
    const w = canvas.width, h = canvas.height;
    this.frameScreen(ctx, w, h, `TELEMETRIA · ${ZONES[s.zone].name.toUpperCase()}`);
    const nf = (v, d) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f7ebdb';
    ctx.font = `800 92px ${DISPLAY}`;
    ctx.fillText(nf(s.radii, 2), 14, 128);
    const wR = ctx.measureText(nf(s.radii, 2)).width;
    ctx.font = `400 22px ${MONO}`;
    ctx.fillStyle = '#c6a893';
    ctx.fillText('R☉', 22 + wR, 126);

    ctx.textAlign = 'right';
    ctx.fillStyle = s.boosting ? '#ffc857' : '#f7ebdb';
    ctx.font = `800 64px ${DISPLAY}`;
    ctx.fillText(nf(s.speed * PACE.kmPerUnit, 0), w - 80, 112);
    ctx.font = `400 18px ${MONO}`;
    ctx.fillStyle = '#c6a893';
    ctx.fillText('km/s', w - 16, 110);
    ctx.fillText(`luz ${nf(s.sunlight, 0)}× Terra`, w - 16, 142);

    // Heat and energy bars.
    const bar = (y, label, v, col, text) => {
      ctx.textAlign = 'left';
      ctx.font = `500 15px ${MONO}`;
      ctx.fillStyle = '#c6a893';
      ctx.fillText(label, 14, y - 8);
      ctx.textAlign = 'right';
      ctx.fillStyle = col;
      ctx.fillText(text, w - 14, y - 8);
      ctx.fillStyle = 'rgba(247,235,219,0.1)';
      ctx.fillRect(14, y, w - 28, 14);
      ctx.fillStyle = col;
      ctx.fillRect(14, y, (w - 28) * clamp(v / 100, 0, 1), 14);
      for (let i = 1; i < 10; i++) { ctx.fillStyle = '#080405'; ctx.fillRect(14 + ((w - 28) * i) / 10, y, 2, 14); }
    };
    const shieldC = HEAT.shieldMinC + (HEAT.shieldMaxC - HEAT.shieldMinC) * (s.heat / 100);
    const hot = s.heat > 78;
    bar(200, 'ESCUDO TÉRMICO', s.heat, hot && Math.sin(s.time * 12) > 0 ? '#ff3b3b' : '#ff6a1a', `${nf(shieldC, 0)} °C`);
    bar(252, 'ENERGIA', s.energy, '#b58cff', `${nf(s.energy, 0)}%`);

    // Curvature ahead: arrow toward where the corridor bends.
    const bx = s.bend.x * 4000, by = s.bend.y * 4000;
    const ax = w / 2 + 20, ay = 300;
    ctx.strokeStyle = 'rgba(255,200,87,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + clamp(bx, -1, 1) * 40, ay - clamp(by, -1, 1) * 12);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = `500 14px ${MONO}`;
    ctx.fillStyle = '#8a6d5e';
    ctx.fillText('CURVA', 14, 306);
    ctx.textAlign = 'right';
    ctx.fillText(`×${s.combo} · ${nf(s.score, 0)} pts`, w - 14, 306);
    this.scanlines(ctx, w, h);
    tex.needsUpdate = true;
  }

  drawSystems(s) {
    const { ctx, tex, canvas } = this.screens.sys;
    const w = canvas.width, h = canvas.height;
    this.frameScreen(ctx, w, h, 'SISTEMAS');

    // Shield temperature history (last 20 s).
    const gx = 14, gy = 44, gw = w - 28, gh = 110;
    ctx.strokeStyle = 'rgba(247,235,219,0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(gx, gy + (gh * i) / 4); ctx.lineTo(gx + gw, gy + (gh * i) / 4); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,59,59,0.12)';
    ctx.fillRect(gx, gy, gw, gh * 0.22);
    const grad = ctx.createLinearGradient(0, gy, 0, gy + gh);
    grad.addColorStop(0, '#fff4dc');
    grad.addColorStop(0.3, '#ffc857');
    grad.addColorStop(1, '#a3170e');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    this.history.forEach((v, i) => {
      const px = gx + (gw * i) / (this.history.length - 1);
      const py = gy + gh - (gh * clamp(v, 0, 100)) / 100;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.font = `400 13px ${MONO}`;
    ctx.fillStyle = '#8a6d5e';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('TEMP. DO ESCUDO · 20 s', gx, gy + gh + 6);

    // Status list.
    const lines = [];
    const blink = Math.sin(s.time * 10) > 0;
    if (s.heat > 78) lines.push(['ALERTA TÉRMICO', '#ff3b3b', blink]);
    if (s.stormWarn || s.storm) lines.push(['EJEÇÃO CORONAL', '#ff6ad5', blink]);
    if (s.shield) lines.push(['ESCUDO MAG. ATIVO', '#5cf2ff', true]);
    if (s.boosting) lines.push(['IMPULSO', '#ffc857', true]);
    if (this.cracks.length) lines.push([`VIDRO · ${this.cracks.length} TRINCA${this.cracks.length > 1 ? 'S' : ''}`, '#f7ebdb', true]);
    if (!lines.length) lines.push(['SISTEMAS NOMINAIS', '#8fd18a', true]);
    ctx.font = `600 17px ${MONO}`;
    lines.slice(0, 4).forEach(([t, c, on], i) => {
      ctx.fillStyle = on ? c : 'rgba(247,235,219,0.2)';
      ctx.fillText(`▸ ${t}`, 14, 188 + i * 28);
    });
    this.scanlines(ctx, w, h);
    tex.needsUpdate = true;
  }
}
