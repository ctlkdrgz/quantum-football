'use strict';
// Quantum Football: pure simulation core. No DOM, no network, no timers.
// The ball is a complex wave function psi = R + iI on a W x H grid (1 cell = 1 m),
// evolving under the Schroedinger equation with hbar = 1:  i dpsi/dt = (-(1/2m) lap + V) psi
// with hard (reflecting) walls. Players act on psi through the potential V and phase kicks.

const W = 100;
const H = 50;
const N = W * H;
const GOAL_DEPTH = 6;
const COUNTDOWN_S = 3;
const GOAL_PAUSE_S = 2.5;
const OVER_PAUSE_S = 10;
const STANCE = { ATTACK: 0, DEFENSE: 1, PASS: 2 };

// Every slider. Units: lengths in metres, "game time" = real time x timeScale.
const PARAMS = {
  timeScale:    { min: 0.5, max: 12,  def: 5,    step: 0.1,  label: 'Wave time speed' },
  mass:         { min: 0.5, max: 4,   def: 1,    step: 0.05, label: 'Ball weight (mass)' },
  attenuation:  { min: 0,   max: 1,   def: 0.05, step: 0.01, label: 'Attenuation (smoothing)' },
  packetWidth:  { min: 2,   max: 15,  def: 4,    step: 0.5,  label: 'Kick-off packet width (m)' },
  goalHeight:   { min: 6,   max: 40,  def: 20,   step: 1,    label: 'Goal height (m)' },
  threshold:    { min: 0.05, max: 0.9, def: 0.15, step: 0.01, label: 'Goal threshold (probability)' },
  matchSeconds: { min: 30,  max: 600, def: 180,  step: 10,   label: 'Match duration (s)' },
  runSpeed:     { min: 2,   max: 30,  def: 12,   step: 0.5,  label: 'Player run speed (m/s)' },
  reach:        { min: 1.5, max: 8,   def: 4,    step: 0.1,  label: 'Player reach (m)' },
  wellDepth:    { min: 0,   max: 3,   def: 1,    step: 0.05, label: 'Attack: well depth' },
  wallHeight:   { min: 0,   max: 4,   def: 3,    step: 0.05, label: 'Defense: wall height' },
  kick:         { min: 0,   max: 3,   def: 1,    step: 0.05, label: 'Kick strength (momentum/s)' },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

class Match {
  constructor() {
    this.params = {};
    for (const k of Object.keys(PARAMS)) this.params[k] = PARAMS[k].def;
    this.R = new Float64Array(N);
    this.I = new Float64Array(N);
    this.V = new Float64Array(N);
    this.A = new Float64Array(N); // scratch
    this.B = new Float64Array(N); // scratch
    this.present = [false, false];
    this.score = [0, 0];
    this.players = [0, 1].map(() => ({ x: 0, y: H / 2, tx: 0, ty: H / 2, hx: 1, hy: 0, stance: STANCE.ATTACK, stamina: 1 }));
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
    this.params[k] = clamp(v, d.min, d.max);
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

  setTarget(i, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.players[i].tx = clamp(x, 0, W);
    this.players[i].ty = clamp(y, 0, H);
  }

  setStance(i, s) {
    if (s === 0 || s === 1 || s === 2) this.players[i].stance = s;
  }

  kickoff() {
    this.players.forEach((p, i) => {
      p.x = p.tx = i === 0 ? W * 0.25 : W * 0.75;
      p.y = p.ty = H / 2;
      p.hx = i === 0 ? 1 : -1;
      p.hy = 0;
      p.stamina = 1;
    });
    const s = this.params.packetWidth;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - W / 2, dy = y + 0.5 - H / 2;
        this.R[y * W + x] = Math.exp(-(dx * dx + dy * dy) / (4 * s * s));
        this.I[y * W + x] = 0;
      }
    }
    this.normalize();
    this.goalP = this.goalProbabilities();
  }

  normalize() {
    let sum = 0;
    for (let i = 0; i < N; i++) sum += this.R[i] * this.R[i] + this.I[i] * this.I[i];
    const f = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    for (let i = 0; i < N; i++) { this.R[i] *= f; this.I[i] *= f; }
  }

  // Probability of finding the ball in [left goal, right goal].
  goalProbabilities() {
    const gh = this.params.goalHeight;
    const y0 = H / 2 - gh / 2, y1 = H / 2 + gh / 2;
    let l = 0, r = 0;
    for (let y = 0; y < H; y++) {
      const cy = y + 0.5;
      if (cy < y0 || cy > y1) continue;
      for (let x = 0; x < GOAL_DEPTH; x++) {
        const a = y * W + x, b = y * W + (W - 1 - x);
        l += this.R[a] * this.R[a] + this.I[a] * this.I[a];
        r += this.R[b] * this.R[b] + this.I[b] * this.I[b];
      }
    }
    return [l, r];
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
    for (const p of this.players) {
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.3) continue;
      p.hx = dx / d; p.hy = dy / d;
      const s = Math.min(d, this.params.runSpeed * dt);
      p.x += p.hx * s; p.y += p.hy * s;
    }
  }

  checkGoals() {
    this.goalP = this.goalProbabilities();
    const [l, r] = this.goalP;
    const t = this.params.threshold;
    if (Math.max(l, r) <= t) return;
    this.lastScorer = r >= l ? 0 : 1; // player 0 attacks the right goal
    this.score[this.lastScorer]++;
    this.phase = 'goal';
    this.timer = GOAL_PAUSE_S;
  }

  // Run fn(index, dx, dy) for every cell centre within rad of (cx, cy).
  forBox(cx, cy, rad, fn) {
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(W - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(H - 1, Math.ceil(cy + rad));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(y * W + x, x + 0.5 - cx, y + 0.5 - cy);
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

  buildPotential(dtReal) {
    const { V, params: P } = this;
    V.fill(0);
    const sig = P.reach * 0.6;
    for (const p of this.players) {
      if (p.stance === STANCE.ATTACK) {
        // Moving attractive well: carries the wave along with the player, plus a gentle forward push.
        this.forBox(p.x, p.y, 4 * sig, (i, dx, dy) => { V[i] -= P.wellDepth * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)); });
        this.kickPhase(p.x, p.y, p.hx, p.hy, sig, 0.15 * P.kick * dtReal);
      } else if (p.stance === STANCE.DEFENSE) {
        // Repulsive wall in front of the player, perpendicular to heading.
        const su = 0.35 * P.reach, sw = 1.2 * P.reach, off = P.reach;
        this.forBox(p.x + p.hx * off, p.y + p.hy * off, 4 * sw, (i, dx, dy) => {
          const u = dx * p.hx + dy * p.hy, w = -dx * p.hy + dy * p.hx;
          V[i] += P.wallHeight * Math.exp(-(u * u) / (2 * su * su) - (w * w) / (2 * sw * sw));
        });
      } else if (p.stamina > 0) {
        // Pass: strong forward kick just ahead of the player; burns stamina.
        this.kickPhase(p.x + p.hx * P.reach, p.y + p.hy * P.reach, p.hx, p.hy, 4 * sig, 0.7 * P.kick * dtReal);
        p.stamina = Math.max(0, p.stamina - 0.6 * dtReal);
      }
      if (p.stance !== STANCE.PASS) p.stamina = Math.min(1, p.stamina + 0.25 * dtReal);
    }
  }

  // out = H u  (Dirichlet boundaries: cells outside the field are zero)
  applyH(u, out) {
    const D = 1 / (2 * this.params.mass), V = this.V;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, c = u[i];
        const s = (x > 0 ? u[i - 1] : 0) + (x < W - 1 ? u[i + 1] : 0) + (y > 0 ? u[i - W] : 0) + (y < H - 1 ? u[i + W] : 0);
        out[i] = -D * (s - 4 * c) + V[i] * c;
      }
    }
  }

  smooth(u, eps) {
    const t = this.A;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, c = u[i];
        const s = (x > 0 ? u[i - 1] : 0) + (x < W - 1 ? u[i + 1] : 0) + (y > 0 ? u[i - W] : 0) + (y < H - 1 ? u[i + W] : 0);
        t[i] = c + eps * (s - 4 * c);
      }
    }
    u.set(t);
  }

  evolve(dt) {
    const gdt = dt * this.params.timeScale;
    this.buildPotential(dt);
    const n = Math.ceil(gdt / 0.08), h = gdt / n;
    const { R, I, A } = this;
    for (let k = 0; k < n; k++) { // Visscher leapfrog: norm-preserving to second order
      this.applyH(I, A); for (let i = 0; i < N; i++) R[i] += h * A[i];
      this.applyH(R, A); for (let i = 0; i < N; i++) I[i] -= h * A[i];
    }
    const eps = Math.min(0.24, this.params.attenuation * 0.5 * gdt);
    if (eps > 0) { this.smooth(R, eps); this.smooth(I, eps); }
    this.normalize();
  }

  // Wire format for clients: density quantised to bytes (sqrt scale, relative to the peak).
  snapshot() {
    const rho = this.A; // scratch is free between steps
    let max = 0;
    for (let i = 0; i < N; i++) { rho[i] = this.R[i] * this.R[i] + this.I[i] * this.I[i]; if (rho[i] > max) max = rho[i]; }
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
      goalP: this.goalP.slice(), peak: max, presence,
      players: this.players.map((p) => ({ x: p.x, y: p.y, hx: p.hx, hy: p.hy, stance: p.stance, stamina: p.stamina })),
      dens,
    };
  }
}

module.exports = { Match, PARAMS, STANCE, W, H, N, GOAL_DEPTH };
