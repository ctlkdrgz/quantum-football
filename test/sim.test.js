'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Match, PARAMS, PRESETS, STANCE, W, H, N, GOAL_DEPTH, NP } = require('../sim');
const { DEFENSE, PASS, SHOT, DRIBBLE } = STANCE;

const playing = () => { const m = new Match(); m.setPresent(0, true); m.setPresent(1, true); m.phase = 'playing'; return m; };
// No player influences the wave: Dribble (no kick), no well, a catch that absorbs nothing (so it changes nothing).
const quiet = (m) => { m.setParam('wellDepth', 0); m.setParam('absorbMean', 0); m.setParam('absorbSpread', 0); for (let i = 0; i < NP; i++) m.setStance(i, DRIBBLE); };
// Mean momentum of the wave (the total probability current, rad/m), coherent grid.
const current = (m) => { let jx = 0, jy = 0; for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; jx += m.R[i] * (m.I[i + 1] - m.I[i - 1]) / 2 - m.I[i] * (m.R[i + 1] - m.R[i - 1]) / 2; jy += m.R[i] * (m.I[i + W] - m.I[i - W]) / 2 - m.I[i] * (m.R[i + W] - m.R[i - W]) / 2; } return { jx, jy }; };
const run = (m, secs) => { for (let k = 0; k < secs * 30; k++) m.step(1 / 30); };
const centroidX = (m) => { let s = 0; for (let i = 0; i < N; i++) s += ((i % W) + 0.5) * (m.R[i] ** 2 + m.I[i] ** 2); return s; };
const total = (m) => { let s = 0; for (let i = 0; i < m.gn; i++) s += m.R[i] ** 2 + m.I[i] ** 2; return s; };

test('total probability stays 1 (within the renormalisation tolerance) and nothing blows up', () => {
  const m = playing(); m.setParam('timeScale', 30); m.setParam('wellDepth', 3); m.setParam('absorbMean', 1); m.setParam('kickSpeed', 40);
  for (let i = 0; i < 4; i++) m.setStance(i, PASS);
  for (let i = 4; i < NP; i++) m.setStance(i, DEFENSE);
  m.setOrder(0, 5, 0); m.setOrder(5, -5, 3);
  for (let k = 0; k < 30 * 20; k++) { m.step(1 / 30); assert.ok(Math.abs(total(m) - 1) < 0.006, 'total ' + total(m)); }
  assert.ok(m.R.every(Number.isFinite));
});

