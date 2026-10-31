'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Match, PARAMS, PRESETS, W, H, N, GOAL_DEPTH, NP } = require('../sim');

const playing = () => { const m = new Match(); m.setPresent(0, true); m.setPresent(1, true); m.phase = 'playing'; return m; };
// No player influences the wave: walls of height 0 and no wells.
const quiet = (m) => { m.setParam('wallHeight', 0); m.setParam('wellDepth', 0); for (let i = 0; i < NP; i++) m.setStance(i, 1); };
const run = (m, secs) => { for (let k = 0; k < secs * 30; k++) m.step(1 / 30); };
const centroidX = (m) => { let s = 0; for (let i = 0; i < N; i++) s += ((i % W) + 0.5) * (m.R[i] ** 2 + m.I[i] ** 2); return s; };
const total = (m) => { let s = 0; for (let i = 0; i < m.gn; i++) s += m.R[i] ** 2 + m.I[i] ** 2; return s; };

test('total probability stays 1 and nothing blows up', () => {
  const m = playing(); m.setParam('timeScale', 12); m.setParam('wellDepth', 3); m.setParam('wallHeight', 4);
  for (let i = 0; i < 4; i++) m.setStance(i, 2);
  for (let i = 4; i < NP; i++) m.setStance(i, 1);
  m.setOrder(0, 5, 0); m.setOrder(5, -5, 3);
  run(m, 20);
  assert.ok(Math.abs(total(m) - 1) < 1e-9);
  assert.ok(m.R.every(Number.isFinite));
});

test('a kicked packet reflects off the wall and comes back', () => {
  const m = playing(); m.setParam('attenuation', 0); quiet(m);
  m.players[0].x = 44; m.players[0].y = 25; m.setStance(0, 2); // pass from just behind the ball
  run(m, 2);
  m.setStance(0, 1);
  let max = 0, last = 0;
  for (let k = 0; k < 30 * 80; k++) { m.step(1 / 30); const c = centroidX(m); max = Math.max(max, c); last = c; }
  assert.ok(max > 52, 'moved right: ' + max);
  assert.ok(last < max - 1, 'turned back after reflecting');
});

test('an eigenmode is a stationary wave: density stays put', () => {
  const m = playing(); m.setParam('attenuation', 0); quiet(m);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    m.R[y * W + x] = Math.sin(2 * Math.PI * (x + 1) / (W + 1)) * Math.sin(Math.PI * (y + 1) / (H + 1)); m.I[y * W + x] = 0;
  }
  m.normalize();
  const before = Float64Array.from(m.R, (r, i) => r * r + m.I[i] * m.I[i]);
  run(m, 20);
  let err = 0; for (let i = 0; i < N; i++) err = Math.max(err, Math.abs(m.R[i] ** 2 + m.I[i] ** 2 - before[i]));
  assert.ok(err < 0.05 * Math.max(...before), 'max density drift ' + err);
});

test('probability in the right goal above threshold scores for player 0 then resets', () => {
  const m = playing();
  m.R.fill(0); m.I.fill(0);
  for (let y = 20; y < 30; y++) for (let x = W - GOAL_DEPTH; x < W - 1; x++) m.R[y * W + x] = 1;
  m.normalize();
  m.step(1 / 30);
  assert.deepEqual(m.score, [1, 0]);
  assert.equal(m.phase, 'goal');
  run(m, 3);
  assert.equal(m.phase, 'countdown');
  assert.ok(m.goalP[0] < 0.01 && m.goalP[1] < 0.01, 'ball back at centre');
  run(m, 3.5);
  assert.equal(m.phase, 'playing');
});

