'use strict';
// Quantum Football: pure simulation core. No DOM, no network, no timers.
// The ball is a complex wave function psi = R + iI on a W x H grid (1 cell = 1 m),
// evolving under the Schroedinger equation with hbar = 1:  i dpsi/dt = (-(1/2m) lap + V) psi
// with hard (reflecting) walls. Players act on psi through the potential V and phase kicks.
// Two wall modes (param `additive`, applied at the next kick-off):
//   0 coherent: Dirichlet walls. The reflected wave interferes with the incident one (nodes, standing waves).
//   1 additive: the pitch is unfolded into a mirrored 2W x 2H torus. psi evolves freely there and the density seen on the pitch is
//     the SUM of the densities of the four mirror images: a rebound adds probability, it never cancels it (no destructive interference).

const W = 100;
const H = 50;
const N = W * H;
const GOAL_DEPTH = 6;
const TEAM_SIZE = 4;
const NP = 2 * TEAM_SIZE;
const COUNTDOWN_S = 3;
const GOAL_PAUSE_S = 2.5;
// Every stance has a catch zone: a disc ahead of the player, the player on its edge. The ball in it is caught at a rate that falls with its speed
// relative to the player; on a catch it loses a share beta of that relative momentum and, except in Dribble, gets an instant kick toward the aims.
// Dribble alone also has a holding well (an attractive potential) in its zone.
const STANCE = { DEFENSE: 0, PASS: 1, SHOT: 2, DRIBBLE: 3 };
const KICK_GAIN = [0.7, 0.55, 1.0, 0]; // by stance, times the kick speed: Defense clears straight (fairly hard), Pass medium, Shot full, Dribble none
// Catch zone by stance, in units of the reach: disc radius r, its centre `off` ahead of the player (r = off: the player stands on the edge). Defense is wider.
const CATCH = [{ r: 1.5, off: 1.5 }, { r: 1, off: 1 }, { r: 1, off: 1 }, { r: 1, off: 1 }];
// Only the slow part of the ball is catchable (selectivity f(v) = exp(-(v / catchSpeed)^2), see catchPlan); it is caught at the rate (per second)
// CATCH_GAIN * (v + CATCH_V0) / zone diameter, v = its RMS speed relative to the player. That rate cancels the time a ball spends crossing the zone, so the
// chance per crossing is set by f alone (speed is not counted twice); CATCH_V0 keeps a still ball catchable.
const CATCH_GAIN = 3;
const CATCH_V0 = 6;
const BLUR_MAX = 12; // metres: cap of the slow-part blur radius (3 std), so a very low catch speed stays affordable
// The share beta of relative momentum removed on a catch is Gaussian (mean absorbMean, std absorbSpread): sampled at 3 points (Gauss-Hermite), clamped to [0, 1].
const BETA_NODES = [[-Math.sqrt(3), 1 / 6], [0, 2 / 3], [Math.sqrt(3), 1 / 6]];
const FRAME_DT = 1 / 30; // one simulation frame, in seconds of game clock: the server steps exactly this per frame, whatever its load
const NORM_DRIFT = 0.005; // the global renormalisation runs only when the total probability has drifted by more than this (see evolve)

