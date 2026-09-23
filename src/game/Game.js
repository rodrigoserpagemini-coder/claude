import {
  ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PerspectiveCamera,
  Scene, Vector3, WebGLRenderer,
} from 'three';
import { HEAT, PACE, SUN, coronaMK, depthAt, radiiAt } from '../config.js';
import { Audio } from '../core/Audio.js';
import { updateBend } from '../core/bend.js';
import { Input } from '../core/Input.js';
import { clamp, damp, rand } from '../core/math.js';
import { PostFX } from '../fx/PostFX.js';
import { Sparks } from '../fx/Sparks.js';
import { HUD, fmt } from '../ui/HUD.js';
import { Streaks } from '../world/Streaks.js';
import { SunCore } from '../world/SunCore.js';
import { Tunnel } from '../world/Tunnel.js';
import { Field } from './Field.js';
import { Probe } from './Probe.js';

const $ = (id) => document.getElementById(id);
const BEST_KEY = 'mergulho-solar:best';
const thrusterLocal = [new Vector3(-0.22, -0.1, 0.7), new Vector3(0.22, -0.1, 0.7)];
const tmpV = new Vector3();

function loadBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)) || null; } catch { return null; }
}
function saveBest(best) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* storage unavailable */ }
}

function freshRun() {
  return {
    dist: 0, speed: PACE.startSpeed, heat: HEAT.start, score: 0, combo: 1,
    grazes: 0, cells: 0, maxSpeed: 0, minRadii: SUN.startRadii, time: 0,
    invuln: 0, passedParker: false, beatParkerSpeed: false,
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
    this.camera = new PerspectiveCamera(70, 1, 0.1, 420);
    this.camera.position.set(0, 1.1, 5.2);

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
    this.field = new Field(this.scene, {
      onHit: (it) => this.onHit(it),
      onGraze: (it) => this.onGraze(it),
      onCollect: (it) => this.onCollect(it),
    });
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.input.onPause = () => this.togglePause();
    this.hud = new HUD();

    this.state = 'title';
    this.run = freshRun();
    this.time = 0;
    this.travel = 0;            // world travel, drives visuals continuously
    this.speed = PACE.startSpeed;
    this.timeScale = 1;
    this.shake = 0;
    this.flash = 0;
    this.fovKick = 0;
    this.best = loadBest();

    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = Math.min(this.maxPixelRatio, 1.5);
    this.perf = { acc: 0, frames: 0 };

    this.bindUI();
    this.renderBest();
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
    const sound = $('btn-sound');
    sound.addEventListener('click', () => {
      this.audio.start();
      this.audio.setMuted(!this.audio.muted);
      sound.textContent = this.audio.muted ? 'Som desligado' : 'Som ligado';
      sound.setAttribute('aria-pressed', String(!this.audio.muted));
    });
  }

  showScreen(name) {
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== name;
  }

  renderBest() {
    const el = $('best-line');
    el.textContent = this.best
      ? `Seu recorde: ${fmt.int(this.best.score)} pontos · ${fmt.radii(this.best.radii)} R☉`
      : 'Meta: passar de 9,86 R☉ sem romper o escudo.';
  }

  start() {
    this.audio.start();
    this.run = freshRun();
    this.speed = PACE.startSpeed;
    this.timeScale = 1;
    this.flash = 0;
    this.shake = 0;
    this.field.reset(this.travel + 70);
    this.sparks.clear();
    this.probe.reset();
    this.input.reset();
    this.hud.clearToasts();
    this.hud.show(true);
    this.pauseBtn.hidden = false;
    this.showScreen(null);
    this.state = 'playing';
    this.canvas.focus?.();
  }

  toTitle() {
    this.state = 'title';
    this.timeScale = 1;
    this.run = freshRun();
    this.speed = PACE.startSpeed;
    this.probe.reset();
    this.field.reset(this.travel + 40);
    this.hud.show(false);
    this.pauseBtn.hidden = true;
    this.renderBest();
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

  // --- field events ------------------------------------------------------------

  onHit() {
    const r = this.run;
    if (r.invuln > 0 || this.state !== 'playing') return;
    r.heat += HEAT.hit;
    r.combo = 1;
    r.invuln = 1.3;
    this.shake = 0.7;
    this.flash = 0.9;
    this.fovKick = -6;
    this.audio.hit();
    this.sparks.burst(this.probe.x, this.probe.y, -0.4, 90, { color: '#ff7a2e', speed: 11, life: 0.8, size: 46, boost: 3 });
    this.hud.toast('Impacto · +30% calor', 'hit');
  }

  onGraze() {
    const r = this.run;
    r.grazes++;
    r.combo = Math.min(r.combo + 1, 12);
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

  breach() {
    const r = this.run;
    this.state = 'dying';
    this.probe.visible = false;
    this.pauseBtn.hidden = true;
    this.shake = 1.3;
    this.flash = 1.6;
    this.audio.breach();
    this.sparks.burst(this.probe.x, this.probe.y, 0, 320, { color: '#ffe2b0', speed: 16, life: 1.6, size: 60, boost: 4, drag: 1.4 });
    this.sparks.burst(this.probe.x, this.probe.y, 0, 90, { color: '#5cf2ff', speed: 9, life: 1.2, size: 30, boost: 2 });
    this.dyingFor = 0;

    const isBest = !this.best || r.score > this.best.score;
    if (isBest || r.minRadii < this.best.radii) {
      this.best = {
        score: Math.max(r.score, this.best?.score ?? 0),
        radii: Math.min(r.minRadii, this.best?.radii ?? Infinity),
      };
      saveBest(this.best);
    }
    this.fillOver(isBest);
  }

  fillOver(isBest) {
    const r = this.run;
    const passed = r.minRadii < SUN.parkerRadii;
    $('over-title').textContent = passed ? 'Além da Parker' : 'Escudo térmico rompido';
    $('over-eyebrow').textContent = isBest ? 'Telemetria final · novo recorde' : 'Telemetria final';
    const gap = Math.abs(r.minRadii - SUN.parkerRadii);
    $('over-verdict').textContent = passed
      ? `O escudo cedeu a ${fmt.radii(r.minRadii)} raios solares do centro, ${fmt.radii(gap)} R☉ mais perto do que a Parker Solar Probe chegou em 2024.`
      : `O escudo cedeu a ${fmt.radii(r.minRadii)} raios solares do centro. Faltaram ${fmt.radii(gap)} R☉ para alcançar o periélio da Parker Solar Probe (9,86 R☉).`;
    $('st-depth').innerHTML = `${fmt.radii(r.minRadii)}<small>R☉</small>`;
    $('st-score').textContent = fmt.int(r.score);
    $('st-speed').innerHTML = `${fmt.int(r.maxSpeed * PACE.kmPerUnit)}<small>km/s</small>`;
    $('st-time').textContent = fmt.time(r.time);
    $('st-cells').textContent = fmt.int(r.cells);
    $('st-grazes').textContent = fmt.int(r.grazes);
  }

  // --- frame ------------------------------------------------------------

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.pixelRatio);
    this.camera.aspect = w / h;
    // Keep the corridor readable in portrait by widening the vertical FOV.
    this.baseFov = w / h < 0.8 ? 88 : 70;
    this.camera.updateProjectionMatrix();
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
    if (avg > 1 / 48 && next > 0.5) next = Math.max(0.5, next * 0.85);
    else if (avg < 1 / 58 && next < this.maxPixelRatio) next = Math.min(this.maxPixelRatio, next * 1.08);
    if (Math.abs(next - this.pixelRatio) > 0.01) {
      this.pixelRatio = next;
      this.resize();
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

    // Pace and heat.
    if (playing) {
      r.time += dt;
      r.dist += this.speed * dt;
      r.invuln = Math.max(0, r.invuln - dt);
      const depth = depthAt(r.dist);
      this.speed = PACE.startSpeed + PACE.maxExtraSpeed * (1 - Math.exp(-r.dist / PACE.speedRamp));
      r.heat += (HEAT.baseRate + HEAT.depthRate * depth) * dt;
      r.score += this.speed * dt * (0.6 + depth * 2.4);
      r.maxSpeed = Math.max(r.maxSpeed, this.speed);
      const radii = radiiAt(r.dist);
      r.minRadii = Math.min(r.minRadii, radii);

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
    } else if (this.state === 'dying') {
      this.dyingFor += rawDt;
      this.timeScale = damp(this.timeScale, 0.18, 3, rawDt);
      if (this.dyingFor > 1.8 && this.state === 'dying') {
        this.state = 'over';
        this.hud.show(false);
        this.showScreen('over');
      }
    }

    this.travel += this.speed * dt;
    updateBend(this.travel);
    const depth = depthAt(r.dist);
    const heatN = clamp(r.heat / 100, 0, 1);
    const speedN = (this.speed - PACE.startSpeed) / PACE.maxExtraSpeed;

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
    this.probe.update(dt, tx, ty, this.time, heatN, playing && r.invuln > 0);

    this.field.update(dt, this.time, this.speed, this.travel, depth, this.probe, playing);

    // Ion exhaust.
    if (this.probe.visible) {
      this.probe.group.updateMatrixWorld();
      for (const p of thrusterLocal) {
        tmpV.copy(p);
        this.probe.group.localToWorld(tmpV);
        this.sparks.emit(tmpV.x, tmpV.y, tmpV.z, rand(-0.3, 0.3), rand(-0.3, 0.3), rand(1, 3), '#6ff0ff', 0.28, 16, 1, 1.6);
      }
    }
    this.sparks.update(dt, this.speed);

    // World shaders.
    this.flash = damp(this.flash, 0, 5, rawDt);
    this.tunnel.update(this.time, this.travel, depth, heatN, this.flash * 0.35);
    this.streaks.update(this.travel, this.speed);
    this.sun.update(this.time, depth, this.camera);

    // Camera rig.
    this.shake = damp(this.shake, 0, 4.5, rawDt);
    this.fovKick = damp(this.fovKick, 0, 3, rawDt);
    const s = this.shake * this.shake;
    const cam = this.camera;
    cam.position.set(
      this.probe.x * 0.62 + (Math.random() - 0.5) * s * 0.9,
      this.probe.y * 0.62 + 1.75 + (Math.random() - 0.5) * s * 0.9,
      6.4 - speedN * 0.9,
    );
    cam.lookAt(this.probe.x * 0.8, this.probe.y * 0.8 + 0.9, -20);
    cam.rotateZ(clamp(-this.probe.vx * 0.006, -0.2, 0.2));
    const fov = this.baseFov + speedN * 12 + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // Post and audio.
    this.post.update(this.time, {
      aberration: 0.0016 + speedN * 0.002 + this.shake * 0.012,
      shimmer: heatN * heatN * 1.4 + this.flash * 0.6,
      flash: this.flash * 0.25,
      bloom: 0.55 + depth * 0.15 + this.flash * 0.5,
    });
    this.audio.update(clamp(speedN, 0, 1), heatN);

    if (playing || this.state === 'dying') {
      this.hud.update({
        radii: radiiAt(r.dist), score: r.score, combo: r.combo, speed: this.speed,
        corona: coronaMK(r.dist), heat: r.heat,
      });
    }

    this.post.render(dt);
  }
}
