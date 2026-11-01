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
// Every stance is a catch well (a moving attractive Gaussian ahead of the player) plus, except Dribble, a kick of the caught wave.
const STANCE = { DEFENSE: 0, PASS: 1, SHOT: 2, DRIBBLE: 3 };
// The kick window is wider than the catch well: kappa*g(r)*d.r has a reversed momentum in its tails (|d.r| > sigma), so a narrow window would kick the caught wave unevenly.
const KICK_WIDTH = 2;
const PULSE_S = 0.4; // seconds between the splits of a Pass to several allies
const KICK_GAIN = [0.7, 0.5, 1.0, 0]; // by stance: Defense clears straight (fairly hard), Pass medium, Shot high, Dribble none
// Catch well geometry by stance, in units of the reach: Gaussian width sig and offset of its centre ahead of the player (Defense wide and a bit farther).
const CATCH = [{ sig: 1.5, off: 1.2 }, { sig: 0.8, off: 0.8 }, { sig: 0.8, off: 0.8 }, { sig: 0.8, off: 0.8 }];

// Every slider. Units: lengths in metres, "game time" = real time x timeScale.
const PARAMS = {
  timeScale:   { min: 0.5,  max: 12,   def: 5,    step: 0.1,  label: 'Wave time speed', tip: "How fast the wave clock runs against the players' clock. Higher: the ball moves, spreads and reacts to kicks faster (its speed is momentum x timeScale / mass). Players are not affected." },
  mass:        { min: 0.5,  max: 4,    def: 0.7,  step: 0.05, label: 'Ball weight (mass)', tip: 'Inertia of the ball. Heavier: it spreads more slowly and travels more slowly after the same kick. Lighter: livelier, but it disperses quickly.' },
  attenuation: { min: 0,    max: 1,    def: 0.05, step: 0.01, label: 'Attenuation (smoothing)', tip: "Smoothing applied every tick: damps the short ripples of the wave. High values keep only a few long waves on the pitch (the 'waves' presets use 1). The total probability is kept at 1 anyway." },
  packetWidth: { min: 1,    max: 20,   def: 4,    step: 0.5,  label: 'Ball size at kick-off: packet width (m)', tip: 'Width (standard deviation, metres) of the ball placed at the centre at each kick-off. Changes take effect at the next kick-off (at once while waiting or counting down).' },
  goalHeight:  { min: 6,    max: 40,   def: 20,   step: 1,    label: 'Goal height (m)', tip: 'Width of the goal mouth along the end wall (metres). The goal zone is that width times 6 m deep.' },
  threshold:   { min: 0.05, max: 0.9,  def: 0.1,  step: 0.01, label: 'Goal threshold (probability)', tip: 'A goal is scored when the probability inside a goal zone reaches this value (shown by the bar next to each goal).' },
  runSpeed:    { min: 2,    max: 30,   def: 12,   step: 0.5,  label: 'Player max speed (m/s)', tip: 'Top speed of every player (metres per real second). Does not touch the ball physics.' },
  reach:       { min: 1.5,  max: 12,   def: 8,    step: 0.1,  label: 'Player reach (m)', tip: "SIZE and DISTANCE of every player's effect on the ball, in metres (the scale of the shaded catch zone). The catch well sits 0.8 x reach ahead of the player with width 0.8 x reach (Defense: 1.2 x reach ahead, width 1.5 x reach); kicks act over that zone too. Bigger reach = catches from farther, over a wider area. It says WHERE a player acts, not HOW STRONGLY: that is the well depth." },
  wellDepth:   { min: 0,    max: 3,    def: 0.5,  step: 0.05, label: 'Pass/Shot/Dribble: catch well depth', tip: 'STRENGTH of the catch well for Pass, Shot and Dribble: how deep the attractive dip ahead of the player is. Deeper = holds the ball tighter, drags it along better and compresses it; 0 = no catching at all (kicks still act). It says HOW STRONGLY a player holds, not WHERE: that is the reach.' },
  wallHeight:  { min: 0,    max: 4,    def: 1,    step: 0.05, label: 'Defense: wide catch well depth', tip: 'Same as the well depth, but for the Defense stance only: strength of its wider, farther catch well (the name dates from when Defense was a repulsive wall).' },
  autoAim:     { min: 0,    max: 1,    def: 1,    step: 1,    label: 'Auto-aim pass/shot at allies/goal (0 = along heading)', tip: "1: Pass kicks toward the allies (more toward the more advanced ones) and Shot toward the opposing goal. 0: both kick straight along the player's heading." },
  additive:    { min: 0,    max: 1,    def: 0,    step: 1,    label: 'Walls: coherent (0) / additive (1), next kick-off', tip: 'Wall behaviour, from the next kick-off. 0 (coherent): the wave reflects off the walls and interferes with itself. 1 (additive): rebounds add probability instead of interfering.' },
  kick:        { min: 0,    max: 3,    def: 2,    step: 0.05, label: 'Kick strength (momentum/s)', tip: "Strength of every kick (momentum given per second while the ball is in the zone), times the stance's gain: Shot 1, Defense 0.7, Pass 0.5, Dribble 0. Beyond a point a harder kick no longer makes the ball faster." },
};

