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
const OVER_PAUSE_S = 10;
const STANCE = { ATTACK: 0, DEFENSE: 1, PASS: 2 };

// Every slider. Units: lengths in metres, "game time" = real time x timeScale.
const PARAMS = {
  timeScale:   { min: 0.5,  max: 12,   def: 5,    step: 0.1,  label: 'Wave time speed' },
  mass:        { min: 0.5,  max: 4,    def: 0.7,  step: 0.05, label: 'Ball weight (mass)' },
  attenuation: { min: 0,    max: 1,    def: 0.05, step: 0.01, label: 'Attenuation (smoothing)' },
  packetWidth: { min: 2,    max: 20,   def: 14,   step: 0.5,  label: 'Kick-off packet width (m)' },
  goalHeight:  { min: 6,    max: 40,   def: 20,   step: 1,    label: 'Goal height (m)' },
  threshold:   { min: 0.05, max: 0.9,  def: 0.1,  step: 0.01, label: 'Goal threshold (probability)' },
  matchSeconds:{ min: 30,   max: 600,  def: 180,  step: 10,   label: 'Match duration (s)' },
  runSpeed:    { min: 2,    max: 30,   def: 12,   step: 0.5,  label: 'Player max speed (m/s)' },
  reach:       { min: 1.5,  max: 12,   def: 8,    step: 0.1,  label: 'Player reach (m)' },
  wellDepth:   { min: 0,    max: 3,    def: 0.5,  step: 0.05, label: 'Attack: well depth' },
  wallHeight:  { min: 0,    max: 4,    def: 3,    step: 0.05, label: 'Defense: wall height' },
  autoAim:     { min: 0,    max: 1,    def: 1,    step: 1,    label: 'Auto-aim kicks at teammate/goal (0 = along heading)' },
  additive:    { min: 0,    max: 1,    def: 0,    step: 1,    label: 'Walls: coherent (0) / additive (1), next kick-off' },
  kick:        { min: 0,    max: 3,    def: 2,    step: 0.05, label: 'Kick strength (momentum/s)' },
};