// Every slider. Units: lengths in metres, speeds in metres per second of the players' clock, "wave time" = real time x timeScale.
const PARAMS = {
  timeScale:   { min: 0.5,  max: 30,   def: 12,   step: 0.1,  label: 'Wave time speed', tip: "How fast the wave clock runs against the players' clock. With the ball weight it sets hbar/m = timeScale / mass, the size of every quantum effect: fringe spacing (2 pi hbar/m / speed change) and how fast the ball spreads. Players are not affected." },
  mass:        { min: 0.2,  max: 4,    def: 0.5,  step: 0.05, label: 'Ball weight (mass)', tip: 'Inertia of the ball, against the wave time speed: hbar/m = timeScale / mass. Heavier: it spreads more slowly and its fringes are finer. Kick and catch speeds are in m/s and do not depend on it.' },
  attenuation: { min: 0,    max: 1,    def: 0.02, step: 0.01, label: 'Attenuation (smoothing)', tip: 'Smoothing applied every frame: damps the short ripples of the wave, and fast balls more than slow ones (it acts like k^2). Keep it light: at 0.05 a 20 m/s ball keeps about 2/3 of itself over 2 s, at 1 it is gone. The total probability is kept at 1 anyway.' },
  packetWidth: { min: 1,    max: 20,   def: 4,    step: 0.5,  label: 'Ball size at kick-off: packet width (m)', tip: 'Width (standard deviation, metres) of the ball placed at the centre at each kick-off. Changes take effect at the next kick-off (at once while waiting or counting down).' },
  goalHeight:  { min: 6,    max: 40,   def: 20,   step: 1,    label: 'Goal width (m)', tip: 'Width of the goal mouth along the end wall (metres). The goal zone is that width times 6 m deep.' },
  threshold:   { min: 0.05, max: 0.9,  def: 0.1,  step: 0.01, label: 'Goal threshold (probability)', tip: 'A goal is scored when the probability inside a goal zone reaches this value (shown by the bar next to each goal).' },
  runSpeed:    { min: 2,    max: 30,   def: 12,   step: 0.5,  label: 'Player max speed (m/s)', tip: 'Top speed of every player (metres per real second). Does not touch the ball physics.' },
  reach:       { min: 1.5,  max: 8,    def: 4.5,  step: 0.1,  label: 'Player reach: catch zone radius (m)', tip: "Radius of every player's catch zone, a disc just ahead of the player (the player stands on its edge); Defense: 1.5 x wider. The ball inside it can be caught, kicked, or held." },
  catchSpeed:  { min: 5,    max: 40,   def: 15,   step: 0.5,  label: 'Catch: speed limit (m/s)', tip: 'How hard a fast ball is to catch. A ball crossing a zone at this speed, relative to the player, is caught about a third as often as a still one; twice as fast, almost never. Lower = only slow balls get caught.' },
  absorbMean:  { min: 0,    max: 1,    def: 0.6,  step: 0.05, label: 'Catch: momentum absorbed (mean)', tip: "Share of the ball's momentum, relative to the player, removed when it is caught (before any kick). 1: a caught ball always leaves at the kick speed. 0: the kick only adds, so a chain of kickers makes it faster and faster." },
  absorbSpread:{ min: 0,    max: 0.5,  def: 0.25, step: 0.01, label: 'Catch: momentum absorbed (spread)', tip: 'Randomness of the absorbed share (standard deviation around the mean). It scatters caught balls: some leave slowed a lot, some barely touched.' },
  kickSpeed:   { min: 0,    max: 40,   def: 22,   step: 0.5,  label: 'Kick speed (m/s)', tip: "Speed given to a caught ball at once, times the stance's gain: Shot 1, Defense 0.7, Pass 0.55, Dribble 0. Only the caught share is kicked, so a kick sends a ray from the zone, not the whole ball." },
  wellDepth:   { min: 0,    max: 3,    def: 0.5,  step: 0.05, label: 'Dribble: holding well depth', tip: 'Depth of the attractive well in the Dribble zone (other stances have none). It keeps the ball together and in the zone while the player carries it; catching matches its speed to the player.' },
  autoAim:     { min: 0,    max: 1,    def: 1,    step: 1,    label: 'Auto-aim pass/shot at allies/goal (0 = along heading)', tip: "1: Pass kicks toward the allies (more toward the more advanced ones) and Shot toward the opposing goal. 0: both kick straight along the player's heading." },
  additive:    { min: 0,    max: 1,    def: 0,    step: 1,    label: 'Walls: coherent (0) / additive (1), next kick-off', tip: 'Wall behaviour, from the next kick-off. 0 (coherent): the wave reflects off the walls and interferes with itself. 1 (additive): rebounds add probability instead of interfering.' },
};

