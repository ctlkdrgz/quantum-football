'use strict';
// Dummy AIs: no learning, each is a fixed strategy for one team of four (players 0-3 within the team).
//   turns     alternate with the other team: attack for 12 s (two passers behind the ball), then defend in a wall line
//   receiver  player 0 waits next to the opposing goal as a target man; players 1-2 pass to him; player 3 guards our goal
//   fortress  all four players in defense stance around our own goal, facing the ball, to deflect everything
//   shadow    two players mark the two most advanced opponents; the other two attack with passes
//   lanes     the four players run sideways, each in its own quarter of the pitch length (two defend, two attack)
//   relay     a bucket brigade: player 0 passes from behind the ball, players 1-3 stand as stepping stones on the way to the goal, in attack stance
//   plow      the four players form a wall line (defense stance) and advance together, pushing the wave in front of them toward the goal
const { W, H, N, TEAM_SIZE } = require('./sim');

function centroid(m) {
  let sx = 0, sy = 0;
  for (let i = 0; i < N; i++) { const p = m.R[i] * m.R[i] + m.I[i] * m.I[i]; sx += ((i % W) + 0.5) * p; sy += (Math.floor(i / W) + 0.5) * p; }
  return { x: sx, y: sy };
}

function goTo(m, i, tx, ty, fx, fy) { // proportional control toward a spot, then face (fx, fy)
  const p = m.players[i];
  m.setOrder(i, (tx - p.x) * 2, (ty - p.y) * 2);
  if (Math.hypot(tx - p.x, ty - p.y) < 1) m.face(i, fx, fy);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Team context: d = direction of attack (+1 right), own = x of our goal line, base = index of our player 0.
const ctx = (t) => ({ t, d: t === 0 ? 1 : -1, own: t === 0 ? 0 : W, base: t * TEAM_SIZE });

// Two passers stand behind the ball on the line toward (gx, gy), at +-2 m sideways, and kick.
function passers(m, k, ks, c, gx, gy) {
  const L = Math.hypot(gx - c.x, gy - c.y) || 1, ux = (gx - c.x) / L, uy = (gy - c.y) / L;
  ks.forEach((idx, n) => {
    const i = k.base + idx, p = m.players[i];
    const tx = c.x - ux * 5 - uy * (n ? 2 : -2), ty = c.y - uy * 5 + ux * (n ? 2 : -2);
    const there = Math.hypot(p.x - tx, p.y - ty) < 3;
    m.setStance(i, there ? 2 : 0);
    goTo(m, i, tx, ty, ux, uy);
  });
}

function wallLine(m, k, c, depth) { // four defenders in a line in front of our goal, facing the ball
  [0.3, 0.43, 0.57, 0.7].forEach((fy, n) => {
    const i = k.base + n, x = k.own + k.d * depth;
    m.setStance(i, 1);
    goTo(m, i, x, fy * H, c.x - x, c.y - fy * H);
  });
}

const STRATEGIES = {
  turns(m, t, c) {
    const k = ctx(t);
    if (Math.floor(m.remaining / 12) % 2 !== t) { wallLine(m, k, c, 18); return; }
    passers(m, k, [0, 1], c, W - k.own, H / 2);
    [2, 3].forEach((n) => { m.setStance(k.base + n, 0); goTo(m, k.base + n, c.x - k.d * 12, c.y + (n === 2 ? -8 : 8), k.d, 0); });
  },

  receiver(m, t, c) {
    const k = ctx(t), goalX = W - k.own;
    const rx = goalX - k.d * 8, ry = H / 2; // the target man, next to the opposing goal, facing the ball
    m.setStance(k.base, 0); goTo(m, k.base, rx, ry, c.x - rx, c.y - ry);
    passers(m, k, [1, 2], c, rx, ry);
    const g = k.base + 3, gx = k.own + k.d * 10;
    m.setStance(g, 1); goTo(m, g, gx, H / 2, c.x - gx, c.y - H / 2);
  },

  fortress(m, t, c) {
    const k = ctx(t);
    [-9, -3, 3, 9].forEach((dy, n) => {
      const i = k.base + n, x = k.own + k.d * 10, y = clamp(H / 2 + dy + (c.y - H / 2) * 0.3, 3, H - 3);
      m.setStance(i, 1); goTo(m, i, x, y, c.x - x, c.y - y);
    });
  },

  shadow(m, t, c) {
    const k = ctx(t), foe = (1 - t) * TEAM_SIZE;
    // the most advanced opponents are those closest to our goal line
    const adv = [0, 1, 2, 3].map((n) => m.players[foe + n]).sort((a, b) => Math.abs(a.x - k.own) - Math.abs(b.x - k.own)).slice(0, 2);
    adv.forEach((o, n) => { // stand between the opponent and our goal, wall facing him
      const i = k.base + n, x = o.x - k.d * 3;
      m.setStance(i, 1); goTo(m, i, x, o.y, o.x - x, 0);
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
      m.setStance(i, ownHalf ? 1 : 0);
      if (Math.abs(p.x - cx) > 2) { m.setOrder(i, (cx - p.x) * 2, 0); continue; } // first get into the lane
      if (p.y < 5) st.dir[n] = 1; else if (p.y > H - 5) st.dir[n] = -1;
      m.setOrder(i, 0, st.dir[n] * Math.min(8, m.params.runSpeed)); // sideways only
    }
  },

  relay(m, t, c) {
    const k = ctx(t), gx = W - k.own;
    const L = Math.hypot(gx - c.x, H / 2 - c.y) || 1, ux = (gx - c.x) / L, uy = (H / 2 - c.y) / L;
    const p = m.players[k.base], tx = c.x - ux * 5, ty = c.y - uy * 5;
    m.setStance(k.base, Math.hypot(p.x - tx, p.y - ty) < 3 ? 2 : 0); goTo(m, k.base, tx, ty, ux, uy);
    [1, 2, 3].forEach((n) => { // stones every 12 m toward the goal; they never go past 8 m from the goal line
      const i = k.base + n, d = Math.min(12 * n, Math.max(0, L - 8));
      m.setStance(i, 0); goTo(m, i, c.x + ux * d, c.y + uy * d, ux, uy);
    });
  },

  plow(m, t, c) {
    const k = ctx(t), stopX = W - k.own - k.d * 14;
    [0.12, 0.37, 0.63, 0.88].forEach((fy, n) => {
      const i = k.base + n, p = m.players[i];
      // advance at 5 m/s, faster if we have fallen behind the ball; hold at the stop line
      const behind = (c.x - k.d * 12 - p.x) * k.d, atStop = (stopX - p.x) * k.d <= 0;
      const vx = atStop ? 0 : k.d * clamp(5 + behind * 0.5, 0, 9);
      m.setStance(i, 1); m.setOrder(i, vx, (fy * H - p.y) * 2);
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
