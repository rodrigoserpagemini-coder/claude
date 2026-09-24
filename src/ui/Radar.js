import { WORLD } from '../config.js';

const COLORS = {
  hazard: [255, 106, 26],
  danger: [255, 59, 59],
  coolant: [92, 242, 255],
  cell: [181, 140, 255],
  grid: 'rgba(247,235,219,0.14)',
  probe: '#f7ebdb',
};

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

// Forward-looking scope: the tunnel's cross-section seen from behind the
// probe, with everything in the next `range` units projected onto it.
// Nearer objects draw brighter and thicker; a hazard that would hit the
// probe on its current line turns red. Shared by the HUD and the cockpit.
export function drawRadar(ctx, cx, cy, radius, items, probe, time, opts = {}) {
  const range = opts.range ?? WORLD.radarRange;
  const R = WORLD.tunnelRadius;
  const k = radius / R;
  const X = (x) => cx + x * k;
  const Y = (y) => cy - y * k;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = opts.background ?? 'rgba(11,5,7,0.72)';
  ctx.fill();
  ctx.clip();

  // Range rings, crosshair and the flyable disc.
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (const f of [0.33, 0.66]) {
    ctx.beginPath(); ctx.arc(cx, cy, radius * f, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
  ctx.stroke();
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(cx, cy, WORLD.moveRadius * k, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // Sweep.
  const sweep = (time * 1.6) % (Math.PI * 2);
  const grad = ctx.createConicGradient ? ctx.createConicGradient(sweep, cx, cy) : null;
  if (grad) {
    grad.addColorStop(0, 'rgba(255,200,87,0.22)');
    grad.addColorStop(0.12, 'rgba(255,200,87,0)');
    grad.addColorStop(1, 'rgba(255,200,87,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  // Far objects first so near ones sit on top.
  const visible = items.filter((it) => !it.checked && it.obj.visible && it.z < 0 && it.z > -range)
    .sort((a, b) => a.z - b.z);
  ctx.lineCap = 'round';
  for (const it of visible) {
    const near = 1 - -it.z / range;             // 0 far → 1 at the probe
    const a = 0.25 + near * 0.75;
    const lw = (0.8 + near * 2.6) * (radius / 70);
    const danger = it.dist && near > 0.55 && it.dist(probe.x, probe.y) < WORLD.probeRadius + 0.15;
    const col = danger ? COLORS.danger : COLORS.hazard;
    ctx.strokeStyle = rgba(col, a);
    ctx.fillStyle = rgba(col, a);
    ctx.lineWidth = lw;
    switch (it.kind) {
      case 'arc': {
        const { radius: r, phi, arc } = it.radar;
        ctx.beginPath();
        // Canvas y points down, so angles run clockwise: negate them.
        ctx.arc(cx, cy, r * k, -phi, -(phi + arc), true);
        ctx.stroke();
        break;
      }
      case 'filament': {
        const { ax, ay, bx, by } = it.radar;
        ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); ctx.stroke();
        break;
      }
      case 'spicules':
        ctx.beginPath();
        for (const [ax, ay, bx, by] of it.radar.segs) { ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); }
        ctx.stroke();
        break;
      case 'plasmoid':
        ctx.beginPath();
        ctx.arc(X(it.mesh.position.x), Y(it.mesh.position.y), it.r * k, 0, Math.PI * 2);
        ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1;
        ctx.stroke();
        break;
      case 'crystal':
      case 'cell': {
        const c = it.kind === 'crystal' ? COLORS.coolant : COLORS.cell;
        const s = (2.5 + near * 3.5) * (radius / 70);
        ctx.fillStyle = rgba(c, a);
        ctx.beginPath();
        ctx.moveTo(X(it.x), Y(it.y) - s); ctx.lineTo(X(it.x) + s, Y(it.y));
        ctx.lineTo(X(it.x), Y(it.y) + s); ctx.lineTo(X(it.x) - s, Y(it.y));
        ctx.closePath(); ctx.fill();
        break;
      }
    }
  }

  // The probe.
  const px = X(probe.x), py = Y(probe.y), s = radius / 18;
  ctx.strokeStyle = COLORS.probe;
  ctx.lineWidth = Math.max(1, radius / 60);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const fx = px + Math.cos(a) * s, fy = py + Math.sin(a) * s;
    if (i === 0) ctx.moveTo(fx, fy); else ctx.lineTo(fx, fy);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Tunnel wall.
  ctx.strokeStyle = 'rgba(255,200,87,0.5)';
  ctx.lineWidth = Math.max(1, radius / 45);
  ctx.beginPath(); ctx.arc(cx, cy, radius - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
}