test('left goal scores for player 1; full time ends then restarts', () => {
  const m = playing();
  m.R.fill(0); m.I.fill(0);
  for (let y = 20; y < 30; y++) for (let x = 1; x < GOAL_DEPTH; x++) m.R[y * W + x] = 1;
  m.normalize(); m.step(1 / 30);
  assert.deepEqual(m.score, [0, 1]);
  const n = playing(); n.setParam('matchSeconds', 30); n.remaining = 0.01; n.step(0.05);
  assert.equal(n.phase, 'over');
  run(n, 11);
  assert.equal(n.phase, 'countdown');
  assert.deepEqual(n.score, [0, 0]);
});

test('match waits for two players and a disconnect resets everything', () => {
  const m = new Match();
  m.setPresent(0, true); assert.equal(m.phase, 'waiting');
  m.setPresent(1, true); assert.equal(m.phase, 'countdown');
  run(m, 3.5); assert.equal(m.phase, 'playing');
  m.score = [2, 1]; m.setPresent(1, false);
  assert.equal(m.phase, 'waiting'); assert.deepEqual(m.score, [0, 0]);
});

test('parameters are clamped and validated', () => {
  const m = playing();
  assert.equal(m.setParam('nope', 1), false);
  assert.equal(m.setParam('mass', NaN), false);
  m.setParam('mass', 99); assert.equal(m.params.mass, 4);
});

test('orders are velocity vectors, capped at max speed, stopped by walls; short orders stop', () => {
  const m = playing(); quiet(m);
  m.setParam('runSpeed', 10);
  const x0 = m.players[0].x;
  m.setOrder(0, 100, 0); assert.equal(m.players[0].vx, 10);
  run(m, 1); assert.ok(Math.abs(m.players[0].x - x0 - 10) < 0.01);
  m.setOrder(0, 0.1, 0.1); assert.deepEqual([m.players[0].vx, m.players[0].vy], [0, 0]);
  assert.deepEqual([m.players[0].hx, m.players[0].hy], [1, 0], 'heading kept when stopped');
  m.setOrder(0, NaN, 0); // ignored
  m.setOrder(0, -3, 4); assert.deepEqual([m.players[0].vx, m.players[0].vy], [-3, 4]);
  m.setParam('runSpeed', 2.5); run(m, 0.1); assert.ok(Math.hypot(m.players[0].vx, m.players[0].vy) <= 2.5 + 1e-9);
  m.setOrder(0, -100, -100); run(m, 30);
  assert.deepEqual([m.players[0].x, m.players[0].y, m.players[0].vx, m.players[0].vy], [0, 0, 0, 0]);
  m.face(0, 0, 5); assert.deepEqual([m.players[0].hx, m.players[0].hy], [0, 1]);
});

test('each team has four players, mirrored at kick-off', () => {
  const m = playing();
  assert.equal(m.players.length, 8);
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(m.players[k].x + m.players[k + 4].x - W) < 1e-9 && m.players[k].y === m.players[k + 4].y);
});

test('snapshot is compact and sane', () => {
  const s = playing().snapshot();
  assert.equal(s.dens.length, N);
  assert.equal(Math.max(...s.dens), 255);
});

test('characteristic length: uniform ball = pitch length, lowest mode 2/3, kick-off packet about half the pitch', () => {
  const m = new Match();
  m.R.fill(1); m.I.fill(0); m.normalize();
  assert.ok(Math.abs(m.characteristicLength() - W) < 1e-6);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.R[y * W + x] = Math.sin(Math.PI * (x + 1) / (W + 1)) * Math.sin(Math.PI * (y + 1) / (H + 1));
  m.normalize();
  assert.ok(Math.abs(m.characteristicLength() - 200 / 3) < 1);
  const k = new Match(); k.kickoff(); // default packet width
  assert.ok(Math.abs(k.characteristicLength() - W / 2) < 3, 'kick-off length ' + k.characteristicLength());
  k.R.fill(0); k.I.fill(0); assert.equal(k.characteristicLength(), 0);
  assert.equal(new Match().snapshot().length > 0, true);
});