// Named parameter sets (overrides of the defaults), see docs/VARIANTS.md.
const PRESETS = {
  default: {},
  // About 2-3 waves across the pitch length (median over bot matches 2.7, the defaults give about 15): strong smoothing, light heavy-time, gentle kicks.
  waves: { timeScale: 12, mass: 0.5, attenuation: 1, kick: 0.3, wallHeight: 1, wellDepth: 0.3 },
  // Default physics, but rebounds on the walls add probability instead of interfering (see the wall modes above).
  additive: { additive: 1 },
  // Small tunings around `waves`, all about three waves across the pitch (a wavelength of a third of the width): a stronger kick, a deeper well, a higher wall, a heavier ball.
  'waves-kick': { timeScale: 12, mass: 0.5, attenuation: 1, kick: 1, wallHeight: 1, wellDepth: 0.3 },
  'waves-well': { timeScale: 12, mass: 0.5, attenuation: 1, kick: 0.6, wallHeight: 1, wellDepth: 0.6 },
  'waves-wall': { timeScale: 12, mass: 0.5, attenuation: 1, kick: 0.6, wallHeight: 2, wellDepth: 0.3 },
  'waves-mass': { timeScale: 12, mass: 0.6, attenuation: 1, kick: 0.6, wallHeight: 1, wellDepth: 0.3 },
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

  // Kick: a momentum kick of kappa along each direction of `dirs` ([{hx, hy, a}], sum of a^2 = 1), weighted by amplitude.
  // One direction: psi *= exp(i kappa g(r) d.r). Several: the caught wave is split into a superposition with one momentum component per direction,
  // psi *= (1 - g) + g * conj(c0) * sum_j a_j exp(i (ph_j + kappa g(r) d_j.r)), so each direction gets probability a_j^2 (the (1 - g) term keeps the window's
  // edge continuous). The offsets ph_j (largest component 0, the others a common angle) make |c0| = |sum a_j exp(i ph_j)| = 1: at the window's centre the factor
  // is 1, the density is not bumped there, and the components only show up as fringes. A split is a finite event, not a force: a Pass fires it in pulses
  // (see buildPotential), because repeating it every tick would only average the directions.
  // The factors of different players multiply pointwise, so they commute: left/right mirrored teams stay mirror images whatever the order of the players.
  kickPhase(cx, cy, dirs, sigma, kappa, flip = 1) {
    const { R, I } = this;
    const many = dirs.length > 1;
    let ph = null, c0r = 1, c0i = 0;
    if (many) {
      let top = 0; dirs.forEach((d, j) => { if (d.a > dirs[top].a + 1e-9) top = j; }); // the tolerance keeps mirrored teams choosing the same one
      const a1 = dirs[top].a, S = dirs.reduce((t, d, j) => t + (j === top ? 0 : d.a), 0);
      const beta = S > 0 ? Math.acos(clamp((1 - a1 * a1 - S * S) / (2 * a1 * S), -1, 1)) : 0;
      ph = dirs.map((d, j) => (j === top ? 0 : flip * beta)); // the sign alternates from pulse to pulse: the first-order amplitude tilt of a split would otherwise always favour the same side
      c0r = ph.reduce((t, p, j) => t + dirs[j].a * Math.cos(p), 0); c0i = ph.reduce((t, p, j) => t + dirs[j].a * Math.sin(p), 0);
      const n = Math.hypot(c0r, c0i) || 1; c0r /= n; c0i /= -n; // conj(c0)
    }
    this.forBox(cx, cy, 4 * sigma, (i, dx, dy) => {
      const g = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      let c, s;
      if (!many) {
        const th = kappa * g * (dx * dirs[0].hx + dy * dirs[0].hy);
        c = Math.cos(th); s = Math.sin(th);
      } else {
        let sr = 0, si = 0;
        dirs.forEach((d, j) => { const th = ph[j] + kappa * g * (dx * d.hx + dy * d.hy); sr += d.a * Math.cos(th); si += d.a * Math.sin(th); });
        c = 1 - g + g * (sr * c0r - si * c0i); s = g * (sr * c0i + si * c0r);
      }
      const r = R[i], m = I[i];
      R[i] = r * c - m * s;
      I[i] = r * s + m * c;
    });
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
    const speed = clamp(KICK_GAIN[STANCE.PASS] * P.kick * P.timeScale / P.mass, 2, 30); // estimated ball speed (m/s) after a one-second kick
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

  buildPotential(dtReal) {
    const { V, params: P } = this;
    V.fill(0, 0, this.gn);
    this.players.forEach((p, i) => {
      const aims = this.aims(i);
      p.aim = aims.length ? aims.map((t) => ({ tx: t.tx, ty: t.ty, w: t.w })) : null;
      // Catch well just ahead of the player (wide and a bit farther for Defense), carried along as the player moves; then the kick of the caught wave.
      const def = p.stance === STANCE.DEFENSE, g = CATCH[p.stance];
      const sig = g.sig * P.reach, off = g.off * P.reach, depth = def ? P.wallHeight : P.wellDepth;
      let kappa = KICK_GAIN[p.stance] * P.kick * dtReal, fire = true;
      if (aims.length > 1) { // a Pass to several allies is a split, fired in pulses of the impulse of PULSE_S seconds
        p.pulse = (p.pulse === undefined ? PULSE_S : p.pulse) + dtReal;
        fire = p.pulse >= PULSE_S; kappa = KICK_GAIN[p.stance] * P.kick * PULSE_S;
        if (fire) { p.pulse -= PULSE_S; p.pulses = (p.pulses || 0) + 1; }
      } else { p.pulse = undefined; p.pulses = 0; }
      this.eachImage(p.x, p.y, p.hx, p.hy, (cx, cy, hx, hy, sx, sy) => {
        const wx = cx + hx * off, wy = cy + hy * off;
        this.forBox(wx, wy, 4 * sig, (c, dx, dy) => { V[c] -= depth * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)); });
        if (aims.length && kappa > 0 && fire) this.kickPhase(wx, wy, aims.map((t) => ({ hx: t.dx * sx, hy: t.dy * sy, a: Math.sqrt(t.w) })), KICK_WIDTH * sig, kappa, p.pulses % 2 ? -1 : 1);
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
      paused: this.paused, phase: this.phase, timer: this.timer, clock: this.clock,
      score: this.score.slice(), lastScorer: this.lastScorer, present: this.present.slice(),
      goalP: this.goalP.slice(), peak: max, presence, length: this.characteristicLength(), waves: this.wavesAcrossWidth(),
      players: this.players.map((p) => ({ x: p.x, y: p.y, hx: p.hx, hy: p.hy, vx: p.vx, vy: p.vy, stance: p.stance, aim: p.aim || null, path: p.path })),
      dens,
    };
  }
}

module.exports = { Match, PARAMS, PRESETS, STANCE, CATCH, W, H, N, GOAL_DEPTH, TEAM_SIZE, NP };
