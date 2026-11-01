'use strict';
// Reads a game log (gamelog.js) back.
//   node tools/postmortem.js [log]            summary: setup, timeline of events (commands counted, not listed), goals, the ball every 5 s
//   node tools/postmortem.js [log] --csv      one row per frame: clock, score, goal probabilities, ball moments, the eight players
//   node tools/postmortem.js [log] --at 42.5  the pitch at t = 42.5 s (nearest density record): ball as shades, players as 0-7
//   node tools/postmortem.js [log] --events   every event, commands included
// Without a log: the newest file in logs/.
const fs = require('fs');
const path = require('path');

function load(file) {
  const out = { head: null, ev: [], f: [], dens: [] };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; } // a server killed mid-write leaves a torn last line
    if (r.k === 'head') out.head = r; else if (out[r.k]) out[r.k].push(r);
  }
  return out;
}

const COMMANDS = new Set(['order', 'move', 'stance']);
const fmt = (t) => t.toFixed(1).padStart(7) + ' s';

function summary(L) {
  const h = L.head, lines = [];
  lines.push('start ' + h.start + '  build ' + h.build + '  preset ' + h.preset + '  bots ' + JSON.stringify(h.bots));
  lines.push('params ' + JSON.stringify(h.params));
  const last = L.f[L.f.length - 1];
  lines.push(L.f.length + ' frames, ' + L.dens.length + ' density records, ' + (last ? last.t.toFixed(1) + ' s, final score ' + last.score.join('-') : 'no play'));
  const counts = {};
  lines.push('', 'events:');
  for (const e of L.ev) {
    if (COMMANDS.has(e.e)) { counts[e.by + ' ' + e.e] = (counts[e.by + ' ' + e.e] || 0) + 1; continue; }
    const { k, t, e: name, ...rest } = e;
    lines.push(fmt(t) + '  ' + name + ' ' + JSON.stringify(rest));
  }
  if (Object.keys(counts).length) lines.push('', 'commands: ' + Object.entries(counts).map(([k, n]) => k + ' x' + n).join(', '));
  lines.push('', 'ball every 5 s (t, phase, mean x y, sd x y, goal probabilities L R):');
  let next = 0;
  for (const f of L.f) {
    if (f.t < next) continue;
    next = f.t + 5;
    const b = f.ball || {};
    lines.push(fmt(f.t) + '  ' + f.phase.padEnd(9) + ' (' + b.x + ', ' + b.y + ')  sd (' + b.sx + ', ' + b.sy + ')  P ' + f.goalP.join(' '));
  }
  return lines.join('\n');
}

function csv(L) {
  const cols = ['t', 'dt', 'phase', 'remaining', 'score0', 'score1', 'goalL', 'goalR', 'bx', 'by', 'bsx', 'bsy', 'bcxy', 'bpx', 'bpy', 'bpeak'];
  for (let i = 0; i < 8; i++) for (const c of ['x', 'y', 'hx', 'hy', 'vx', 'vy', 'stance']) cols.push('p' + i + c);
  const rows = [cols.join(',')];
  for (const f of L.f) {
    const b = f.ball || {};
    rows.push([f.t, f.dt, f.phase, f.remaining, ...f.score, ...f.goalP, b.x, b.y, b.sx, b.sy, b.cxy, b.px, b.py, b.peak, ...f.players.flat()].join(','));
  }
  return rows.join('\n');
}

// One character per 2 x 2 m (density shades), players drawn on top as their index 0-7 (team 0 = 0-3, attacking right).
function at(L, t) {
  const W = L.head.W, H = L.head.H, near = (a) => a.reduce((b, r) => (Math.abs(r.t - t) < Math.abs(b.t - t) ? r : b));
  if (!L.dens.length) return 'no density record';
  const d = near(L.dens), f = L.f.length ? near(L.f) : null, D = Buffer.from(d.d, 'base64'), shade = ' .:-=+*#%@';
  const grid = [];
  for (let y = 0; y < H; y += 2) {
    let row = '';
    for (let x = 0; x < W; x += 2) { const v = Math.max(D[y * W + x], D[y * W + x + 1], D[(y + 1) * W + x], D[(y + 1) * W + x + 1]); row += shade[Math.min(9, Math.floor(v / 25.6))]; }
    grid.push(row.split(''));
  }
  if (f) f.players.forEach(([x, y], i) => { grid[Math.min(grid.length - 1, Math.floor(y / 2))][Math.min(W / 2 - 1, Math.floor(x / 2))] = String(i); });
  const head = 'density at t = ' + d.t + ' s' + (f ? ', players at t = ' + f.t + ' s, ' + f.phase + ', score ' + f.score.join('-') + ', remaining ' + f.remaining + ' s' : '');
  return [head, '+' + '-'.repeat(W / 2) + '+', ...grid.map((r) => '|' + r.join('') + '|'), '+' + '-'.repeat(W / 2) + '+'].join('\n');
}

function newest(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort() : [];
  if (!files.length) throw new Error('no game log in ' + dir);
  return path.join(dir, files[files.length - 1]);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args[0] && !args[0].startsWith('--') ? args.shift() : newest(path.join(__dirname, '..', 'logs'));
  const L = load(file);
  if (!L.head) throw new Error(file + ': not a game log (no head line)');
  const mode = args[0];
  console.log(mode === '--csv' ? csv(L) : mode === '--at' ? at(L, Number(args[1])) : mode === '--events' ? L.ev.map((e) => JSON.stringify(e)).join('\n') : file + '\n' + summary(L));
}
module.exports = { load, summary, csv, at };
