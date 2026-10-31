'use strict';
// Dummy AIs for demos: no learning. The two teams take turns attacking; the other team defends its goal.
// Attackers: players 0 and 1 stand behind the ball, face downfield and pass. Players 2 and 3 idle in attack stance.
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

function drive(m) {
  const c = centroid(m);
  const turn = Math.floor(m.remaining / 12) % 2;
  for (let t = 0; t < 2; t++) {
    const d = t === 0 ? 1 : -1, base = t * TEAM_SIZE;
    if (turn !== t) { // defend: a wall line in front of my goal, facing the ball
      [0.3, 0.43, 0.57, 0.7].forEach((fy, k) => {
        m.setStance(base + k, 1);
        goTo(m, base + k, t === 0 ? 18 : W - 18, fy * H, c.x - (t === 0 ? 18 : W - 18), 0);
      });
      continue;
    }
    [0, 1].forEach((k) => {
      const i = base + k, p = m.players[i];
      const behind = c.x - d * 5, offY = c.y + (k === 0 ? -2 : 2);
      const there = Math.abs(p.x - behind) < 3 && Math.abs(p.y - offY) < 3;
      m.setStance(i, there ? 2 : 0);
      goTo(m, i, behind, offY, d, 0);
    });
    [2, 3].forEach((k) => { m.setStance(base + k, 0); goTo(m, base + k, c.x - d * 12, c.y + (k === 2 ? -8 : 8), d, 0); });
  }
}

module.exports = { drive };
