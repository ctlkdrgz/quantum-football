'use strict';
// Left/right symmetry checks (docs/ASYMMETRY.md): node tools/symmetry.js
// 1. mirrored scripted actors: how far does the density drift from a mirror image?  2. each bot against its own mirror.  3. side bias over a round robin.
const { Match, PRESETS, W, H } = require('../sim');
const bots = require('../bots');

function mirrorError(m) {
  const D = m.density(); let e = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) e = Math.max(e, Math.abs(D[y * W + x] - D[y * W + (W - 1 - x)]));
  return e;
}
function fresh(preset) {
  const m = new Match();
  for (const [k, v] of Object.entries(PRESETS[preset] || {})) m.setParam(k, v);
  m.setPresent(0, true); m.setPresent(1, true); m.kickoff(); m.phase = 'playing'; m.setParam('threshold', 0.9);
  return m;
}

for (const preset of ['default', 'waves', 'additive']) {
  const m = fresh(preset); let worst = 0;
  for (let k = 0; k < 30 * 60; k++) {
    const t = k / 30;
    for (let n = 0; n < 4; n++) {
      const st = [0, 2, 1, 0][(Math.floor(t / 7) + n) % 4 % 3], vx = 6 * Math.cos(t / 3 + n), vy = 5 * Math.sin(t / 4 + n);
      m.setStance(n, st); m.setStance(n + 4, st); m.setOrder(n, vx, vy); m.setOrder(n + 4, -vx, vy);
    }
    m.step(1 / 30); if (k % 15 === 0) worst = Math.max(worst, mirrorError(m));
  }
  console.log('physics, mirrored actors,', preset.padEnd(8), 'max mirror error', worst.toExponential(2));
}
for (const s of Object.keys(bots.STRATEGIES).filter((n) => n !== 'random')) {
  const m = fresh('default'); let first = -1, worst = 0;
  for (let k = 0; k < 30 * 60; k++) { bots.drive(m, [s, s]); m.step(1 / 30); const e = mirrorError(m); if (e > 1e-9 && first < 0) first = k / 30; worst = Math.max(worst, e); }
  console.log(('bot ' + s).padEnd(18), 'against its own mirror: first asymmetry', first < 0 ? 'never' : first.toFixed(2) + ' s', ' max error', worst.toExponential(2));
}
let blue = 0, red = 0; const names = Object.keys(bots.STRATEGIES);
for (const a of names) for (const b of names) {
  const m = new Match(); m.setPresent(0, true); m.setPresent(1, true); m.kickoff(); m.phase = 'playing';
  for (let k = 0; k < 30 * 90 && m.phase !== 'over'; k++) { bots.drive(m, [a, b]); m.step(1 / 30); }
  blue += m.score[0]; red += m.score[1];
}
console.log('round robin, 49 matches of 90 s: blue', blue, 'red', red, 'bias', ((blue - red) / (blue + red)).toFixed(2));
