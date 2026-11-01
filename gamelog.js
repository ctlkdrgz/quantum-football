'use strict';
// Game log for post-mortems: one JSON Lines file per server run (logs/<Paris date-time>.jsonl). Every line has a kind `k`:
//   head  once: build, preset, params, controllers, pitch geometry, start time (ISO, UTC) - read it to know what the numbers mean
//   ev    an event: a command a client sent, a param / control / pause change, a phase change, a goal, a client joining or leaving
//   f     a frame, every server tick while the match steps: dt, phase, clock, score, goal probabilities, the ball's moments
//         and all eight players as [x, y, hx, hy, vx, vy, stance] (team 0 = players 0-3)
//   dens  the full ball density (W x H bytes, sqrt scale relative to the peak, base64, as on the wire) every densEvery seconds and at each goal
// `t` is seconds since the log started (server clock). Numbers are rounded to keep the file small (about 0.5 MB per minute of play).
const fs = require('fs');
const path = require('path');
const { W, H, N } = require('./sim');

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// The ball as numbers: mean position, standard deviations, x-y covariance, and the hottest cell (centre, density).
function ballMoments(rho) {
  let s = 0, mx = 0, my = 0, best = -1, peak = 0;
  for (let i = 0; i < N; i++) {
    const p = rho[i];
    s += p; mx += p * (i % W + 0.5); my += p * (Math.floor(i / W) + 0.5);
    if (p > peak) { peak = p; best = i; }
  }
  if (!(s > 0)) return null;
  mx /= s; my /= s;
  let vx = 0, vy = 0, cxy = 0;
  for (let i = 0; i < N; i++) { const dx = i % W + 0.5 - mx, dy = Math.floor(i / W) + 0.5 - my; vx += rho[i] * dx * dx; vy += rho[i] * dy * dy; cxy += rho[i] * dx * dy; }
  return { x: r2(mx), y: r2(my), sx: r2(Math.sqrt(vx / s)), sy: r2(Math.sqrt(vy / s)), cxy: r2(cxy / s), px: best % W + 0.5, py: Math.floor(best / W) + 0.5, peak: r4(peak) };
}

// File name from the Europe/Paris wall clock, without colons: 2026-11-01T14-03-02.jsonl (-2, -3... if taken).
function openFile(dir, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).replace(' ', 'T').replace(/:/g, '-');
  for (let n = 1; ; n++) {
    const file = path.join(dir, stamp + (n > 1 ? '-' + n : '') + '.jsonl');
    try { return { file, fd: fs.openSync(file, 'wx') }; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

class GameLog {
  constructor(dir, head, opts = {}) {
    ({ file: this.file, fd: this.fd } = openFile(dir));
    this.out = fs.createWriteStream(null, { fd: this.fd });
    this.t0 = Date.now();
    this.densEvery = opts.densEvery || 1;
    this.lastDens = -Infinity;
    this.prev = null; // phase and score of the last frame, to log their changes as events
    this.write({ k: 'head', start: new Date(this.t0).toISOString(), W, H, densEvery: this.densEvery, ...head });
  }
  now() { return r4((Date.now() - this.t0) / 1000); }
  write(obj) { if (this.out) this.out.write(JSON.stringify(obj) + '\n'); }
  event(e, data = {}) { this.write({ k: 'ev', t: this.now(), e, ...data }); }
  // Called after each match.step(dt) that changed something (not paused, not waiting for players).
  frame(match, dt) {
    const t = this.now(), rho = match.density();
    const st = { phase: match.phase, score: match.score.join('-') };
    if (this.prev && st.phase !== this.prev.phase) this.event('phase', { from: this.prev.phase, to: st.phase });
    const goal = this.prev && st.score !== this.prev.score && match.phase === 'goal';
    if (goal) this.event('goal', { scorer: match.lastScorer, score: match.score.slice(), goalP: match.goalP.map(r4) });
    this.prev = st;
    this.write({
      k: 'f', t, dt: r4(dt), phase: match.phase, timer: r2(match.timer), remaining: r2(match.remaining), score: match.score.slice(),
      goalP: match.goalP.map(r4), ball: ballMoments(rho),
      players: match.players.map((p) => [r2(p.x), r2(p.y), r2(p.hx), r2(p.hy), r2(p.vx), r2(p.vy), p.stance]),
    });
    if (goal || t - this.lastDens >= this.densEvery) { this.lastDens = t; this.write({ k: 'dens', t, d: Buffer.from(match.snapshot().dens).toString('base64') }); }
  }
  close() { // resolves once the file is flushed
    const out = this.out;
    if (!out) return Promise.resolve();
    this.event('end');
    this.out = null;
    return new Promise((resolve) => out.end(resolve));
  }
}

module.exports = { GameLog, ballMoments };
