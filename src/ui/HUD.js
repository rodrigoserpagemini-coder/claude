import { ENERGY, HEAT, PACE, SUN, ZONES } from '../config.js';
import { drawRadar } from './Radar.js';

const $ = (id) => document.getElementById(id);
const nf = (digits) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const f2 = nf(2), f1 = nf(1), f0 = nf(0);

export const fmt = {
  radii: (v) => f2.format(v),
  int: (v) => f0.format(Math.round(v)),
  one: (v) => f1.format(v),
  time: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
};

const ZONE_COLORS = ['#7a3a1c', '#c2461a', '#ff9a2e', '#ff2e5a'];
// Dive-map scale: 20 R☉ at the top, 1 R☉ at the bottom.
const mapPos = (radii) => ((SUN.startRadii - radii) / (SUN.startRadii - 1)) * 100;

// Writes game telemetry into the DOM, touching a node only when its text changes.
export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      depth: $('hud-depth'), score: $('hud-score'), combo: $('hud-combo'),
      speed: $('hud-speed'), shield: $('hud-shield'), sun: $('hud-sun'), zone: $('hud-zone'),
      heat: $('hud-heat'), heatBox: $('hud-heat').closest('.meter'),
      energy: $('hud-energy'), energyBar: $('hud-energy-bar'), energyBox: $('hud-energy-bar').closest('.meter'),
      parkerFill: $('hud-parker-fill'), parker: $('hud-parker').closest('.parker'), parkerLabel: $('hud-parker'),
      toasts: $('toasts'), storm: $('storm'), stormSub: $('storm-sub'),
    };
    this.radar = $('radar');
    this.radarCtx = this.radar.getContext('2d');
    this.radarIn = 0;
    this.cache = new Map();
    this.lastCombo = 1;
    this.buildMap();
  }

  buildMap() {
    const track = $('divemap-track');
    this.mapLabels = [];
    ZONES.forEach((z, i) => {
      const top = mapPos(z.from);
      const bottom = i + 1 < ZONES.length ? mapPos(ZONES[i + 1].from) : 100;
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.style.top = `${top}%`;
      seg.style.height = `${bottom - top}%`;
      seg.style.background = ZONE_COLORS[i];
      const label = document.createElement('div');
      label.className = 'seg-label';
      label.style.top = `${top}%`;
      label.textContent = `${z.name} · ${z.from}`;
      track.append(seg, label);
      this.mapLabels.push(label);
    });
    const parker = document.createElement('div');
    parker.className = 'mark';
    parker.style.top = `${mapPos(SUN.parkerRadii)}%`;
    parker.innerHTML = '<span>Parker 9,86</span>';
    this.bestMark = document.createElement('div');
    this.bestMark.className = 'mark best';
    this.bestMark.hidden = true;
    this.bestMark.innerHTML = '<span>Recorde</span>';
    this.you = document.createElement('div');
    this.you.className = 'you';
    track.append(parker, this.bestMark, this.you);
  }

  setBest(radii) {
    this.bestMark.hidden = !radii;
    if (radii) {
      this.bestMark.style.top = `${mapPos(radii)}%`;
      // Keep the label clear of the Parker marker.
      this.bestMark.firstChild.style.top = Math.abs(radii - SUN.parkerRadii) < 1 ? '6px' : '-6px';
    }
  }

  set(key, text) {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    this.el[key].textContent = text;
  }

  show(v) { this.root.hidden = !v; }
  setCockpit(v) { this.root.classList.toggle('cockpit', v); }

  update(s, dt) {
    this.set('depth', fmt.radii(s.radii));
    this.set('score', fmt.int(s.score));
    this.set('combo', `×${s.combo}`);
    if (s.combo !== this.lastCombo) {
      this.el.combo.classList.remove('pop');
      void this.el.combo.offsetWidth;
      if (s.combo > this.lastCombo) this.el.combo.classList.add('pop');
      this.lastCombo = s.combo;
    }
    this.set('speed', fmt.int(s.speed * PACE.kmPerUnit));
    this.set('sun', fmt.int(s.sunlight));
    this.set('zone', ZONES[s.zone].name);
    this.mapLabels.forEach((l, i) => l.classList.toggle('active', i === s.zone));

    const shieldC = HEAT.shieldMinC + (HEAT.shieldMaxC - HEAT.shieldMinC) * (s.heat / 100);
    this.set('shield', `${fmt.int(shieldC)} °C`);
    this.el.heat.style.width = `${Math.min(100, s.heat).toFixed(1)}%`;
    this.el.heatBox.classList.toggle('critical', s.heat > 78);

    this.set('energy', `${fmt.int(s.energy)}%`);
    this.el.energyBar.style.width = `${s.energy.toFixed(1)}%`;
    this.el.energyBox.classList.toggle('ready', s.energy >= ENERGY.shieldCost);
    this.el.energyBox.classList.toggle('boosting', s.boosting);

    const progress = (SUN.startRadii - s.radii) / (SUN.startRadii - SUN.parkerRadii);
    this.el.parkerFill.style.width = `${Math.min(1, progress) * 100}%`;
    const passed = s.radii < SUN.parkerRadii;
    this.el.parker.classList.toggle('passed', passed);
    this.set('parkerLabel', passed ? 'Além da Parker' : 'Parker 9,86 R☉');
    this.you.style.top = `${mapPos(s.radii)}%`;

    // Storm banner.
    this.el.storm.hidden = !s.stormWarn && !s.storm;
    this.el.storm.classList.toggle('active', s.storm);
    this.set('stormSub', s.storm ? `Tempestade · ${Math.ceil(s.stormLeft)} s restantes` : `Impacto em ${Math.ceil(s.stormLeft)} s · procure a brecha`);

    // Radar at ~20 fps.
    this.radarIn -= dt;
    if (!s.cockpit && this.radarIn <= 0) {
      this.radarIn = 0.05;
      const c = this.radarCtx, w = this.radar.width;
      c.clearRect(0, 0, w, w);
      drawRadar(c, w / 2, w / 2, w / 2 - 4, s.items, s.probe, s.time);
    }
  }

  toast(text, kind, ms = 1100, sub = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      t.append(small);
    }
    t.style.animationDuration = `${ms}ms`;
    this.el.toasts.append(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild.remove();
    setTimeout(() => t.remove(), ms);
  }

  clearToasts() { this.el.toasts.replaceChildren(); }
}