test('waves across the width: lowest mode 0.5, a plane wave of 3 wavelengths reads 3', () => {
  const m = new Match();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = 2 * Math.PI * 3 / W; m.R[y * W + x] = Math.cos(k * x); m.I[y * W + x] = Math.sin(k * x); }
  assert.ok(Math.abs(m.wavesAcrossWidth() - 3) < 0.05);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { m.R[y * W + x] = Math.sin(Math.PI * (x + 1) / (W + 1)); m.I[y * W + x] = 0; }
  assert.ok(Math.abs(m.wavesAcrossWidth() - 0.5) < 0.02);
  m.R.fill(0); m.I.fill(0); assert.equal(m.wavesAcrossWidth(), 0);
});

test('additive walls: probability is conserved and a rebound never makes a node at the wall', () => {
  const peakAtWall = (additive) => {
    const m = new Match(); m.setParam('additive', additive); m.setParam('packetWidth', 5); m.setParam('attenuation', 0); m.kickoff();
    m.setPresent(0, true); m.setPresent(1, true); m.phase = 'playing';
    for (let i = 0; i < 8; i++) m.setStance(i, 1);
    m.setParam('wallHeight', 0); m.setParam('wellDepth', 0);
    // give the packet momentum toward the left wall: phase ramp over the whole grid (torus-safe: whole number of waves not needed, ramp is local to the packet)
    for (let y = 0; y < m.gh; y++) for (let x = 0; x < m.gw; x++) {
      const th = -0.35 * (x + 0.5 - W / 2), c = Math.cos(th), s = Math.sin(th), r = m.R[y * m.gw + x], q = m.I[y * m.gw + x];
      m.R[y * m.gw + x] = r * c - q * s; m.I[y * m.gw + x] = r * s + q * c;
    }
    m.normalize();
    let ratio = 0;
    for (let k = 0; k < 30 * 40; k++) {
      m.step(1 / 30);
      const D = m.density(); let max = 0; for (let i = 0; i < N; i++) max = Math.max(max, D[i]);
      assert.ok(Math.abs(D.reduce((a, b) => a + b, 0) - 1) < 1e-6, 'probability conserved');
      ratio = Math.max(ratio, D[25 * W + 0] / max);
    }
    return ratio;
  };
  const coherent = peakAtWall(0), additive = peakAtWall(1);
  assert.ok(coherent < 0.3, 'Dirichlet wall is a node: ' + coherent);
  assert.ok(additive > 0.6, 'additive rebound piles up at the wall: ' + additive);
});

test('additive mode: grid switches at kick-off, players still act, mass and goals still work', () => {
  const m = playing(); m.setParam('additive', 1); assert.equal(m.add, false); m.kickoff(); assert.equal(m.add, true);
  assert.equal(m.gn, 4 * N);
  for (let i = 0; i < 4; i++) m.setStance(i, 2);
  for (let i = 4; i < 8; i++) m.setStance(i, 1);
  m.setParam('timeScale', 12); run(m, 10);
  assert.ok(Math.abs(total(m) - 1) < 1e-9 && m.R.every(Number.isFinite));
  m.setParam('attenuation', 0.5); run(m, 1); // smoothing wraps around on the torus too
  const ln = m.characteristicLength(); assert.ok(ln > 0 && ln <= W);
  m.R.fill(0); m.I.fill(0);
  for (let y = 20; y < 30; y++) for (let x = W - GOAL_DEPTH; x < W - 1; x++) m.R[y * m.gw + x] = 1;
  m.normalize(); m.phase = 'playing'; m.step(1 / 30);
  assert.deepEqual(m.score, [1, 0]);
  m.setParam('additive', 0); m.kickoff(); assert.equal(m.gn, N);
});

test('presets only name real parameters inside their ranges', () => {
  assert.deepEqual(Object.keys(PRESETS), ['default', 'waves', 'additive', 'hybrid']);
  for (const p of Object.values(PRESETS)) for (const [k, v] of Object.entries(p)) assert.ok(PARAMS[k] && v >= PARAMS[k].min && v <= PARAMS[k].max, k);
});