// Named parameter sets (overrides of the defaults), see docs/VARIANTS.md.
const PRESETS = {
  default: {},
  // About 2-3 waves across the pitch length (median over bot matches 2.7, the defaults give about 15): strong smoothing, light heavy-time, gentle kicks.
  waves: { timeScale: 12, mass: 0.5, attenuation: 1, kick: 0.3, wallHeight: 1, wellDepth: 0.3 },
  // Default physics, but rebounds on the walls add probability instead of interfering (see the wall modes above).
  additive: { additive: 1 },
  // An experiment from docs/VARIANTS.md (waves + additive walls + deeper well). Narrower than either parent: not recommended.
  hybrid: { timeScale: 12, mass: 0.5, attenuation: 1, kick: 0.3, wallHeight: 1, wellDepth: 1, additive: 1 },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

class Match {
  constructor() {
    this.params = {};
    for (const k of Object.keys(PARAMS)) this.params[k] = PARAMS[k].def;
    const GN = 4 * N; // room for the unfolded 2W x 2H torus
    this.R = new Float64Array(GN);
    this.I = new Float64Array(GN);
    this.V = new Float64Array(GN);
    this.A = new Float64Array(GN); // scratch
    this.D = new Float64Array(N); // density on the pitch (folded in additive mode)
    this.setGrid(false);
    this.present = [false, false];
    this.score = [0, 0];
    // players 0-3 are team 0 (attack right), 4-7 team 1 (attack left). v = velocity order (m/s), h = heading.
    this.players = Array.from({ length: NP }, (_, i) => ({ x: 0, y: H / 2, vx: 0, vy: 0, hx: i < TEAM_SIZE ? 1 : -1, hy: 0, stance: STANCE.ATTACK }));
    this.phase = 'waiting';
    this.timer = 0;
    this.remaining = this.params.matchSeconds;
    this.lastScorer = -1;
    this.goalP = [0, 0];
    this.kickoff();
  }

  setParam(k, v) {
    const d = PARAMS[k];
    if (!d || typeof v !== 'number' || !Number.isFinite(v)) return false;
    this.params[k] = k === 'additive' || k === 'autoAim' ? Math.round(clamp(v, 0, 1)) : clamp(v, d.min, d.max);
    if (k === 'matchSeconds' && this.phase !== 'playing') this.remaining = this.params.matchSeconds;
    return true;
  }

  setPresent(i, here) {
    this.present[i] = !!here;
    if (this.present[0] && this.present[1]) {
      if (this.phase === 'waiting') this.restart();
    } else {
      this.phase = 'waiting';
      this.score = [0, 0];
      this.remaining = this.params.matchSeconds;
      this.kickoff();
    }
  }

  restart() {
    this.score = [0, 0];
    this.remaining = this.params.matchSeconds;
    this.kickoff();
    this.phase = 'countdown';
    this.timer = COUNTDOWN_S;
  }

  // Order: a velocity vector. Shorter than 0.5 m/s means "stop"; the heading then stays as it was.
  setOrder(i, vx, vy) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
    const p = this.players[i], len = Math.hypot(vx, vy);
    if (len < 0.5) { p.vx = p.vy = 0; return; }
    const sp = Math.min(len, this.params.runSpeed);
    p.vx = vx / len * sp; p.vy = vy / len * sp;
    p.hx = vx / len; p.hy = vy / len;
  }

  face(i, dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len > 0) { this.players[i].hx = dx / len; this.players[i].hy = dy / len; }
  }

  setStance(i, s) {
    if (s === 0 || s === 1 || s === 2) this.players[i].stance = s;
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
      p.vx = p.vy = 0; p.hx = t === 0 ? 1 : -1; p.hy = 0;
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

  // Density of the ball on the pitch, W x H. Additive mode adds the four mirror images.
  density() {
    const { R, I, D, gw, gh } = this;
    if (!this.add) { for (let i = 0; i < N; i++) D[i] = R[i] * R[i] + I[i] * I[i]; return D; }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (const yy of [y, gh - 1 - y]) for (const xx of [x, gw - 1 - x]) { const k = yy * gw + xx; sum += R[k] * R[k] + I[k] * I[k]; }
        D[y * W + x] = sum;
      }
    }
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
    const ph = this.phase;
    if (ph === 'waiting') return;
    if (ph === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) this.phase = 'playing';
      return;
    }
    if (ph === 'playing') {
      this.remaining -= dt;
      this.movePlayers(dt);
      this.evolve(dt);
      this.checkGoals();
      if (this.phase === 'playing' && this.remaining <= 0) {
        this.remaining = 0;
        this.phase = 'over';
        this.timer = OVER_PAUSE_S;
      }
      return;
    }
    this.evolve(dt); // 'goal' and 'over': the wave keeps moving, players are frozen
    this.timer -= dt;
    if (this.timer > 0) return;
    if (ph === 'goal') {
      this.kickoff();
      this.phase = 'countdown';
      this.timer = COUNTDOWN_S;
    } else {
      this.restart();
    }
  }

  movePlayers(dt) {
    const max = this.params.runSpeed;
    for (const p of this.players) {
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
    fn(cx, cy, hx, hy);
    if (this.add) { fn(-cx, cy, -hx, hy); fn(cx, -cy, hx, -hy); fn(-cx, -cy, -hx, -hy); }
  }

  // Multiply psi by exp(i kappa g(r) d.r): a momentum kick of kappa along d, weighted by amplitude.
  kickPhase(cx, cy, hx, hy, sigma, kappa) {
    const { R, I } = this;
    this.forBox(cx, cy, 4 * sigma, (i, dx, dy) => {
      const g = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      const th = kappa * g * (dx * hx + dy * hy);
      const c = Math.cos(th), s = Math.sin(th);
      const r = R[i], m = I[i];
      R[i] = r * c - m * s;
      I[i] = r * s + m * c;
    });
  }

  // Where player i's kick goes (Pass and Attack stances): the cheapest of the opposing goal and each teammate's PREDICTED position.
  // Teammates in Defense stance (their wall would repel the ball) and teammates not at least 5 m closer to the goal are not candidates.
  // cost = distance to the target + half the distance from the target to the goal (+ a penalty if an opposing wall stands on the way).
  // The prediction moves a teammate along its velocity order for the time the ball needs (distance / estimated ball speed).
  // With autoAim off the kick goes along the player's heading.
  aim(i) {
    const p = this.players[i], P = this.params;
    if (!P.autoAim) return { dx: p.hx, dy: p.hy, tx: clamp(p.x + p.hx * 15, 0, W), ty: clamp(p.y + p.hy * 15, 0, H) };
    const team = i < TEAM_SIZE ? 0 : 1, mate0 = team * TEAM_SIZE, foe0 = (1 - team) * TEAM_SIZE;
    const goal = { x: team === 0 ? W : 0, y: H / 2 };
    const speed = clamp(0.7 * P.kick * P.timeScale / P.mass, 2, 30); // estimated ball speed (m/s) after a one-second kick
    const walls = [];
    for (let j = foe0; j < foe0 + TEAM_SIZE; j++) if (this.players[j].stance === STANCE.DEFENSE) walls.push(this.players[j]);
    const blocked = (c) => walls.some((f) => {
      const ex = c.x - p.x, ey = c.y - p.y, len2 = ex * ex + ey * ey || 1;
      const u = clamp(((f.x - p.x) * ex + (f.y - p.y) * ey) / len2, 0, 1);
      return Math.hypot(f.x - (p.x + u * ex), f.y - (p.y + u * ey)) < 0.6 * P.reach;
    });
    const cost = (c) => Math.hypot(c.x - p.x, c.y - p.y) + 0.5 * Math.hypot(goal.x - c.x, goal.y - c.y) + (blocked(c) ? 30 : 0);
    let best = goal, bc = cost(goal);
    for (let j = mate0; j < mate0 + TEAM_SIZE; j++) {
      if (j === i || this.players[j].stance === STANCE.DEFENSE) continue; // a defender's wall would repel the ball
      const m = this.players[j], T = clamp(Math.hypot(m.x - p.x, m.y - p.y) / speed, 0, 4);
      const c = { x: clamp(m.x + m.vx * T, 0, W), y: clamp(m.y + m.vy * T, 0, H) };
      if (Math.hypot(c.x - p.x, c.y - p.y) < 3) continue; // too close to be a pass
      if (Math.hypot(goal.x - c.x, goal.y - c.y) > Math.hypot(goal.x - p.x, goal.y - p.y) - 5) continue; // only forward passes
      const k = cost(c);
      if (k < bc) { bc = k; best = c; }
    }
    const L = Math.hypot(best.x - p.x, best.y - p.y) || 1;
    return { dx: (best.x - p.x) / L, dy: (best.y - p.y) / L, tx: best.x, ty: best.y };
  }

  buildPotential(dtReal) {
    const { V, params: P } = this;
    V.fill(0, 0, this.gn);
    const sig = P.reach * 0.6;
    this.players.forEach((p, i) => {
      const a = p.stance === STANCE.DEFENSE ? null : this.aim(i); // where an Attack push or a Pass goes
      p.aim = a ? { tx: a.tx, ty: a.ty } : null;
      if (p.stance === STANCE.ATTACK) {
        // Moving attractive well: carries the wave along with the player, plus a gentle forward push.
        this.eachImage(p.x, p.y, a.dx, a.dy, (cx, cy, hx, hy) => {
          this.forBox(cx, cy, 4 * sig, (c, dx, dy) => { V[c] -= P.wellDepth * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)); });
          this.kickPhase(cx, cy, hx, hy, sig, 0.15 * P.kick * dtReal);
        });
      } else if (p.stance === STANCE.DEFENSE) {
        // Repulsive wall in front of the player, perpendicular to heading.
        const su = 0.35 * P.reach, sw = 1.2 * P.reach, off = P.reach;
        this.eachImage(p.x, p.y, p.hx, p.hy, (cx, cy, hx, hy) => {
          this.forBox(cx + hx * off, cy + hy * off, 4 * sw, (c, dx, dy) => {
            const u = dx * hx + dy * hy, w = -dx * hy + dy * hx;
            V[c] += P.wallHeight * Math.exp(-(u * u) / (2 * su * su) - (w * w) / (2 * sw * sw));
          });
        });
      } else {
        // Pass: strong forward kick just ahead of the player.
        this.eachImage(p.x, p.y, a.dx, a.dy, (cx, cy, hx, hy) => this.kickPhase(cx + hx * P.reach, cy + hy * P.reach, hx, hy, 4 * sig, 0.7 * P.kick * dtReal));
      }
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
    this.buildPotential(dt);
    const n = Math.ceil(gdt / 0.08), h = gdt / n;
    const { R, I, A } = this;
    for (let k = 0; k < n; k++) { // Visscher leapfrog: norm-preserving to second order
      this.applyH(I, A); for (let i = 0; i < this.gn; i++) R[i] += h * A[i];
      this.applyH(R, A); for (let i = 0; i < this.gn; i++) I[i] -= h * A[i];
    }
    const eps = Math.min(0.24, this.params.attenuation * 0.5 * gdt);
    if (eps > 0) { this.smooth(R, eps); this.smooth(I, eps); }
    this.normalize();
  }

  // Wire format for clients: density quantised to bytes (sqrt scale, relative to the peak).
  snapshot() {
    const rho = this.density();
    let max = 0;
    for (let i = 0; i < N; i++) if (rho[i] > max) max = rho[i];
    const dens = new Uint8Array(N);
    if (max > 0) for (let i = 0; i < N; i++) dens[i] = Math.round(255 * Math.sqrt(rho[i] / max));
    const presence = this.players.map((p) => {
      let s = 0;
      const r = this.params.reach;
      this.forBox(p.x, p.y, 3 * r, (i, dx, dy) => { s += rho[i] * Math.exp(-(dx * dx + dy * dy) / (2 * r * r)); });
      return s;
    });
    return {
      phase: this.phase, timer: this.timer, remaining: this.remaining,
      score: this.score.slice(), lastScorer: this.lastScorer, present: this.present.slice(),
      goalP: this.goalP.slice(), peak: max, presence, length: this.characteristicLength(), waves: this.wavesAcrossWidth(),
      players: this.players.map((p) => ({ x: p.x, y: p.y, hx: p.hx, hy: p.hy, vx: p.vx, vy: p.vy, stance: p.stance, aim: p.aim || null })),
      dens,
    };
  }
}

module.exports = { Match, PARAMS, PRESETS, STANCE, W, H, N, GOAL_DEPTH, TEAM_SIZE, NP };
