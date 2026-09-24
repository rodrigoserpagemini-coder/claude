import {
  ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PerspectiveCamera,
  Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import {
  ENERGY, HEAT, PACE, SUN, ZONES, depthAt, radiiAt, sunlightAt, zoneIndex, zoneWeights,
} from '../config.js';
import { Audio } from '../core/Audio.js';
import { bendOffset, bendUniform, updateBend } from '../core/bend.js';
import { Input } from '../core/Input.js';
import { clamp, damp, rand } from '../core/math.js';
import { PostFX } from '../fx/PostFX.js';
import { Sparks } from '../fx/Sparks.js';
import { HUD, fmt } from '../ui/HUD.js';
import { Streaks } from '../world/Streaks.js';
import { SunCore } from '../world/SunCore.js';
import { Tunnel } from '../world/Tunnel.js';
import { Cockpit } from './Cockpit.js';
import { Field } from './Field.js';
import { Probe } from './Probe.js';

const $ = (id) => document.getElementById(id);
const LOG_KEY = 'mergulho-solar:log';
const VIEW_KEY = 'mergulho-solar:view';
const thrusterLocal = [new Vector3(-0.22, -0.1, 0.7), new Vector3(0.22, -0.1, 0.7)];
const tmpV = new Vector3();
const sunUv = new Vector2();

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

function freshRun() {
  return {
    dist: 0, heat: HEAT.start, energy: ENERGY.start, score: 0, combo: 1,
    grazes: 0, cells: 0, storms: 0, maxSpeed: 0, minRadii: SUN.startRadii, time: 0,
    invuln: 0, shieldT: 0, zone: 0, passedParker: false, beatParkerSpeed: false,
    storm: 'idle', stormT: 0, nextStorm: 42,
  };
}

export class Game {
  constructor() {
    this.canvas = $('scene');
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    this.scene = new Scene();
    this.scene.background = new Color('#0b0507');
    this.camera = new PerspectiveCamera(70, 1, 0.04, 420);
    this.camera.position.set(0, 1.1, 5.2);
    this.scene.add(this.camera);

    this.scene.add(new HemisphereLight('#ffb27a', '#3a0b0b', 1.3));
    const sunLight = new DirectionalLight('#ffd9a8', 2.6);
    sunLight.position.set(0.4, 2, -10);
    const rim = new DirectionalLight('#ff4d1f', 1.6);
    rim.position.set(0, 4, 6);
    this.scene.add(sunLight, rim);

    this.tunnel = new Tunnel(this.scene);
    this.streaks = new Streaks(this.scene);
    this.sun = new SunCore(this.scene);
    this.probe = new Probe(this.scene);
    this.sparks = new Sparks(this.scene);
    this.cockpit = new Cockpit(this.camera);
    this.field = new Field(this.scene, {
      onHit: (it) => this.onHit(it),
      onGraze: (it) => this.onGraze(it),
      onCollect: (it) => this.onCollect(it),
      onEnergy: (it) => this.onEnergy(it),
    });
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.input.onPause = () => this.togglePause();
    this.input.onShield = () => this.activateShield();
    this.input.onCamera = () => this.setView(this.view === 'chase' ? 'cockpit' : 'chase');
    this.hud = new HUD();

    this.state = 'title';
    this.run = freshRun();
    this.time = 0;
    this.travel = 0;            // world travel, drives visuals continuously
    this.speed = PACE.startSpeed;
    this.boostMult = 1;
    this.boosting = false;
    this.timeScale = 1;
    this.shake = 0;
    this.flash = 0;
    this.fovKick = 0;
    this.stormLevel = 0;
    this.zoneW = [1, 0, 0, 0];
    this.prevV = [0, 0];
    this.accel = [0, 0];
    this.log = store.get(LOG_KEY, []);
    this.coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = Math.min(this.maxPixelRatio, 1.5);
    this.perf = { acc: 0, frames: 0 };

    this.bindUI();
    this.setView(store.get(VIEW_KEY, 'chase'), true);
    this.renderLog();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.togglePause();
    });

    this.field.reset(this.travel + 40);
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // --- UI wiring ------------------------------------------------------------

  bindUI() {
    this.screens = { title: $('screen-title'), pause: $('screen-pause'), over: $('screen-over') };
    $('btn-start').addEventListener('click', () => this.start());
    $('btn-retry').addEventListener('click', () => this.start());
    $('btn-menu').addEventListener('click', () => this.toTitle());
    $('btn-resume').addEventListener('click', () => this.togglePause());
    $('btn-quit').addEventListener('click', () => this.toTitle());
    this.pauseBtn = $('btn-pause');
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.cameraBtn = $('btn-camera');
    this.cameraBtn.addEventListener('click', () => this.setView(this.view === 'chase' ? 'cockpit' : 'chase'));
    for (const chip of document.querySelectorAll('.view-pick .chip')) {
      chip.addEventListener('click', () => this.setView(chip.dataset.view));
    }
    const sound = $('btn-sound');
    sound.addEventListener('click', () => {
      this.audio.start();
      this.audio.setMuted(!this.audio.muted);
      sound.textContent = this.audio.muted ? 'Som desligado' : 'Som ligado';
      sound.setAttribute('aria-pressed', String(!this.audio.muted));
    });
    this.touch = $('touch-controls');
    this.shieldBtn = $('btn-shieldx');
    this.input.bindTouchButtons($('btn-boost'), this.shieldBtn);
  }

  setView(view, silent = false) {
    this.view = view === 'cockpit' ? 'cockpit' : 'chase';
    const cockpit = this.view === 'cockpit';
    this.cockpit.setVisible(cockpit);
    this.hud.setCockpit(cockpit);
    this.cameraBtn.textContent = cockpit ? '3ª pessoa' : 'Cabine';
    for (const chip of document.querySelectorAll('.view-pick .chip')) {
      chip.setAttribute('aria-checked', String(chip.dataset.view === this.view));
    }
    if (!silent) store.set(VIEW_KEY, this.view);
    this.resize();
  }

  showScreen(name) {
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== name;
  }

  bestRadii() {
    return this.log.length ? Math.min(...this.log.map((r) => r.radii)) : null;
  }

  renderLog() {
    const best = this.log[0];
    $('best-line').textContent = best
      ? `Seu recorde: ${fmt.int(best.score)} pontos · menor distância ${fmt.radii(this.bestRadii())} R☉`
      : 'Meta: passar de 9,86 R☉ sem romper o escudo.';
    this.hud.setBest(this.bestRadii());
    const list = $('log-list');
    list.replaceChildren(...this.log.map((r) => {
      const li = document.createElement('li');
      const date = new Date(r.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
      li.innerHTML = `<span><b>${fmt.int(r.score)}</b> pts · ${ZONES[r.zone]?.name ?? ''}</span><span>${fmt.radii(r.radii)} R☉</span><span class="log-date">${date}</span>`;
      return li;
    }));
    $('log').hidden = this.log.length === 0;
  }

  start() {
    this.audio.start();
    document.activeElement?.blur?.();
    this.run = freshRun();
    this.speed = PACE.startSpeed;
    this.boostMult = 1;
    this.timeScale = 1;
    this.flash = 0;
    this.shake = 0;
    this.stormLevel = 0;
    this.field.reset(this.travel + 70);
    this.sparks.clear();
    this.probe.reset();
    this.input.reset();
    this.cockpit.repair();
    this.hud.clearToasts();
    this.hud.show(true);
    this.pauseBtn.hidden = false;
    this.touch.hidden = !this.coarse;
    this.showScreen(null);
    this.state = 'playing';
    this.hud.toast(ZONES[0].name, 'zone', 3400, ZONES[0].note);
  }

  toTitle() {
    this.state = 'title';
    this.timeScale = 1;
    this.run = freshRun();
    this.speed = PACE.startSpeed;
    this.boostMult = 1;
    this.probe.reset();
    this.field.reset(this.travel + 40);
    this.hud.show(false);
    this.pauseBtn.hidden = true;
    this.touch.hidden = true;
    this.renderLog();
    this.showScreen('title');
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.showScreen('pause');
      this.pauseBtn.textContent = 'Continuar';
      this.audio.ctx?.suspend();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.showScreen(null);
      this.pauseBtn.textContent = 'Pausar';
      this.audio.ctx?.resume();
      this.last = performance.now();
    }
  }

  // --- abilities ------------------------------------------------------------

  activateShield() {
    const r = this.run;
    if (this.state !== 'playing' || r.shieldT > 0) return;
    if (r.energy < ENERGY.shieldCost) {
      this.hud.toast('Energia insuficiente', 'hit', 900);
      return;
    }
    r.energy -= ENERGY.shieldCost;
    r.shieldT = ENERGY.shieldTime;
    this.audio.shield();
    this.hud.toast('Escudo magnético', 'deflect', 1100);
  }

  // --- field events ------------------------------------------------------------

  onHit() {
    const r = this.run;
    if (this.state !== 'playing') return;
    if (r.shieldT > 0) {
      this.audio.deflect();
      this.shake = Math.max(this.shake, 0.25);
      this.sparks.burst(this.probe.x, this.probe.y, -1.2, 70, { color: '#5cf2ff', speed: 12, life: 0.6, size: 36, boost: 3 });
      this.hud.toast('Desviado', 'deflect', 800);
      return;
    }
    if (r.invuln > 0) return;
    r.heat += HEAT.hit;
    r.combo = 1;
    r.invuln = 1.3;
    this.shake = 0.7;
    this.flash = 0.9;
    this.fovKick = -6;
    this.audio.hit();
    this.cockpit.crack();
    this.sparks.burst(this.probe.x, this.probe.y, -0.4, 90, { color: '#ff7a2e', speed: 11, life: 0.8, size: 46, boost: 3 });
    this.hud.toast('Impacto · +30% calor', 'hit');
  }

  onGraze() {
    const r = this.run;
    r.grazes++;
    r.combo = Math.min(r.combo + 1, 12);
    r.energy = Math.min(100, r.energy + ENERGY.graze);
    const pts = 150 * r.combo;
    r.score += pts;
    this.shake = Math.max(this.shake, 0.18);
    this.audio.graze();
    this.sparks.burst(this.probe.x, this.probe.y, -0.6, 26, { color: '#ffc857', speed: 6, life: 0.5, size: 26, boost: 2.5 });
    this.hud.toast(`Rasante +${fmt.int(pts)}`, 'graze');
  }

  onCollect(it) {
    const r = this.run;
    r.cells++;
    r.heat = Math.max(0, r.heat - HEAT.coolant);
    r.combo = Math.min(r.combo + 1, 12);
    const pts = 250 * r.combo;
    r.score += pts;
    this.audio.collect(r.combo);
    this.sparks.burst(it.x, it.y, -0.3, 60, { color: '#5cf2ff', speed: 7, life: 0.7, size: 34, boost: 3 });
    this.hud.toast(`Criocélula −22% · +${fmt.int(pts)}`, 'coolant');
  }

  onEnergy(it) {
    const r = this.run;
    r.energy = Math.min(100, r.energy + ENERGY.cell);
    r.score += 200;
    this.audio.energy();
    this.sparks.burst(it.x, it.y, -0.3, 60, { color: '#b58cff', speed: 7, life: 0.7, size: 34, boost: 3 });
    this.hud.toast('Energia +35%', 'energy');
  }

  breach() {
    const r = this.run;
    this.state = 'dying';
    this.probe.visible = false;
    this.pauseBtn.hidden = true;
    this.touch.hidden = true;
    this.shake = 1.3;
    this.flash = 1.6;
    this.audio.breach();
    this.cockpit.crack();
    this.cockpit.crack();
    this.sparks.burst(this.probe.x, this.probe.y, 0, 320, { color: '#ffe2b0', speed: 16, life: 1.6, size: 60, boost: 4, drag: 1.4 });
    this.sparks.burst(this.probe.x, this.probe.y, 0, 90, { color: '#5cf2ff', speed: 9, life: 1.2, size: 30, boost: 2 });
    this.dyingFor = 0;

    const isBest = !this.log.length || r.score > this.log[0].score;
    this.log.push({ score: Math.round(r.score), radii: r.minRadii, zone: r.zone, date: Date.now() });
    this.log.sort((a, b) => b.score - a.score);
    this.log = this.log.slice(0, 5);
    store.set(LOG_KEY, this.log);
    this.fillOver(isBest);
  }

  fillOver(isBest) {
    const r = this.run;
    const passed = r.minRadii < SUN.parkerRadii;
    $('over-title').textContent = passed ? 'Além da Parker' : 'Escudo térmico rompido';
    $('over-eyebrow').textContent = isBest ? 'Telemetria final · novo recorde' : 'Telemetria final';
    const gap = Math.abs(r.minRadii - SUN.parkerRadii);
    $('over-verdict').textContent = passed
      ? `O escudo cedeu a ${fmt.radii(r.minRadii)} raios solares do centro, ${fmt.radii(gap)} R☉ mais perto do que a Parker Solar Probe chegou em 2024. A luz do Sol ali é ${fmt.int(sunlightAt(r.minRadii))} vezes mais forte que na Terra.`
      : `O escudo cedeu a ${fmt.radii(r.minRadii)} raios solares do centro. Faltaram ${fmt.radii(gap)} R☉ para alcançar o periélio da Parker Solar Probe (9,86 R☉).`;
    $('st-depth').innerHTML = `${fmt.radii(r.minRadii)}<small>R☉</small>`;
    $('st-score').textContent = fmt.int(r.score);
    $('st-zone').textContent = ZONES[r.zone].name;
    $('st-speed').innerHTML = `${fmt.int(r.maxSpeed * PACE.kmPerUnit)}<small>km/s</small>`;
    $('st-time').textContent = fmt.time(r.time);
    $('st-cells').textContent = fmt.int(r.cells);
    $('st-grazes').textContent = fmt.int(r.grazes);
    $('st-storms').textContent = fmt.int(r.storms);
  }

  // --- frame ------------------------------------------------------------

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.pixelRatio);
    this.camera.aspect = w / h;
    const portrait = w / h < 0.8;
    // Keep the corridor readable in portrait by widening the vertical FOV.
    this.baseFov = this.view === 'cockpit' ? (portrait ? 96 : 78) : (portrait ? 88 : 70);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.cockpit.layout(w / h, this.baseFov + 4);
    this.sparks.points.material.uniforms.uScale.value = (h * this.pixelRatio) / 1000;
  }

  // Dynamic resolution: hold roughly 55–60 fps on whatever GPU this runs on.
  adaptQuality(rawDt) {
    const p = this.perf;
    p.acc += rawDt; p.frames++;
    if (p.acc < 1.2) return;
    const avg = p.acc / p.frames;
    p.acc = 0; p.frames = 0;
    let next = this.pixelRatio;
    if (avg > 1 / 40 && next > 0.75) next = Math.max(0.75, next * 0.9);
    else if (avg < 1 / 58 && next < this.maxPixelRatio) next = Math.min(this.maxPixelRatio, next * 1.08);
    if (Math.abs(next - this.pixelRatio) > 0.01) {
      this.pixelRatio = next;
      this.resize();
    }
  }

  updateStorm(dt) {
    const r = this.run;
    if (r.storm === 'idle' && r.time >= r.nextStorm) {
      r.storm = 'warn';
      r.stormT = 3.5;
      this.audio.siren();
    } else if (r.storm === 'warn') {
      r.stormT -= dt;
      if (r.stormT <= 0) { r.storm = 'active'; r.stormT = 8; }
    } else if (r.storm === 'active') {
      r.stormT -= dt;
      this.shake = Math.max(this.shake, 0.12);
      if (r.stormT <= 0) {
        r.storm = 'idle';
        r.nextStorm = r.time + rand(48, 68);
        r.storms++;
        r.score += 3000;
        this.audio.milestone();
        this.hud.toast('Tempestade superada · +3.000', 'milestone', 2400);
      }
    }
  }

  updateRun(dt) {
    const r = this.run;
    r.time += dt;
    r.invuln = Math.max(0, r.invuln - dt);
    r.shieldT = Math.max(0, r.shieldT - dt);

    // Boost: faster and double points, paid in energy and heat.
    this.boosting = this.input.boost && r.energy > 0.5;
    if (this.boosting) r.energy = Math.max(0, r.energy - ENERGY.boostDrain * dt);
    else r.energy = Math.min(100, r.energy + ENERGY.passive * dt);
    this.boostMult = damp(this.boostMult, this.boosting ? PACE.boostMult : 1, 3.5, dt);

    const base = PACE.startSpeed + PACE.maxExtraSpeed * (1 - Math.exp(-r.dist / PACE.speedRamp));
    this.speed = base * this.boostMult;
    r.dist += this.speed * dt;
    const depth = depthAt(r.dist);

    this.updateStorm(dt);
    const stormMult = r.storm === 'active' ? HEAT.stormMult : 1;
    r.heat += ((HEAT.baseRate + HEAT.depthRate * depth) * stormMult + (this.boosting ? HEAT.boostRate : 0)) * dt;
    r.score += this.speed * dt * (0.6 + depth * 2.4) * (this.boosting ? 2 : 1);
    r.maxSpeed = Math.max(r.maxSpeed, this.speed);
    const radii = radiiAt(r.dist);
    r.minRadii = Math.min(r.minRadii, radii);

    const zone = zoneIndex(radii);
    if (zone > r.zone) {
      r.zone = zone;
      this.audio.zone();
      this.hud.toast(ZONES[zone].name, 'zone', 3400, ZONES[zone].note);
    }
    if (!r.passedParker && radii < SUN.parkerRadii) {
      r.passedParker = true;
      r.score += 5000;
      this.audio.milestone();
      this.hud.toast('Periélio da Parker superado · +5.000', 'milestone', 2600);
    }
    if (!r.beatParkerSpeed && this.speed * PACE.kmPerUnit > SUN.parkerSpeed) {
      r.beatParkerSpeed = true;
      this.audio.milestone();
      this.hud.toast('Mais rápida que a Parker · 191,7 km/s', 'milestone', 2600);
    }
    if (r.heat >= 100) {
      r.heat = 100;
      this.breach();
    }
  }

  frame() {
    const now = performance.now();
    const rawDt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.state !== 'paused') this.adaptQuality(rawDt);

    if (this.state === 'paused') {
      this.post.render(0);
      return;
    }

    const dt = Math.min(rawDt, 0.05) * this.timeScale;
    this.time += dt;
    const r = this.run;
    const playing = this.state === 'playing';
    const cockpit = this.view === 'cockpit';

    if (playing) {
      this.updateRun(dt);
    } else {
      this.boosting = false;
      this.boostMult = damp(this.boostMult, 1, 3, dt);
      if (this.state === 'dying') {
        this.dyingFor += rawDt;
        this.timeScale = damp(this.timeScale, 0.18, 3, rawDt);
        if (this.dyingFor > 1.8) {
          this.state = 'over';
          this.hud.show(false);
          this.showScreen('over');
        }
      }
    }

    this.travel += this.speed * dt;
    updateBend(this.travel);
    // On the title screen the backdrop drifts through all four zones.
    const radii = playing || this.state === 'dying' ? radiiAt(r.dist) : clamp(11 + 9 * Math.sin(this.time * 0.035), 2.5, 19.5);
    zoneWeights(radii, this.zoneW);
    const zone = zoneIndex(radii);
    const depth = depthAt(r.dist);
    const heatN = clamp(r.heat / 100, 0, 1);
    const speedN = clamp((this.speed - PACE.startSpeed) / (PACE.maxExtraSpeed * PACE.boostMult), 0, 1);
    const storming = r.storm === 'active';
    this.stormLevel = damp(this.stormLevel, storming ? 1 : r.storm === 'warn' ? 0.25 : 0, 2.5, dt);

    // Steering.
    let tx, ty;
    if (playing) {
      this.input.update(dt);
      tx = this.input.tx; ty = this.input.ty;
    } else if (this.state === 'title') {
      tx = Math.sin(this.time * 0.47) * 2.6 + Math.sin(this.time * 1.3) * 0.5;
      ty = Math.sin(this.time * 0.36 + 1.2) * 1.7;
    } else {
      tx = this.probe.x; ty = this.probe.y;
    }
    this.probe.update(dt, tx, ty, this.time, heatN, playing && r.invuln > 0, r.shieldT > 0, !cockpit);
    const ax = (this.probe.vx - this.prevV[0]) / Math.max(dt, 1e-4);
    const ay = (this.probe.vy - this.prevV[1]) / Math.max(dt, 1e-4);
    this.accel[0] = damp(this.accel[0], ax, 10, dt);
    this.accel[1] = damp(this.accel[1], ay, 10, dt);
    this.prevV[0] = this.probe.vx; this.prevV[1] = this.probe.vy;

    this.field.update(dt, this.time, this.speed, this.travel, zone, depth, storming, this.probe, playing);

    // Ion exhaust (only visible from outside).
    if (this.probe.visible && !cockpit) {
      this.probe.group.updateMatrixWorld();
      for (const p of thrusterLocal) {
        tmpV.copy(p);
        this.probe.group.localToWorld(tmpV);
        const n = this.boosting ? 3 : 1;
        for (let i = 0; i < n; i++) {
          this.sparks.emit(tmpV.x, tmpV.y, tmpV.z, rand(-0.3, 0.3), rand(-0.3, 0.3), rand(1, 3) + (this.boosting ? 6 : 0),
            this.boosting ? '#ffd27a' : '#6ff0ff', 0.28, this.boosting ? 22 : 16, 1, 1.6);
        }
      }
    }
    this.sparks.update(dt, this.speed);

    // World shaders.
    this.flash = damp(this.flash, 0, 5, rawDt);
    this.tunnel.update(this.time, this.travel, depth, heatN, this.flash * 0.35, this.zoneW, this.stormLevel);
    this.streaks.update(this.travel, this.speed);
    this.streaks.uniforms.uGain.value = 1 + (this.boostMult - 1) * 2.5 + this.stormLevel * 0.8;
    this.sun.update(this.time, depth, this.camera);

    // Camera rig.
    this.shake = damp(this.shake, 0, 4.5, rawDt);
    this.fovKick = damp(this.fovKick, 0, 3, rawDt);
    const s = this.shake * this.shake;
    const cam = this.camera;
    const [bx, by] = bendOffset(-40);
    if (cockpit) {
      cam.position.set(
        this.probe.x + (Math.random() - 0.5) * s * 0.25,
        this.probe.y + 0.08 + (Math.random() - 0.5) * s * 0.25,
        0.15,
      );
      // Pitch slightly down so the photosphere rides above the dashboard.
      cam.lookAt(this.probe.x * 0.92 + bx * 0.7, this.probe.y * 0.92 - 5 + by * 0.7, -40);
      cam.rotateZ(clamp(-this.probe.vx * 0.018, -0.4, 0.4));
    } else {
      cam.position.set(
        this.probe.x * 0.62 + (Math.random() - 0.5) * s * 0.9,
        this.probe.y * 0.62 + 1.75 + (Math.random() - 0.5) * s * 0.9,
        6.4 - speedN * 0.9,
      );
      cam.lookAt(this.probe.x * 0.8 + bx * 0.4, this.probe.y * 0.8 + 0.9 + by * 0.4, -20);
      cam.rotateZ(clamp(-this.probe.vx * 0.006, -0.2, 0.2));
    }
    const fov = this.baseFov + speedN * (cockpit ? 5 : 12) + this.fovKick * (cockpit ? 0.3 : 1);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    const tele = {
      dt, time: this.time, heat: r.heat, energy: r.energy, speed: this.speed, radii, zone,
      sunlight: sunlightAt(radii), boosting: this.boosting, shield: r.shieldT > 0,
      storm: storming, stormWarn: r.storm === 'warn', stormLeft: r.stormT,
      items: this.field.items, probe: this.probe, target: [tx, ty], accel: this.accel,
      combo: r.combo, score: r.score, bend: bendUniform.value, cockpit,
    };
    if (cockpit) this.cockpit.update(tele);

    // Where the photosphere sits on screen, for the light shafts.
    tmpV.copy(this.sun.mesh.position).project(cam);
    sunUv.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
    const sunOnScreen = tmpV.z < 1 ? 1 - clamp((Math.abs(tmpV.x) + Math.abs(tmpV.y) - 1.2) * 2, 0, 1) : 0;

    const alarm = playing && r.heat > 78;
    this.post.update(this.time, {
      aberration: (0.0016 + speedN * 0.002 + this.shake * 0.012 + this.stormLevel * 0.002) * (cockpit ? 0.35 : 1),
      shimmer: heatN * heatN * 1.4 + this.flash * 0.6,
      flash: this.flash * 0.25,
      bloom: (0.55 + depth * 0.15 + this.flash * 0.5 + this.stormLevel * 0.2) * (cockpit ? 0.7 : 1),
      rays: (0.7 + depth * 0.6) * (cockpit ? 0.45 : 1) * sunOnScreen,
      sun: sunUv,
      zoom: (this.boostMult - 1) / (PACE.boostMult - 1) * 0.9,
      alarm: alarm ? 0.6 + 0.4 * Math.sin(this.time * 10) : 0,
      shield: r.shieldT > 0 && !cockpit ? 0.7 : 0,
    });
    this.audio.update(speedN, heatN, { boosting: this.boosting, alarm, dt: rawDt });

    if (playing || this.state === 'dying') {
      this.hud.update({ ...tele, radii: radiiAt(r.dist) }, rawDt);
      this.shieldBtn.disabled = r.energy < ENERGY.shieldCost || r.shieldT > 0;
    }

    this.post.render(dt);
  }
}
