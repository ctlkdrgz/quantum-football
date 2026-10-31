'use strict';
// Dummy AIs for demos: no learning, just "get behind the ball and pass it toward the goal; defend when it is on my side".
const { W, H, N } = require('./sim');

function centroid(m) {
  let sx = 0, sy = 0;
  for (let i = 0; i < N; i++) { const p = m.R[i] * m.R[i] + m.I[i] * m.I[i]; sx += ((i % W) + 0.5) * p; sy += (Math.floor(i / W) + 0.5) * p; }
  return { x: sx, y: sy };
}

function drive(m) {
  const c = centroid(m);
  const turn = Math.floor(m.remaining / 12) % 2; // the bots take turns attacking: dummy, but it avoids a stalemate
  [0, 1].forEach((i) => {
    const d = i === 0 ? 1 : -1, p = m.players[i];
    if (turn !== i) { // other bot: wall near its own goal, facing the ball
      m.setStance(i, 1); m.setTarget(i, i === 0 ? 18 : W - 18, c.y); return;
    }
    const behind = c.x - d * 5;
    if (Math.abs(p.x - behind) > 5 || Math.abs(p.y - c.y) > 6) { m.setStance(i, 0); m.setTarget(i, behind, c.y); return; }
    m.setStance(i, p.stamina > 0.15 ? 2 : 0);
    m.setTarget(i, behind + d * 0.8, c.y); // stand just behind the ball, facing downfield, and kick
  });
}

module.exports = { drive };
