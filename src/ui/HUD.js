import { HEAT, PACE, SUN } from '../config.js';

const $ = (id) => document.getElementById(id);
const nf = (digits) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const f2 = nf(2), f1 = nf(1), f0 = nf(0);

export const fmt = {
  radii: (v) => f2.format(v),
  int: (v) => f0.format(Math.round(v)),
  one: (v) => f1.format(v),
  time: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
};

// Writes game telemetry into the DOM, touching a node only when its text changes.
export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      depth: $('hud-depth'), score: $('hud-score'), combo: $('hud-combo'),
      speed: $('hud-speed'), shield: $('hud-shield'), corona: $('hud-corona'),
      heat: $('hud-heat'), heatBox: $('hud-heat').closest('.heat'),
      parkerFill: $('hud-parker-fill'), parker: $('hud-parker').closest('.parker'), parkerLabel: $('hud-parker'),
      toasts: $('toasts'),
    };
    this.cache = new Map();
    this.lastCombo = 1;
  }

  set(key, text) {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    this.el[key].textContent = text;
  }

  show(v) { this.root.hidden = !v; }

  update(s) {
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
    this.set('corona', fmt.one(s.corona));
    const shieldC = HEAT.shieldMinC + (HEAT.shieldMaxC - HEAT.shieldMinC) * (s.heat / 100);
    this.set('shield', `${fmt.int(shieldC)} °C`);
    this.el.heat.style.width = `${Math.min(100, s.heat).toFixed(1)}%`;
    this.el.heatBox.classList.toggle('critical', s.heat > 78);

    const progress = (SUN.startRadii - s.radii) / (SUN.startRadii - SUN.parkerRadii);
    this.el.parkerFill.style.width = `${Math.min(1, progress) * 100}%`;
    const passed = s.radii < SUN.parkerRadii;
    this.el.parker.classList.toggle('passed', passed);
    this.set('parkerLabel', passed ? 'Além da Parker' : 'Parker 9,86 R☉');
  }

  toast(text, kind, ms = 1100) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.append(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild.remove();
    setTimeout(() => t.remove(), ms);
  }

  clearToasts() { this.el.toasts.replaceChildren(); }
}
