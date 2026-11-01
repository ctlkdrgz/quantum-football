'use strict';
// Dummy AIs: no learning, each is a fixed strategy for one team of four (players 0-3 within the team).
//   turns     alternate with the other team: attack for 12 s (two passers behind the ball), then defend in a wall line
//   receiver  player 0 waits next to the opposing goal as a target man; players 1-2 pass to him; player 3 guards our goal
//   fortress  all four players in defense stance around our own goal, facing the ball, to deflect everything
//   shadow    two players mark the two most advanced opponents; the other two attack with passes
//   lanes     the four players run sideways, each in its own quarter of the pitch length (two defend, two attack)
//   relay     a bucket brigade: player 0 passes from behind the ball, players 1-3 stand as stepping stones on the way to the goal, in dribble stance
//   plow      the four players form a line of defenders and advance together, clearing the wave in front of them toward the goal
//   chase     each player runs to one of the hot spots of the wave (none inside the opposing goal), in Shot stance, and once there dribbles it toward the opposing goal
//   idle      no action: the four players stand still, whatever their stance
//   random    every player picks a random velocity and stance every 0.5-2 s (not mirror-symmetric, by design)
const { W, H, N, TEAM_SIZE, STANCE, CATCH, GOAL_DEPTH } = require('./sim');
const { DEFENSE, PASS, SHOT, DRIBBLE } = STANCE;

function centroid(m) {
  let sx = 0, sy = 0;
  const D = m.density();
  for (let i = 0; i < N; i++) { const p = D[i]; sx += ((i % W) + 0.5) * p; sy += (Math.floor(i / W) + 0.5) * p; }
  return { x: sx, y: sy };
}

function goTo(m, i, tx, ty, fx, fy) { // proportional control toward a spot, then face (fx, fy)
  const p = m.players[i];
  m.setOrder(i, (tx - p.x) * 2, (ty - p.y) * 2);
  if (Math.hypot(tx - p.x, ty - p.y) < 1) m.face(i, fx, fy);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Up to `max` hot spots: local maxima of the density (3x3), hottest first, at least `gap` metres apart, none for which skip(x, y) holds.
// The scan runs from our own goal line (d = attack direction), and values within EPS count as equal: so the two teams pick mirror images.
const EPS = 1e-12;
function hotSpots(m, d, max, gap, skip) {
  const D = m.density(), peaks = [];
  for (let y = 0; y < H; y++) for (let xi = 0; xi < W; xi++) {
    const x = d > 0 ? xi : W - 1 - xi;
    const v = D[y * W + x];
    if (!(v > 0) || skip(x + 0.5, y + 0.5)) continue;
    let top = true;
    for (let dy = -1; dy <= 1 && top; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && xx < W && yy >= 0 && yy < H && D[yy * W + xx] > v + EPS) { top = false; break; }
    }
    if (top) peaks.push({ x: x + 0.5, y: y + 0.5, v });
  }
  peaks.sort((a, b) => (Math.abs(b.v - a.v) > EPS ? b.v - a.v : 0)); // stable: ties keep the scan order
  const out = [];
  for (const p of peaks) {
    if (out.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap)) out.push(p);
    if (out.length === max) break;
  }
  return out;
}

const dist = (m, i, q) => Math.hypot(m.players[i].x - q.x, m.players[i].y - q.y);

// Team context: d = direction of attack (+1 right), own = x of our goal line, base = index of our player 0.
const ctx = (t) => ({ t, d: t === 0 ? 1 : -1, own: t === 0 ? 0 : W, base: t * TEAM_SIZE });

// Two passers stand behind the ball on the line toward (gx, gy), at +-2 m sideways, and kick.
function passers(m, k, ks, c, gx, gy) {
  const L = Math.hypot(gx - c.x, gy - c.y) || 1, ux = (gx - c.x) / L, uy = (gy - c.y) / L;
  ks.forEach((idx, n) => {
    const i = k.base + idx, p = m.players[i];
    const side = (n ? 2 : -2) * k.d; // times the attack direction, so that the two teams are mirror images of each other
    const tx = c.x - ux * 5 - uy * side, ty = c.y - uy * 5 + ux * side;
    const there = Math.hypot(p.x - tx, p.y - ty) < 3;
    m.setStance(i, there ? PASS : DRIBBLE);
    goTo(m, i, tx, ty, ux, uy);
  });
}