// Named parameter sets (overrides of the defaults), see docs/VARIANTS.md. The `waves` family belonged to the force-kick model (before 2026-11-01) and is gone.
const PRESETS = {
  default: {},
  // Default physics, but rebounds on the walls add probability instead of interfering (see the wall modes above).
  additive: { additive: 1 },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Taper of a catch zone of radius rz at squared distance d2 from its centre: 1 over the inner half, then cos^4 down to 0 at the edge. Its square root
// (the amplitude a catch moves) has no kink anywhere: a kink at the edge scattered part of the ball backwards. Flat-topped, so the zone's
// effective width stays close to its radius (narrow zones cannot separate a small kick from the ball, see docs/PHYSICS.md).
const taper = (d2, rz) => { const r = Math.sqrt(d2) / rz; if (r >= 1) return 0; if (r <= 0.5) return 1; const c = Math.cos(Math.PI * (r - 0.5)); return c * c * c * c; };

class Match {
  constructor() {
    this.params = {};
    for (const k of Object.keys(PARAMS)) this.params[k] = PARAMS[k].def;
    const GN = 4 * N; // room for the unfolded 2W x 2H torus
    this.R = new Float64Array(GN);
    this.I = new Float64Array(GN);
    this.V = new Float64Array(GN);
    this.A = new Float64Array(GN); // scratch
    this.DR = new Float64Array(GN); this.DI = new Float64Array(GN); this.T = new Float64Array(GN); // catch changes and tapers (catchAll)
    this.D = new Float64Array(N); // density on the pitch (folded in additive mode)
    this.setGrid(false);
    this.present = [false, false];
    this.paused = false; // a paused match does not step at all (the server pauses it until the admin starts it)
    this.score = [0, 0];
    // players 0-3 are team 0 (attack right), 4-7 team 1 (attack left). v = velocity order (m/s), h = heading.
    this.players = Array.from({ length: NP }, (_, i) => ({ x: 0, y: H / 2, vx: 0, vy: 0, hx: i < TEAM_SIZE ? 1 : -1, hy: 0, stance: STANCE.DRIBBLE, path: [] }));
    this.phase = 'waiting';
    this.timer = 0;
    this.clock = 0; // seconds of play since the match started (a match never ends)
    this.lastScorer = -1;
    this.goalP = [0, 0];
    this.kickoff();
  }

  setParam(k, v) {
    const d = PARAMS[k];
    if (!d || typeof v !== 'number' || !Number.isFinite(v)) return false;
    this.params[k] = k === 'additive' || k === 'autoAim' ? Math.round(clamp(v, 0, 1)) : clamp(v, d.min, d.max);
    if (k === 'packetWidth' && (this.phase === 'waiting' || this.phase === 'countdown')) this.kickoff(); // the ball on the spot follows the slider
    return true;
  }

  setPresent(i, here) {
    this.present[i] = !!here;
    if (this.present[0] && this.present[1]) {
      if (this.phase === 'waiting') this.restart();
    } else {
      this.phase = 'waiting';
      this.score = [0, 0];
      this.clock = 0;
      this.kickoff();
    }
  }

  restart() {
    this.score = [0, 0];
    this.clock = 0;
    this.kickoff();
    this.phase = 'countdown';
    this.timer = COUNTDOWN_S;
  }

  // Order: a velocity vector. Shorter than 0.5 m/s means "stop"; the heading then stays as it was.
  setOrder(i, vx, vy) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
    const p = this.players[i], len = Math.hypot(vx, vy);
    p.path = [];
    if (len < 0.5) { p.vx = p.vy = 0; return; }
    const sp = Math.min(len, this.params.runSpeed);
    p.vx = vx / len * sp; p.vy = vy / len * sp;
    p.hx = vx / len; p.hy = vy / len;
  }

  // Move order: go to (x, y) at max speed and stop there. With `queue`, append it to the player's path instead of replacing the path.
  // A target within 0.5 m of where the path would start is a "stop" (an empty path when not queued).
  moveTo(i, x, y, queue = false) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const p = this.players[i], t = { x: clamp(x, 0, W), y: clamp(y, 0, H) };
    const from = queue && p.path.length ? p.path[p.path.length - 1] : p;
    if (!queue) { p.path = []; p.vx = p.vy = 0; }
    if (Math.hypot(t.x - from.x, t.y - from.y) < 0.5) return;
    if (p.path.length >= 20) return;
    p.path.push(t);
  }

  face(i, dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len > 0) { this.players[i].hx = dx / len; this.players[i].hy = dy / len; }
  }

  setStance(i, s) {
    if (s === 0 || s === 1 || s === 2 || s === 3) this.players[i].stance = s;
  }

  setGrid(add) {
    this.add = add;
    this.gw = add ? 2 * W : W;
    this.gh = add ? 2 * H : H;
    this.gn = this.gw * this.gh;
  }

  kickoff() {
    const slots = [[0.15, 0.3], [0.15, 0.7], [0.3, 0.2], [0.3, 0.8]]; // x, y as fractions, for team 0
    this.players.forEach((p, i) => {
      const [fx, fy] = slots[i % TEAM_SIZE], t = i < TEAM_SIZE ? 0 : 1;
      p.x = (t === 0 ? fx : 1 - fx) * W; p.y = fy * H;
      p.vx = p.vy = 0; p.hx = t === 0 ? 1 : -1; p.hy = 0; p.path = [];
    });
    if (!!this.params.additive !== this.add) this.setGrid(!!this.params.additive);
    const { gw, gh } = this, s = this.params.packetWidth;
    const wrap = (d, n) => d - n * Math.round(d / n); // shortest distance on the torus (a no-op inside the pitch)
    this.R.fill(0); this.I.fill(0);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const dx = wrap(x + 0.5 - W / 2, gw), dy = wrap(y + 0.5 - H / 2, gh);
        this.R[y * gw + x] = Math.exp(-(dx * dx + dy * dy) / (4 * s * s));
      }
    }
    this.normalize();
    this.goalP = this.goalProbabilities();
  }

  normalize() {
    let sum = 0;
    for (let i = 0; i < this.gn; i++) sum += this.R[i] * this.R[i] + this.I[i] * this.I[i];
    const f = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    for (let i = 0; i < this.gn; i++) { this.R[i] *= f; this.I[i] *= f; }
  }

  // Density of the ball on the pitch, W x H, summing to exactly 1. Additive mode adds the four mirror images.
  // Divided by its total because psi is renormalised only when it drifts (see evolve): everything that reads the density (goals, bots, metrics) sees a
  // probability, whatever the drift.
  density() {
    const { R, I, D, gw, gh } = this;
    if (!this.add) { for (let i = 0; i < N; i++) D[i] = R[i] * R[i] + I[i] * I[i]; }
    else {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let sum = 0;
          for (const yy of [y, gh - 1 - y]) for (const xx of [x, gw - 1 - x]) { const k = yy * gw + xx; sum += R[k] * R[k] + I[k] * I[k]; }
          D[y * W + x] = sum;
        }
      }
    }
    let tot = 0;
    for (let i = 0; i < N; i++) tot += D[i];
    if (tot > 0) for (let i = 0; i < N; i++) D[i] /= tot;
    return D;
  }

  // Probability of finding the ball in [left goal, right goal].
  goalProbabilities() {
    const D = this.density(), gh = this.params.goalHeight;
    const y0 = H / 2 - gh / 2, y1 = H / 2 + gh / 2;
    let l = 0, r = 0;
    for (let y = 0; y < H; y++) {
      const cy = y + 0.5;
      if (cy < y0 || cy > y1) continue;
      for (let x = 0; x < GOAL_DEPTH; x++) { l += D[y * W + x]; r += D[y * W + (W - 1 - x)]; }
    }
    return [l, r];
  }

  // Characteristic length of the ball along the long axis (metres): participation length 1 / sum(rho_x^2),
  // where rho_x is the density summed over the pitch height. A uniform ball of width L gives L; a Gaussian of std s gives 3.54 s.
  characteristicLength() {
    const D = this.density(), col = new Float64Array(W);
    for (let i = 0; i < N; i++) col[i % W] += D[i];
    let q = 0;
    for (let x = 0; x < W; x++) q += col[x] * col[x];
    return q > 0 ? 1 / q : 0;
  }

  // Number of waves across the pitch length: W * k_rms / (2 pi), with k_rms the RMS wavenumber of psi along x (finite differences).
  // The lowest standing mode reads 0.5; a plane wave with 3 wavelengths across the pitch reads 3.
  wavesAcrossWidth() {
    const { R, I, gw, gh } = this;
    let num = 0, den = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        den += R[i] * R[i] + I[i] * I[i];
        if (x < gw - 1) { const a = R[i + 1] - R[i], b = I[i + 1] - I[i]; num += a * a + b * b; }
      }
    }
    return den > 0 ? W * Math.sqrt(num / den) / (2 * Math.PI) : 0;
  }

  step(dt) {
    if (this.paused) return;
    const ph = this.phase;
    if (ph === 'waiting') return;
    if (ph === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) this.phase = 'playing';
      return;
    }
    if (ph === 'playing') {
      this.clock += dt;
      this.movePlayers(dt);
      this.evolve(dt);
      this.checkGoals();
      return;
    }
    this.evolve(dt); // 'goal': the wave keeps moving, players are frozen
    this.timer -= dt;
    if (this.timer > 0) return;
    this.kickoff();
    this.phase = 'countdown';
    this.timer = COUNTDOWN_S;
  }

  movePlayers(dt) {
    const max = this.params.runSpeed;
    for (const p of this.players) {
      if (p.path.length) { // walking a path: full speed toward the next waypoint, landing exactly on it
        let left = dt;
        while (left > 1e-12 && p.path.length) {
          const t = p.path[0], d = Math.hypot(t.x - p.x, t.y - p.y), step = max * left;
          p.hx = d > 0 ? (t.x - p.x) / d : p.hx; p.hy = d > 0 ? (t.y - p.y) / d : p.hy;
          if (d <= step) { p.x = t.x; p.y = t.y; left -= d / max; p.path.shift(); } else { p.x += p.hx * step; p.y += p.hy * step; left = 0; }
        }
        if (p.path.length) { const t = p.path[0], d = Math.hypot(t.x - p.x, t.y - p.y) || 1; p.vx = (t.x - p.x) / d * max; p.vy = (t.y - p.y) / d * max; } else p.vx = p.vy = 0;
        continue;
      }
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > max) { p.vx *= max / sp; p.vy *= max / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < 0 || p.x > W) { p.x = clamp(p.x, 0, W); p.vx = 0; } // a wall stops that component
      if (p.y < 0 || p.y > H) { p.y = clamp(p.y, 0, H); p.vy = 0; }
    }
  }

  checkGoals() {
    this.goalP = this.goalProbabilities();
    const [l, r] = this.goalP;
    const t = this.params.threshold;
    if (Math.max(l, r) <= t) return;
    // team 0 attacks the right goal. If both goals cross the threshold on the same tick (symmetric play), the point goes to the team behind on goals (team 0 on equal scores)
    // - a plain `r >= l` handed every exact tie to team 0.
    const tie = Math.abs(r - l) < 1e-12;
    this.lastScorer = tie ? (this.score[0] <= this.score[1] ? 0 : 1) : r > l ? 0 : 1;
    this.score[this.lastScorer]++;
    this.phase = 'goal';
    this.timer = GOAL_PAUSE_S;
  }

  // Run fn(index, dx, dy) for every cell centre within rad of (cx, cy). On the torus the box wraps around.
  forBox(cx, cy, rad, fn) {
    const { gw, gh, add } = this;
    const rx = add ? Math.min(rad, gw / 2 - 1) : rad, ry = add ? Math.min(rad, gh / 2 - 1) : rad;
    // exactly the cells whose centre is within the radius: mirror-symmetric (floor/ceil kept one extra cell on the + side)
    for (let y = Math.ceil(cy - ry - 0.5); y <= Math.floor(cy + ry - 0.5); y++) {
      for (let x = Math.ceil(cx - rx - 0.5); x <= Math.floor(cx + rx - 0.5); x++) {
        let xi = x, yi = y;
        if (add) { xi = ((x % gw) + gw) % gw; yi = ((y % gh) + gh) % gh; } else if (x < 0 || x >= gw || y < 0 || y >= gh) continue;
        fn(yi * gw + xi, x + 0.5 - cx, y + 0.5 - cy);
      }
    }
  }

  // Call fn for a thing at (cx, cy) heading (hx, hy): once on the pitch, and in additive mode also for its three mirror images.
  eachImage(cx, cy, hx, hy, fn) {
    fn(cx, cy, hx, hy, 1, 1);
    if (this.add) { fn(-cx, cy, -hx, hy, -1, 1); fn(cx, -cy, hx, -hy, 1, -1); fn(-cx, -cy, -hx, -hy, -1, -1); }
  }

  // Gradient of u at cell i = (x, y) by central differences, with the same boundary as the Laplacian (0 outside, or wrapped on the torus).
  grad(u, x, y, i) {
    const { gw, gh, add } = this;
    const l = x > 0 ? u[i - 1] : add ? u[i + gw - 1] : 0, r = x < gw - 1 ? u[i + 1] : add ? u[i - gw + 1] : 0;
    const d = y > 0 ? u[i - gw] : add ? u[i + (gh - 1) * gw] : 0, t = y < gh - 1 ? u[i + gw] : add ? u[i - (gh - 1) * gw] : 0;
    return [(r - l) / 2, (t - d) / 2];
  }

  // What player i's catch zone (one image of it) does this frame, measured on the current psi; null if nothing catchable is in it.
  // Only the SLOW part of the ball can be caught: psi seen from the player (psi e^{-i k_p . r}, k_p the player's own momentum) is blurred by a Gaussian of
  // std 1/k_c, k_c = the catch speed as a wavenumber. A blur passes momentum k with amplitude exp(-k^2 / (2 k_c^2)), i.e. probability exp(-(v / catchSpeed)^2):
  // the energy selectivity of the catch, component by component (two fast balls meeting head-on are both filtered out, though their mean momentum is 0;
  // a ball just kicked away is filtered out and not kicked again). Returns, per zone cell, the slow part psi_s and the taper t, plus the catch fraction a
  // at the centre and the components [{kx, ky, q}] (momentum change in rad/m, probability share of the caught part; the q sum to 1).
  // Speeds convert to wavenumbers by k = v * mass / timeScale.
  catchPlan(p, aims, cx, cy, hx, hy, sx, sy, dt) {
    const P = this.params, { R, I } = this, g = CATCH[p.stance];
    const rz = g.r * P.reach, wx = cx + hx * g.off * P.reach, wy = cy + hy * g.off * P.reach, toK = P.mass / P.timeScale;
    const ux = sx * p.vx * toK, uy = sy * p.vy * toK, sb = 1 / (P.catchSpeed * toK), rb = Math.min(3 * sb, BLUR_MAX);
    // the box around the zone, widened by the blur radius; psi seen from the player there (0 past a wall in coherent mode, wrapped on the torus)
    const { gw, gh, add } = this, e = Math.floor(rb), x0 = Math.ceil(wx - rz - 0.5), x1 = Math.floor(wx + rz - 0.5), y0 = Math.ceil(wy - rz - 0.5), y1 = Math.floor(wy + rz - 0.5);
    const bx0 = x0 - e, by0 = y0 - e, bw = x1 - x0 + 1 + 2 * e, bh = y1 - y0 + 1 + 2 * e, zw = x1 - x0 + 1;
    const pr = new Float64Array(bw * bh), pi = new Float64Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let x = bx0 + bx, y = by0 + by;
      if (add) { x = ((x % gw) + gw) % gw; y = ((y % gh) + gh) % gh; } else if (x < 0 || x >= gw || y < 0 || y >= gh) continue;
      const j = y * gw + x, th = -(ux * (bx0 + bx + 0.5 - wx) + uy * (by0 + by + 0.5 - wy)), c = Math.cos(th), sn = Math.sin(th);
      pr[by * bw + bx] = R[j] * c - I[j] * sn; pi[by * bw + bx] = R[j] * sn + I[j] * c;
    }
    // separable Gaussian blur and its gradient (the kernel's derivative): x pass over the zone's columns, then y pass at the zone's cells
    const gk = [], dk = [];
    let n1 = 0;
    for (let o = -e; o <= e; o++) { const g = Math.exp(-(o * o) / (2 * sb * sb)); gk.push(g); dk.push(g * o / (sb * sb)); n1 += g; }
    const ar = new Float64Array(zw * bh), ai = new Float64Array(zw * bh), dr = new Float64Array(zw * bh), di = new Float64Array(zw * bh);
    for (let by = 0; by < bh; by++) for (let c = 0; c < zw; c++) {
      let sr = 0, si = 0, tr = 0, ti = 0;
      for (let o = 0; o <= 2 * e; o++) { const k = by * bw + c + o, g = gk[o], d = dk[o]; sr += g * pr[k]; si += g * pi[k]; tr += d * pr[k]; ti += d * pi[k]; }
      ar[by * zw + c] = sr; ai[by * zw + c] = si; dr[by * zw + c] = tr; di[by * zw + c] = ti;
    }
    const norm = 1 / (n1 * n1), cells = [];
    let w = 0, jx = 0, jy = 0, kin = 0;
    this.forBox(wx, wy, rz, (i, dx, dy) => {
      const t = taper(dx * dx + dy * dy, rz);
      if (!(t > 0)) return;
      const c = Math.round(wx + dx - 0.5) - x0, r0 = Math.round(wy + dy - 0.5) - y0; // the cell's column in the zone, its row in the box minus e
      let fr = 0, fi = 0, gxr = 0, gxi = 0, gyr = 0, gyi = 0;
      for (let o = 0; o <= 2 * e; o++) {
        const k = (r0 + o) * zw + c, g = gk[o], d = dk[o];
        fr += g * ar[k]; fi += g * ai[k]; gxr += g * dr[k]; gxi += g * di[k]; gyr += d * ar[k]; gyi += d * ai[k];
      }
      fr *= norm; fi *= norm; gxr *= norm; gxi *= norm; gyr *= norm; gyi *= norm;
      cells.push({ i, dx, dy, t, fr, fi, ux, uy });
      w += t * (fr * fr + fi * fi);
      jx += t * (fr * gxi - fi * gxr); jy += t * (fr * gyi - fi * gyr);
      kin += t * (gxr * gxr + gxi * gxi + gyr * gyr + gyi * gyi);
    });
    if (!(w > 1e-14)) return null;
    // the slow part's mean momentum and RMS speed, both relative to the player
    const px = jx / w, py = jy / w, v = Math.sqrt(Math.max(0, kin / w)) / toK;
    const a = 1 - Math.exp(-CATCH_GAIN * (v + CATCH_V0) / (2 * rz) * dt);
    const kick = KICK_GAIN[p.stance] * P.kickSpeed * toK, dirs = aims.length ? aims.map((t) => ({ dx: t.dx * sx, dy: t.dy * sy, w: t.w })) : [{ dx: 0, dy: 0, w: 1 }];
    const betas = P.absorbSpread > 0 ? BETA_NODES.map(([z, q]) => [clamp(P.absorbMean + z * P.absorbSpread, 0, 1), q]) : [[P.absorbMean, 1]];
    const comps = [];
    for (const [beta, qb] of betas) for (const d of dirs) {
      const kx = -beta * px + kick * d.dx, ky = -beta * py + kick * d.dy;
      const same = comps.find((c) => Math.abs(c.kx - kx) < 1e-9 && Math.abs(c.ky - ky) < 1e-9); // equal momenta are one component, not two that interfere
      if (same) same.q += qb * d.w; else comps.push({ kx, ky, q: qb * d.w });
    }
    return { cells, a, comps };
  }

  // Apply a catch plan to the slow part psi_s only: psi += (M - 1) psi_s, M = s + i sum_c sqrt(w_c) e^{i k_c . r}, r the offset from the zone centre,
  // s^2 = 1 - a t (stays as it is), w_c = a t q_c (caught, component c), t the zone's taper (see `taper`; 0 at its edge: nothing happens outside).
  // As in a split, the components are orthogonal once they separate, so the caught share a t q_c ends up with momentum change k_c.
  // The caught part is a quarter turn (i) ahead of what stays: with one component |M|^2 = 1 where k_c . r = 0, and on average over a fringe.
  // The offset is the same for every frame, so the kicks of successive frames add up coherently into one ray (offsets that alternated made consecutive
  // kicks cancel), and it is a constant: an offset that varied with the taper (to make M exactly 1 at the centre) acted as a lens on the part that stays
  // and scattered as much of it, half of it backwards, as the kick moved. The changes of different players are computed on the same psi and summed,
  // so they commute.
  applyCatch(plan, DR, DI, T, touched) {
    const { cells, a, comps } = plan;
    for (const { i, dx, dy, t, fr, fi, ux, uy } of cells) {
      let stay = 1 - a * t;
      const moved = [];
      for (const c of comps) { const w = a * t * c.q; if (Math.abs(c.kx) < 1e-12 && Math.abs(c.ky) < 1e-12) stay += w; else moved.push({ kx: c.kx, ky: c.ky, amp: Math.sqrt(w) }); }
      if (!moved.length) continue;
      const s = Math.sqrt(Math.max(0, stay));
      let mr = 0, mi = 0;
      for (const q of moved) { const ph = q.kx * dx + q.ky * dy; mr -= q.amp * Math.sin(ph); mi += q.amp * Math.cos(ph); } // i sum_c amp_c e^{i k_c . r}
      const er = s - 1 + mr, ei = mi; // M - 1
      // back from the player's frame: psi_s = phi_s e^{i k_p . r}
      const th = ux * dx + uy * dy, c = Math.cos(th), sn = Math.sin(th), pr = fr * c - fi * sn, pi = fr * sn + fi * c;
      if (T[i] === 0 && DR[i] === 0 && DI[i] === 0) touched.push(i);
      DR[i] += er * pr - ei * pi; DI[i] += er * pi + ei * pr;
      T[i] += t;
    }
  }

  // All players' catches for this frame. Every plan is measured on the same psi, the changes are summed and applied together, then the probability inside
  // the catch zones is restored to what it was (the change is not exactly unitary): psi *= 1 + lambda T over the zones, T the summed tapers,
  // so the correction fades out at the zone edges and nothing outside the zones changes.
  catchAll(dt) {
    const { R, I, DR, DI, T } = this, touched = [];
    const plans = [];
    this.players.forEach((p, i) => {
      const aims = this.aims(i);
      this.eachImage(p.x, p.y, p.hx, p.hy, (cx, cy, hx, hy, sx, sy) => { const pl = this.catchPlan(p, aims, cx, cy, hx, hy, sx, sy, dt); if (pl) plans.push(pl); });
    });
    for (const pl of plans) this.applyCatch(pl, DR, DI, T, touched);
    let before = 0, A = 0, B = 0, C = 0;
    for (const i of touched) {
      before += R[i] * R[i] + I[i] * I[i];
      R[i] += DR[i]; I[i] += DI[i];
      const d = R[i] * R[i] + I[i] * I[i]; A += d * T[i] * T[i]; B += 2 * d * T[i]; C += d;
    }
    C -= before;
    const disc = B * B - 4 * A * C, lambda = disc >= 0 && B > 0 ? -2 * C / (B + Math.sqrt(disc)) : 0;
    for (const i of touched) { const s = 1 + lambda * T[i]; R[i] *= s; I[i] *= s; DR[i] = 0; DI[i] = 0; T[i] = 0; }
  }

  // Where player i's kick goes: a list of {dx, dy, tx, ty, w} (unit direction, target point, probability weight; weights sum to 1). Empty for Dribble.
  //  Defense: straight ahead along the heading.
  //  Shot: the opposing goal centre.
  //  Pass: every ally (own position extrapolated along its velocity order for the time the ball needs), weighted by its distance from our own goal line,
  //        so the allies closest to the opposing goal are the most likely receivers; allies within 2 m are skipped, with no ally the pass goes to the goal.
  // With autoAim off, Pass and Shot go along the heading.
  aims(i) {
    const p = this.players[i], P = this.params, st = p.stance;
    if (st === STANCE.DRIBBLE) return [];
    const one = (tx, ty) => { const L = Math.hypot(tx - p.x, ty - p.y) || 1; return { dx: (tx - p.x) / L, dy: (ty - p.y) / L, tx, ty, w: 1 }; };
    if (st === STANCE.DEFENSE || !P.autoAim) return [{ dx: p.hx, dy: p.hy, tx: clamp(p.x + p.hx * 15, 0, W), ty: clamp(p.y + p.hy * 15, 0, H), w: 1 }];
    const team = i < TEAM_SIZE ? 0 : 1, goalX = team === 0 ? W : 0, ownX = team === 0 ? 0 : W;
    if (st === STANCE.SHOT) return [one(goalX, H / 2)];
    const speed = clamp(KICK_GAIN[STANCE.PASS] * P.kickSpeed, 2, 40); // the pass speed (m/s): the caught share leaves at once at this speed
    const out = [];
    for (let j = team * TEAM_SIZE; j < (team + 1) * TEAM_SIZE; j++) {
      if (j === i) continue;
      const m = this.players[j], T = clamp(Math.hypot(m.x - p.x, m.y - p.y) / speed, 0, 4);
      const tx = clamp(m.x + m.vx * T, 0, W), ty = clamp(m.y + m.vy * T, 0, H);
      if (Math.hypot(tx - p.x, ty - p.y) < 2) continue;
      const t = one(tx, ty); t.w = 1 + Math.abs(m.x - ownX); out.push(t);
    }
    if (!out.length) return [one(goalX, H / 2)];
    const sum = out.reduce((a, t) => a + t.w, 0);
    out.forEach((t) => { t.w /= sum; });
    return out;
  }

  // The aims (shown to the clients) and the potential: only Dribble has a well, a Gaussian of std half the zone radius at the zone centre.
  buildPotential() {
    const { V, params: P } = this;
    V.fill(0, 0, this.gn);
    this.players.forEach((p, i) => {
      const aims = this.aims(i);
      p.aim = aims.length ? aims.map((t) => ({ tx: t.tx, ty: t.ty, w: t.w })) : null;
      if (p.stance !== STANCE.DRIBBLE || !(P.wellDepth > 0)) return;
      const g = CATCH[p.stance], sig = g.r * P.reach / 2, off = g.off * P.reach;
      this.eachImage(p.x, p.y, p.hx, p.hy, (cx, cy, hx, hy) => {
        this.forBox(cx + hx * off, cy + hy * off, 4 * sig, (c, dx, dy) => { V[c] -= P.wellDepth * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)); });
      });
    });
  }

  // Neighbour sum; out of range is 0 (Dirichlet) or wraps around (torus).
  neighbours(u, x, y, i) {
    const { gw, gh, add } = this;
    return (x > 0 ? u[i - 1] : add ? u[i + gw - 1] : 0) + (x < gw - 1 ? u[i + 1] : add ? u[i - gw + 1] : 0) +
      (y > 0 ? u[i - gw] : add ? u[i + (gh - 1) * gw] : 0) + (y < gh - 1 ? u[i + gw] : add ? u[i - (gh - 1) * gw] : 0);
  }

  // out = H u
  applyH(u, out) {
    const D = 1 / (2 * this.params.mass), V = this.V, { gw, gh } = this;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x, c = u[i];
        out[i] = -D * (this.neighbours(u, x, y, i) - 4 * c) + V[i] * c;
      }
    }
  }

  smooth(u, eps) {
    const t = this.A, { gw, gh } = this;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x, c = u[i];
        t[i] = c + eps * (this.neighbours(u, x, y, i) - 4 * c);
      }
    }
    for (let i = 0; i < this.gn; i++) u[i] = t[i];
  }

  evolve(dt) {
    const gdt = dt * this.params.timeScale;
    this.buildPotential();
    this.catchAll(dt);
    const n = Math.ceil(gdt / 0.08), h = gdt / n;
    const { R, I, A } = this;
    for (let k = 0; k < n; k++) { // Visscher leapfrog: norm-preserving to second order
      this.applyH(I, A); for (let i = 0; i < this.gn; i++) R[i] += h * A[i];
      this.applyH(R, A); for (let i = 0; i < this.gn; i++) I[i] -= h * A[i];
    }
    const eps = Math.min(0.24, this.params.attenuation * 0.5 * gdt);
    if (eps > 0) { this.smooth(R, eps); this.smooth(I, eps); }
    // Renormalise only when the total has drifted by more than NORM_DRIFT: the smoothing loses probability every frame (so with heavy attenuation this is
    // every frame), the leapfrog and the catches drift it slightly (R and I live half a substep apart). Summing costs as much as rescaling, but it is not
    // a per-frame rescale: between two runs the total is whatever the physics left.
    let sum = 0;
    for (let i = 0; i < this.gn; i++) sum += R[i] * R[i] + I[i] * I[i];
    if (Math.abs(sum - 1) > NORM_DRIFT) this.normalize();
  }

  // Wire format for clients: density quantised to bytes (sqrt scale, relative to the peak).
  snapshot() {
    const rho = this.density();
    let max = 0;
    for (let i = 0; i < N; i++) if (rho[i] > max) max = rho[i];
    const dens = new Uint8Array(N);
    if (max > 0) for (let i = 0; i < N; i++) dens[i] = Math.round(255 * Math.sqrt(rho[i] / max));
    const presence = this.players.map((p) => { // the ball in the player's catch zone, weighted by the zone's taper
      let s = 0;
      const g = CATCH[p.stance], rz = g.r * this.params.reach, off = g.off * this.params.reach;
      const wx = p.x + p.hx * off, wy = p.y + p.hy * off; // on the pitch density (W wide), not the grid (2W wide in additive mode)
      for (let y = Math.max(0, Math.ceil(wy - rz - 0.5)); y <= Math.min(H - 1, Math.floor(wy + rz - 0.5)); y++) {
        for (let x = Math.max(0, Math.ceil(wx - rz - 0.5)); x <= Math.min(W - 1, Math.floor(wx + rz - 0.5)); x++) {
          const d2 = (x + 0.5 - wx) ** 2 + (y + 0.5 - wy) ** 2;
          s += rho[y * W + x] * taper(d2, rz);
        }
      }
      return s;
    });
    return {
      paused: this.paused, phase: this.phase, timer: this.timer, clock: this.clock,
      score: this.score.slice(), lastScorer: this.lastScorer, present: this.present.slice(),
      goalP: this.goalP.slice(), peak: max, presence, length: this.characteristicLength(), waves: this.wavesAcrossWidth(),
      players: this.players.map((p) => ({ x: p.x, y: p.y, hx: p.hx, hy: p.hy, vx: p.vx, vy: p.vy, stance: p.stance, aim: p.aim || null, path: p.path })),
      dens,
    };
  }
}

module.exports = { Match, PARAMS, PRESETS, STANCE, CATCH, KICK_GAIN, FRAME_DT, W, H, N, GOAL_DEPTH, TEAM_SIZE, NP };