test('a kicked packet reflects off the wall and comes back', () => {
  const m = playing(); m.setParam('attenuation', 0); m.setParam('threshold', 0.9); quiet(m);
  m.players[0].x = 45.5; m.players[0].y = 25; m.setStance(0, SHOT); // shot from just behind the ball (its zone centred on it)
  run(m, 2);
  m.setStance(0, DRIBBLE);
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

test('left goal scores for player 1; the match never ends', () => {
  const m = playing();
  m.R.fill(0); m.I.fill(0);
  for (let y = 20; y < 30; y++) for (let x = 1; x < GOAL_DEPTH; x++) m.R[y * W + x] = 1;
  m.normalize(); m.step(1 / 30);
  assert.deepEqual(m.score, [0, 1]);
  const n = playing(); n.clock = 3600; n.step(0.05);
  assert.equal(n.phase, 'playing');
  assert.ok(n.clock > 3600, 'the clock counts up');
  assert.equal(n.setParam('matchSeconds', 30), false, 'no match duration any more');
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

test('move orders: run to the spot at max speed and stop; queued waypoints follow in order; a velocity order cancels the path', () => {
  const m = playing(); quiet(m); m.setParam('runSpeed', 10);
  Object.assign(m.players[0], { x: 10, y: 10 });
  m.moveTo(0, 30, 10); run(m, 1);
  assert.ok(Math.abs(m.players[0].x - 20) < 0.01 && m.players[0].vx === 10, 'full speed ' + m.players[0].x);
  run(m, 1.5);
  assert.deepEqual([m.players[0].x, m.players[0].y, m.players[0].vx, m.players[0].vy, m.players[0].path.length], [30, 10, 0, 0, 0], 'stops exactly there');
  m.moveTo(0, 40, 10); m.moveTo(0, 40, 30, true); m.moveTo(0, 40, 30.1, true); // the last one is within 0.5 m of the previous end: ignored
  assert.equal(m.players[0].path.length, 2);
  run(m, 1.5); assert.ok(m.players[0].x === 40 && m.players[0].y > 10 && m.players[0].y < 16, 'turned toward the second waypoint ' + m.players[0].y);
  assert.deepEqual([m.players[0].hx, m.players[0].hy], [0, 1], 'heading follows the move');
  run(m, 3); assert.deepEqual([m.players[0].x, m.players[0].y, m.players[0].path.length], [40, 30, 0]);
  m.moveTo(0, 5, 5); m.moveTo(0, 5, 5.2); m.setOrder(0, 3, 0); assert.equal(m.players[0].path.length, 0);
  m.moveTo(0, -50, 999); assert.deepEqual(m.players[0].path, [{ x: 0, y: H }], 'clamped to the pitch');
  Object.assign(m.players[0], { x: 40, y: 30 }); m.moveTo(0, 40, 30.2); assert.equal(m.players[0].path.length, 0, 'moving to where it already is is a stop');
});

test('each team has four players, mirrored at kick-off', () => {
  const m = playing();
  assert.equal(m.players.length, 8);
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(m.players[k].x + m.players[k + 4].x - W) < 1e-9 && m.players[k].y === m.players[k + 4].y);
});

test('the kick-off ball is small by default and the slider resizes it before the game starts', () => {
  const m = new Match();
  assert.equal(m.params.packetWidth, 4);
  const small = m.characteristicLength();
  assert.ok(small < 20, 'default length ' + small);
  m.setParam('packetWidth', 10); // phase 'waiting': kicked off again with the new width
  assert.ok(m.characteristicLength() > small * 2);
  m.setParam('packetWidth', 1); assert.equal(m.params.packetWidth, 1);
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
  const k = new Match(); k.setParam('packetWidth', 14); k.kickoff();
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
    for (let i = 0; i < 8; i++) m.setStance(i, DRIBBLE);
    quiet(m);
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
      assert.ok(Math.abs(D.reduce((a, b) => a + b, 0) - 1) < 0.006, 'probability conserved (within the renormalisation tolerance)');
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
  for (let i = 0; i < 4; i++) m.setStance(i, PASS);
  for (let i = 4; i < 8; i++) m.setStance(i, DEFENSE);
  m.setParam('threshold', 0.9); run(m, 10);
  assert.ok(Math.abs(total(m) - 1) < 0.006 && m.R.every(Number.isFinite));
  m.setParam('attenuation', 0.5); run(m, 1); m.setParam('threshold', 0.1); // smoothing wraps around on the torus too
  const ln = m.characteristicLength(); assert.ok(ln > 0 && ln <= W);
  m.R.fill(0); m.I.fill(0);
  for (let y = 20; y < 30; y++) for (let x = W - GOAL_DEPTH; x < W - 1; x++) m.R[y * m.gw + x] = 1;
  m.normalize(); m.phase = 'playing'; m.step(1 / 30);
  assert.deepEqual(m.score, [1, 0]);
  m.setParam('additive', 0); m.kickoff(); assert.equal(m.gn, N);
});

test('presets only name real parameters inside their ranges', () => {
  assert.deepEqual(Object.keys(PRESETS), ['default', 'additive']);
  for (const p of Object.values(PRESETS)) for (const [k, v] of Object.entries(p)) assert.ok(PARAMS[k] && v >= PARAMS[k].min && v <= PARAMS[k].max, k);
});

// ---- stances and aiming ---------------------------------------------------------------------------------------
const park = (m) => { for (let i = 0; i < NP; i++) { m.players[i].x = i < 4 ? 3 : W - 3; m.players[i].y = 3 + 4 * (i % 4); m.setStance(i, DRIBBLE); m.players[i].hx = i < 4 ? -1 : 1; m.players[i].hy = 0; } };
const place = (m, i, x, y, extra = {}) => Object.assign(m.players[i], { x, y, vx: 0, vy: 0, hx: 1, hy: 0 }, extra);

test('aims: Defense clears along the heading, Shot goes to the goal centre (heading ignored with auto-aim), Dribble does not kick', () => {
  const m = playing(); park(m);
  place(m, 0, 40, 25, { hx: 0, hy: -1 });
  m.setStance(0, DEFENSE); const d = m.aims(0);
  assert.equal(d.length, 1); assert.deepEqual([d[0].dx, d[0].dy, d[0].w], [0, -1, 1]);
  m.setStance(0, SHOT); const s = m.aims(0);
  assert.ok(s.length === 1 && s[0].dx > 0.99 && Math.abs(s[0].dy) < 0.05 && s[0].tx === W && s[0].ty === H / 2, JSON.stringify(s));
  m.setParam('autoAim', 0); assert.deepEqual([m.aims(0)[0].dx, m.aims(0)[0].dy], [0, -1], 'without auto-aim a shot follows the heading');
  m.setStance(0, DRIBBLE); assert.deepEqual(m.aims(0), []);
  const n = playing(); park(n); place(n, 4, 70, 25); n.setStance(4, SHOT);
  assert.ok(n.aims(4)[0].dx < -0.99 && n.aims(4)[0].tx === 0, 'team 1 shoots at the left goal');
});

test('aims: a pass goes to every ally, weighted by the distance from our own goal line (team 0 from x = 0, team 1 from x = W)', () => {
  const m = playing(); park(m);
  place(m, 0, 40, 25); place(m, 1, 70, 25); place(m, 2, 30, 10); place(m, 3, 10, 40); m.setStance(0, PASS);
  const a = m.aims(0);
  assert.equal(a.length, 3);
  const weights = [71, 31, 11], sum = 113; // 1 + x of the allies
  a.forEach((t, k) => assert.ok(Math.abs(t.w - weights[k] / sum) < 1e-9, 'weight ' + k + ' ' + t.w));
  assert.ok(Math.abs(a.reduce((x, t) => x + t.w, 0) - 1) < 1e-9);
  const n = playing(); park(n); place(n, 4, 60, 25); place(n, 5, 30, 25); place(n, 6, 90, 25); place(n, 7, 95, 5); n.setStance(4, PASS);
  const b = n.aims(4); // team 1 attacks left: the ally at x = 30 is the most advanced
  assert.ok(b[0].w > b[1].w && b[1].w > b[2].w && b[0].w > 0.7, b.map((t) => t.w.toFixed(2)).join(' '));
  m.setParam('autoAim', 0); place(m, 0, 40, 25, { hx: 0, hy: 1 });
  assert.deepEqual(m.aims(0).map((t) => [t.dx, t.dy, t.w]), [[0, 1, 1]], 'without auto-aim: one pass along the heading');
});

test('aims: pass targets lead a running ally; allies within 2 m are skipped; with nobody to pass to it goes to the goal', () => {
  const m = playing(); park(m);
  place(m, 0, 30, 25); place(m, 1, 60, 10, { vx: 8, vy: 0 }); m.setStance(0, PASS);
  const a = m.aims(0)[0];
  assert.ok(a.tx > 62 && Math.abs(a.ty - 10) < 1, 'target ' + a.tx + ',' + a.ty); // beyond where he stands now
  const n = playing(); park(n); place(n, 0, 30, 25); place(n, 1, 31, 25); place(n, 2, 30, 26); place(n, 3, 29, 25); n.setStance(0, PASS);
  const g = n.aims(0);
  assert.ok(g.length === 1 && g[0].tx === W && g[0].ty === H / 2, 'nobody to pass to: the goal ' + JSON.stringify(g));
});

// The passer stands 1 reach (4.5 m) behind the kick-off ball, so its zone is centred on it; allies 2 and 3 stand on the passer's spot (within 2 m: not receivers).
// Wells off: a Dribble well under the ball would make it oscillate in place.
const passer = (m, ally2) => { m.kickoff(); park(m); m.setParam('threshold', 0.9); m.setParam('wellDepth', 0); place(m, 0, 45.5, 25); place(m, 1, 80, 8); place(m, 2, ally2 ? 80 : 45.5, ally2 ? 42 : 25); place(m, 3, 45.5, 25); };

test('Pass kicks the caught share toward the ally (mean momentum along the aim); two allies split it evenly', () => {
  const one = playing(); passer(one, false); one.setStance(0, PASS); run(one, 1.5);
  const j = current(one), aim = one.aims(0)[0];
  assert.ok(j.jx > 0.05 && Math.abs(j.jy / j.jx - aim.dy / aim.dx) < 0.1, `momentum along the aim: ${j.jx} ${j.jy} vs ${aim.dx} ${aim.dy}`);
  // two allies: no net sideways momentum, and the extra density (over a pass of speed 0) toward each ally is about the same
  const wedges = (kick) => { const m = playing(); passer(m, true); m.setParam('kickSpeed', kick); m.setStance(0, PASS); run(m, 1.5);
    const D = m.density(); let up = 0, down = 0; for (let y = 0; y < H; y++) for (let x = 60; x < 85; x++) { if (y < 18) up += D[y * W + x]; else if (y >= 32) down += D[y * W + x]; }
    return { up, down, j: current(m) }; };
  const two = wedges(PARAMS.kickSpeed.def), base = wedges(0), up = two.up - base.up, down = two.down - base.down;
  assert.ok(Math.abs(two.j.jy) < 0.1 * two.j.jx, 'no net sideways momentum ' + JSON.stringify(two.j));
  assert.ok(up > 0.005 && down > 0.005 && Math.abs(up - down) < 0.3 * up, `both allies get a share: ${up} / ${down}`);
});

test('Dribble keeps the wave with the player (no kick); Shot kicks it away hard, Pass less, Defense clears it', () => {
  const right = (stance) => { // mass in the last 38 m after 1 s in the stance and 1 s more
    const m = playing(); park(m); m.setParam('threshold', 0.9);
    place(m, 0, 45.5, 25); place(m, 1, 80, 25); m.setStance(0, stance); run(m, 1); m.setStance(0, DRIBBLE); run(m, 1);
    const D = m.density(); let s = 0; for (let i = 0; i < N; i++) if (i % W >= 62) s += D[i];
    return s;
  };
  const dribble = right(DRIBBLE), pass = right(PASS), shot = right(SHOT), defense = right(DEFENSE);
  assert.ok(dribble < 0.1, 'no kick: ' + dribble);
  assert.ok(pass > dribble + 0.03 && shot > pass + 0.05 && defense > dribble + 0.05, `dribble ${dribble} pass ${pass} shot ${shot} defense ${defense}`);
});

test('Defense catches over a wide zone: 1.5 x the radius, centred 1.5 x the reach ahead; only Dribble has a well', () => {
  const m = playing(); park(m); place(m, 0, 40, 25);
  const snap = (st) => { m.setStance(0, st); m.buildPotential(); return m.V[25 * W + 40 + 4]; };
  assert.equal(snap(PASS), 0); assert.equal(snap(SHOT), 0); assert.equal(snap(DEFENSE), 0);
  assert.ok(snap(DRIBBLE) < -0.4, 'the Dribble well is under its zone centre');
  // a ball 10 m ahead is in the Defense zone (centre 6.75 m ahead, radius 6.75) but not in the Pass zone (centre 4.5, radius 4.5)
  m.R.fill(0); m.I.fill(0); m.R[25 * W + 50] = 1;
  m.setStance(0, DEFENSE); const d = m.snapshot().presence[0]; m.setStance(0, PASS); const p = m.snapshot().presence[0];
  assert.ok(d > 0.3 && p === 0, `presence: Defense ${d}, Pass ${p}`);
});

test('aim: kicks follow the aim, not the heading: a shot facing up still sends the ball toward the goal', () => {
  const kick = (autoAim) => { // the player faces up, its zone centred on the ball
    const m = playing(); park(m); m.setParam('autoAim', autoAim); m.setParam('threshold', 0.9);
    place(m, 0, 50, 29.5, { hx: 0, hy: -1 }); m.setStance(0, SHOT); run(m, 0.5);
    return current(m);
  };
  const on = kick(1), off = kick(0);
  assert.ok(on.jx > 0.05 && Math.abs(on.jy) < 0.3 * on.jx, 'auto-aim goes right ' + JSON.stringify(on));
  assert.ok(off.jy < -0.05 && Math.abs(off.jx) < 0.3 * -off.jy, 'heading up went up ' + JSON.stringify(off));
});

test('catch: a fast ball crossing a zone is caught much less than a slow one (a Shot zone barely touches it)', () => {
  const moved = (v) => { // a ball crossing a Shot zone sideways at speed v: how much momentum does the kick add along x?
    const m = playing(); m.kickoff(); park(m); m.setParam('threshold', 0.9); m.setParam('attenuation', 0);
    const k = v * m.params.mass / m.params.timeScale;
    for (let i = 0; i < m.gn; i++) { const y = Math.floor(i / m.gw), th = k * (y + 0.5 - 25), c = Math.cos(th), sn = Math.sin(th), r = m.R[i], q = m.I[i]; m.R[i] = r * c - q * sn; m.I[i] = r * sn + q * c; }
    place(m, 0, 45.5, 25); m.setParam('autoAim', 0); m.setStance(0, SHOT); run(m, 0.5);
    return current(m).jx;
  };
  const slow = moved(2), fast = moved(30);
  assert.ok(slow > 0.05 && fast < 0.25 * slow, `kick momentum: slow ball ${slow}, fast ball ${fast}`);
});

test('catch: two balls meeting head-on in a zone are both fast, so little is caught (the mean momentum, 0, does not count)', () => {
  const kicked = (v) => {
    const m = playing(); m.kickoff(); park(m); m.setParam('threshold', 0.9); m.setParam('attenuation', 0);
    const k = v * m.params.mass / m.params.timeScale;
    for (let i = 0; i < m.gn; i++) m.R[i] *= Math.cos(k * (Math.floor(i / m.gw) + 0.5 - 25)); // a standing wave along y: +k and -k
    m.normalize(); place(m, 0, 45.5, 25); m.setParam('autoAim', 0); m.setStance(0, SHOT); run(m, 0.5);
    return current(m).jx;
  };
  const still = kicked(0), clash = kicked(30);
  assert.ok(clash < 0.25 * still, `kick momentum: still ball ${still}, head-on pair ${clash}`);
});

// ---- left/right symmetry ----------------------------------------------------------------------------------------
const mirrorError = (m) => { const D = m.density(); let e = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) e = Math.max(e, Math.abs(D[y * W + x] - D[y * W + (W - 1 - x)])); return e; };

test('symmetry [asymmetry fix]: mirrored actors keep the density a mirror image, in every stance and wall mode', () => {
  for (const additive of [0, 1]) for (const stance of [DEFENSE, PASS, SHOT, DRIBBLE]) {
    const m = playing(); m.setParam('additive', additive); m.kickoff(); m.setParam('threshold', 0.9);
    let worst = 0;
    for (let k = 0; k < 30 * 8; k++) {
      const t = k / 30;
      for (let n = 0; n < 4; n++) {
        const vx = 6 * Math.cos(t / 3 + n), vy = 5 * Math.sin(t / 4 + n);
        m.setStance(n, stance); m.setStance(n + 4, stance); m.setOrder(n, vx, vy); m.setOrder(n + 4, -vx, vy);
      }
      m.step(1 / 30); worst = Math.max(worst, mirrorError(m));
    }
    assert.ok(worst < 1e-10, `additive ${additive} stance ${stance}: ${worst}`);
  }
});

test('symmetry [asymmetry fix]: forBox covers exactly the cells whose centre is within the radius (same count mirrored)', () => {
  const m = new Match();
  for (const cx of [15, 15.3, 40.5]) {
    const count = (x) => { let n = 0, minDx = 1e9, maxDx = -1e9; m.forBox(x, 25.2, 19.2, (i, dx) => { n++; minDx = Math.min(minDx, dx); maxDx = Math.max(maxDx, dx); }); return { n, minDx, maxDx }; };
    const a = count(cx), b = count(W - cx);
    assert.equal(a.n, b.n); assert.ok(Math.abs(a.minDx + b.maxDx) < 1e-9 && Math.abs(a.maxDx + b.minDx) < 1e-9, 'mirrored extents');
  }
});

test('symmetry [asymmetry fix]: a simultaneous tie goes to the team behind, not always to team 0', () => {
  const both = () => { const m = playing(); m.R.fill(0); m.I.fill(0); for (let y = 20; y < 30; y++) for (let x = 1; x < GOAL_DEPTH; x++) { m.R[y * W + x] = 1; m.R[y * W + (W - 1 - x)] = 1; } m.normalize(); return m; };
  const m = both(); m.step(1 / 30); assert.deepEqual(m.score, [1, 0], 'equal scores: team 0');
  const n = both(); n.score = [1, 0]; n.step(1 / 30); assert.deepEqual(n.score, [1, 1], 'team 1 was behind');
});