function wallLine(m, k, c, depth) { // four defenders in a line in front of our goal, facing the ball
  [0.3, 0.43, 0.57, 0.7].forEach((fy, n) => {
    const i = k.base + n, x = k.own + k.d * depth;
    m.setStance(i, DEFENSE);
    goTo(m, i, x, fy * H, c.x - x, c.y - fy * H);
  });
}

const STRATEGIES = {
  turns(m, t, c) {
    const k = ctx(t);
    if ((Math.floor(m.clock / 12) + 1) % 2 !== t) { wallLine(m, k, c, 18); return; }
    passers(m, k, [0, 1], c, W - k.own, H / 2);
    [2, 3].forEach((n) => { m.setStance(k.base + n, DRIBBLE); goTo(m, k.base + n, c.x - k.d * 12, c.y + (n === 2 ? -8 : 8), k.d, 0); });
  },

  receiver(m, t, c) {
    const k = ctx(t), goalX = W - k.own;
    const rx = goalX - k.d * 8, ry = H / 2; // the target man, next to the opposing goal, facing the ball
    m.setStance(k.base, DRIBBLE); goTo(m, k.base, rx, ry, c.x - rx, c.y - ry);
    passers(m, k, [1, 2], c, rx, ry);
    const g = k.base + 3, gx = k.own + k.d * 10;
    m.setStance(g, DEFENSE); goTo(m, g, gx, H / 2, c.x - gx, c.y - H / 2);
  },

  fortress(m, t, c) {
    const k = ctx(t);
    [-9, -3, 3, 9].forEach((dy, n) => {
      const i = k.base + n, x = k.own + k.d * 10, y = clamp(H / 2 + dy + (c.y - H / 2) * 0.3, 3, H - 3);
      m.setStance(i, DEFENSE); goTo(m, i, x, y, c.x - x, c.y - y);
    });
  },

  shadow(m, t, c) {
    const k = ctx(t), foe = (1 - t) * TEAM_SIZE;
    // the most advanced opponents are those closest to our goal line
    // (ties within 1 micrometre go by player number: a bare sort let float noise decide, and the two teams then picked different marks)
    const byAdvance = (a, b) => { const d = Math.abs(a.x - k.own) - Math.abs(b.x - k.own); return Math.abs(d) > 1e-6 ? d : a.n - b.n; };
    const adv = [0, 1, 2, 3].map((n) => ({ n, x: m.players[foe + n].x, y: m.players[foe + n].y })).sort(byAdvance).slice(0, 2);
    adv.forEach((o, n) => { // stand between the opponent and our goal, wall facing him
      const i = k.base + n, x = o.x - k.d * 3;
      m.setStance(i, DEFENSE); goTo(m, i, x, o.y, o.x - x, 0);
    });
    passers(m, k, [2, 3], c, W - k.own, H / 2);
  },

  lanes(m, t, c, st) {
    const k = ctx(t);
    st.dir = st.dir || [1, -1, 1, -1];
    for (let n = 0; n < TEAM_SIZE; n++) {
      const i = k.base + n, p = m.players[i];
      const lane = k.t === 0 ? n : TEAM_SIZE - 1 - n; // lane 0 is the quarter next to the left wall
      const cx = W / 8 + lane * W / 4, ownHalf = Math.abs(cx - k.own) < W / 2;
      m.setStance(i, ownHalf ? DEFENSE : DRIBBLE);
      if (Math.abs(p.x - cx) > 2) { m.setOrder(i, (cx - p.x) * 2, 0); continue; } // first get into the lane
      if (p.y < 5) st.dir[n] = 1; else if (p.y > H - 5) st.dir[n] = -1;
      m.setOrder(i, 0, st.dir[n] * Math.min(8, m.params.runSpeed)); // sideways only
    }
  },

  relay(m, t, c) {
    const k = ctx(t), gx = W - k.own;
    const L = Math.hypot(gx - c.x, H / 2 - c.y) || 1, ux = (gx - c.x) / L, uy = (H / 2 - c.y) / L;
    const p = m.players[k.base], tx = c.x - ux * 5, ty = c.y - uy * 5;
    m.setStance(k.base, Math.hypot(p.x - tx, p.y - ty) < 3 ? PASS : DRIBBLE); goTo(m, k.base, tx, ty, ux, uy);
    [1, 2, 3].forEach((n) => { // stones every 12 m toward the goal; they never go past 8 m from the goal line
      const i = k.base + n, d = Math.min(12 * n, Math.max(0, L - 8));
      m.setStance(i, DRIBBLE); goTo(m, i, c.x + ux * d, c.y + uy * d, ux, uy);
    });
  },

  chase(m, t, c) {
    const k = ctx(t), gx = W - k.own, P = m.params, g = CATCH[DRIBBLE];
    const inGoal = (x, y) => Math.abs(x - gx) < GOAL_DEPTH + 2 && Math.abs(y - H / 2) < P.goalHeight / 2 + 2; // the opposing goal, plus a 2 m margin
    const spots = hotSpots(m, k.d, TEAM_SIZE, 1.5 * g.r * P.reach, inGoal).filter((q, n, a) => q.v >= 0.5 * a[0].v); // fragments under half the hottest are ignored
    if (!spots.length) spots.push(c);
    const free = [0, 1, 2, 3];
    // hottest spot first, each to the nearest free player; players left over (fewer spots than players) back up the hottest spot
    const pick = (q) => { const n = free.reduce((b, n) => (dist(m, k.base + n, q) < dist(m, k.base + b, q) - 1e-9 ? n : b)); free.splice(free.indexOf(n), 1); return n; };
    const jobs = spots.map((q) => ({ n: pick(q), q }));
    while (free.length) jobs.push({ n: pick(spots[0]), q: spots[0] });
    for (const { n, q } of jobs) {
      const i = k.base + n, p = m.players[i];
      const L = Math.hypot(gx - q.x, H / 2 - q.y) || 1, ux = (gx - q.x) / L, uy = (H / 2 - q.y) / L;
      const off = g.off * P.reach, wx = p.x + p.hx * off, wy = p.y + p.hy * off;
      const caught = Math.hypot(wx - q.x, wy - q.y) < g.r * P.reach;
      m.setStance(i, caught ? DRIBBLE : SHOT); // Shot while still coming: a bare well approaching from behind drags the ball back (own goals)
      if (caught) m.setOrder(i, ux * 3, uy * 3); // caught: carry it toward the goal at 3 m/s (6 lost it more often)
      else goTo(m, i, q.x - ux * off, q.y - uy * off, ux, uy); // get behind the spot, facing the goal
    }
  },

  idle(m, t) {
    for (let n = 0; n < TEAM_SIZE; n++) m.setOrder(t * TEAM_SIZE + n, 0, 0);
  },

  random(m, t, c, st) {
    const k = ctx(t);
    st.ticks = (st.ticks || 0) + 1; // drive() runs about 30 times a second
    st.until = st.until || [0, 0, 0, 0];
    for (let n = 0; n < TEAM_SIZE; n++) {
      if (st.ticks < st.until[n]) continue;
      st.until[n] = st.ticks + 15 + Math.random() * 45;
      const a = Math.random() * 2 * Math.PI, v = Math.random() * m.params.runSpeed;
      m.setStance(k.base + n, Math.floor(Math.random() * 4));
      m.setOrder(k.base + n, Math.cos(a) * v, Math.sin(a) * v);
    }
  },

  plow(m, t, c) {
    const k = ctx(t), stopX = W - k.own - k.d * 14;
    [0.12, 0.37, 0.63, 0.88].forEach((fy, n) => {
      const i = k.base + n, p = m.players[i];
      // advance at 5 m/s, faster if we have fallen behind the ball; hold at the stop line
      const behind = (c.x - k.d * 12 - p.x) * k.d, atStop = (stopX - p.x) * k.d <= 0;
      const vx = atStop ? 0 : k.d * clamp(5 + behind * 0.5, 0, 9);
      m.setStance(i, DEFENSE); m.setOrder(i, vx, (fy * H - p.y) * 2);
      if (!vx) m.face(i, k.d, 0);
    });
  },
};

// names: strategy for team 0 and team 1 (null = not driven by a bot).
function drive(m, names = ['turns', 'turns']) {
  const c = centroid(m);
  m.botState = m.botState || [{}, {}];
  names.forEach((name, t) => { if (name) STRATEGIES[name](m, t, c, m.botState[t]); });
}

module.exports = { drive, STRATEGIES };
