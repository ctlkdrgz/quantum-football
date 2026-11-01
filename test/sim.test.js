'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Match, PARAMS, PRESETS, STANCE, W, H, N, GOAL_DEPTH, NP } = require('../sim');
const { DEFENSE, PASS, SHOT, DRIBBLE } = STANCE;

const playing = () => { const m = new Match(); m.setPresent(0, true); m.setPresent(1, true); m.phase = 'playing'; return m; };
// No player influences the wave: Dribble (no kick) with a well of depth 0.
const quiet = (m) => { m.setParam('wallHeight', 0); m.setParam('wellDepth', 0); for (let i = 0; i < NP; i++) m.setStance(i, DRIBBLE); };
const run = (m, secs) => { for (let k = 0; k < secs * 30; k++) m.step(1 / 30); };
const centroidX = (m) => { let s = 0; for (let i = 0; i < N; i++) s += ((i % W) + 0.5) * (m.R[i] ** 2 + m.I[i] ** 2); return s; };
const total = (m) => { let s = 0; for (let i = 0; i < m.gn; i++) s += m.R[i] ** 2 + m.I[i] ** 2; return s; };

test('total probability stays 1 and nothing blows up', () => {
  const m = playing(); m.setParam('timeScale', 12); m.setParam('wellDepth', 3); m.setParam('wallHeight', 4);
  for (let i = 0; i < 4; i++) m.setStance(i, PASS);
  for (let i = 4; i < NP; i++) m.setStance(i, DEFENSE);
  m.setOrder(0, 5, 0); m.setOrder(5, -5, 3);
  run(m, 20);
  assert.ok(Math.abs(total(m) - 1) < 1e-9);
  assert.ok(m.R.every(Number.isFinite));
});

test('a kicked packet reflects off the wall and comes back', () => {
  const m = playing(); m.setParam('attenuation', 0); quiet(m);
  m.players[0].x = 44; m.players[0].y = 25; m.setStance(0, SHOT); // shot from just behind the ball
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
    for (let i = 0; i < 8; i++) m.setStance(i, DRIBBLE);
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
  for (let i = 0; i < 4; i++) m.setStance(i, PASS);
  for (let i = 4; i < 8; i++) m.setStance(i, DEFENSE);
  m.setParam('timeScale', 12); m.setParam('threshold', 0.9); run(m, 10);
  assert.ok(Math.abs(total(m) - 1) < 1e-9 && m.R.every(Number.isFinite));
  m.setParam('attenuation', 0.5); run(m, 1); m.setParam('threshold', 0.1); // smoothing wraps around on the torus too
  const ln = m.characteristicLength(); assert.ok(ln > 0 && ln <= W);
  m.R.fill(0); m.I.fill(0);
  for (let y = 20; y < 30; y++) for (let x = W - GOAL_DEPTH; x < W - 1; x++) m.R[y * m.gw + x] = 1;
  m.normalize(); m.phase = 'playing'; m.step(1 / 30);
  assert.deepEqual(m.score, [1, 0]);
  m.setParam('additive', 0); m.kickoff(); assert.equal(m.gn, N);
});

test('presets only name real parameters inside their ranges', () => {
  assert.deepEqual(Object.keys(PRESETS), ['default', 'waves', 'additive', 'waves-kick', 'waves-well', 'waves-wall', 'waves-mass', 'hybrid']);
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

test('Pass splits the caught wave between the allies; Dribble and Defense behave as described', () => {
  const sides = (ally2) => {
    const m = playing(); park(m); m.setParam('attenuation', 0); m.setParam('wellDepth', 0.3);
    place(m, 0, 45, 25); place(m, 1, 75, 8); place(m, 2, ally2 ? 75 : 45, ally2 ? 42 : 25); place(m, 3, 45, 25); // allies within 2 m of the passer are not receivers
    m.setStance(0, PASS); run(m, 2.5); m.setStance(0, DRIBBLE); run(m, 1.5);
    const D = m.density(); let up = 0, down = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (y < 20) up += D[y * W + x]; else if (y > 30) down += D[y * W + x]; }
    return { up, down, total: total(m) };
  };
  const two = sides(true), one = sides(false);
  assert.ok(Math.abs(two.total - 1) < 1e-9);
  assert.ok(two.up > 0.3 && two.down > 0.3 && Math.abs(two.up - two.down) < 0.1, 'both receivers get an equal share ' + two.up + ' / ' + two.down);
  assert.ok(one.up > 0.4 && one.down < 0.25, 'a single receiver gets it all ' + one.up + ' / ' + one.down);
});

test('Dribble keeps the wave with the player (no kick); Shot kicks it away hard, Pass less, Defense clears it', () => {
  const right = (stance) => { // mass in the last 38 m after 0.8 s in the stance and 3 s more
    const m = playing(); park(m); m.setParam('attenuation', 0);
    place(m, 0, 40, 25); place(m, 1, 80, 25); m.setStance(0, stance); run(m, 0.8); m.setStance(0, DRIBBLE); run(m, 3);
    const D = m.density(); let s = 0; for (let i = 0; i < N; i++) if (i % W >= 62) s += D[i];
    return s;
  };
  const dribble = right(DRIBBLE), pass = right(PASS), shot = right(SHOT), defense = right(DEFENSE);
  assert.ok(dribble < 0.22, 'no kick: ' + dribble);
  assert.ok(pass > dribble + 0.03 && shot > pass + 0.1 && defense > shot, `dribble ${dribble} pass ${pass} shot ${shot} defense ${defense}`);
});

test('Defense catches over a wide area: its well is wider and farther ahead than the others', () => {
  const m = playing(); park(m); place(m, 0, 40, 25); m.setStance(0, DEFENSE); m.buildPotential(1 / 30);
  const dWide = m.V[25 * W + 40 + 12] , dNear = (() => { m.setStance(0, DRIBBLE); m.buildPotential(1 / 30); return m.V[25 * W + 40 + 12]; })();
  assert.ok(dWide < dNear - 0.2, 'wide well reaches 12 m ahead ' + dWide + ' vs ' + dNear);
});

test('aim: kicks follow the aim, not the heading: a shot facing up still sends the ball toward the goal', () => {
  const shift = (autoAim) => {
    const m = playing(); park(m); m.setParam('autoAim', autoAim); m.setParam('attenuation', 0);
    place(m, 0, 40, 25, { hx: 0, hy: -1 }); m.setStance(0, SHOT);
    run(m, 0.8); m.setStance(0, DRIBBLE); run(m, 3);
    let cx = 0, cy = 0; const D = m.density(); for (let i = 0; i < N; i++) { cx += ((i % W) + 0.5) * D[i]; cy += (Math.floor(i / W) + 0.5) * D[i]; }
    return { cx, cy };
  };
  const on = shift(1), off = shift(0);
  assert.ok(on.cx > off.cx + 1, 'auto-aim goes right ' + on.cx + ' vs ' + off.cx);
  assert.ok(off.cy < on.cy - 0.5, 'heading up went up ' + off.cy + ' vs ' + on.cy);
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
