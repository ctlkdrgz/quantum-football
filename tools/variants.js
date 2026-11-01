'use strict';
// Compares the parameter presets (sim.js PRESETS): node tools/variants.js [preset ...]
// 1. bot pool: six pairings, 120 s each: goals, waves across the pitch (median), characteristic length, time with L in 35-65 m
// 2. what a human can do: a standing pass and a carry compared with no actor, and how many bot styles can score (unopposed / against the fortress bot)
const { Match, PRESETS, STANCE, W } = require('../sim');
const bots = require('../bots');

const PAIRS = [['turns', 'receiver'], ['shadow', 'plow'], ['fortress', 'relay'], ['lanes', 'turns'], ['plow', 'plow'], ['relay', 'shadow']];
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function fresh(preset) {
  const m = new Match();
  for (const [k, v] of Object.entries(PRESETS[preset])) m.setParam(k, v);
  m.setPresent(0, true); m.setPresent(1, true);
  m.kickoff(); m.phase = 'playing';
  return m;
}

function pool(preset) {
  let goals = 0; const ns = [], ls = [];
  for (const pair of PAIRS) {
    const m = fresh(preset);
    for (let k = 0; k < 30 * 120; k++) {
      bots.drive(m, pair); m.step(1 / 30);
      if (k % 15 === 0 && m.phase === 'playing') { ns.push(m.wavesAcrossWidth()); ls.push(m.characteristicLength()); }
    }
    goals += m.score[0] + m.score[1];
  }
  return { goals: goals / PAIRS.length, waves: median(ns), L: mean(ls), Lband: ls.filter((l) => l >= 35 && l <= 65).length / ls.length };
}

function centroidX(m) { const D = m.density(); let s = 0; for (let i = 0; i < D.length; i++) s += ((i % W) + 0.5) * D[i]; return s; }

// script(m, t) sets orders/stances on the human-controlled team (players 0-3). Others sit in the corners.
function experiment(preset, script, secs, measure) {
  const run = (withActor) => {
    const m = fresh(preset); m.setParam('threshold', 0.9);
    for (let i = 0; i < 8; i++) { m.players[i].x = i < 4 ? 2 : W - 2; m.players[i].y = 2 + 12 * (i % 4); m.setStance(i, STANCE.DEFENSE); m.face(i, i < 4 ? -1 : 1, 0); }
    let peak = 0;
    for (let k = 0; k < 30 * secs; k++) {
      if (withActor) script(m, k / 30);
      m.step(1 / 30);
      peak = Math.max(peak, m.goalP[1]);
    }
    return { cx: centroidX(m), peak, m };
  };
  const a = run(true), b = run(false);
  return measure(a, b);
}

const stand = (m, i, x, y) => { Object.assign(m.players[i], { x, y, vx: 0, vy: 0, hx: 1, hy: 0 }); };
function options(preset) {
  const out = {};
  out.pass = experiment(preset, (m, t) => { if (t < 0.05) stand(m, 0, 40, 25); m.setStance(0, t < 3 ? STANCE.PASS : STANCE.DEFENSE); }, 30,
    (a, b) => ({ shift: a.cx - b.cx, peak: a.peak }));
  out.carry = experiment(preset, (m, t) => { m.setStance(0, STANCE.DRIBBLE); if (t < 0.05) stand(m, 0, 38, 25); m.setOrder(0, t < 10 ? 6 : 0, 0); }, 14,
    (a, b) => ({ shift: a.cx - b.cx, peak: a.peak }));
  // viability of each style: goals for team 0 in 90 s against a parked opponent, and against the fortress bot
  const attackers = ['turns', 'receiver', 'shadow', 'relay', 'plow', 'lanes'];
  out.strategies = {};
  for (const a of attackers) {
    const score = (opp) => {
      const m = fresh(preset);
      if (!opp) for (let i = 4; i < 8; i++) { m.players[i].x = W - 2; m.players[i].y = 2 + 12 * (i - 4); m.setStance(i, STANCE.DEFENSE); m.face(i, 1, 0); }
      for (let k = 0; k < 30 * 90; k++) { bots.drive(m, [a, opp]); m.step(1 / 30); }
      return m.score[0];
    };
    out.strategies[a] = { unopposed: score(null), vsFortress: score('fortress') };
  }
  return out;
}

if (require.main === module) {
  for (const preset of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(PRESETS)) {
    console.log(preset, JSON.stringify({ pool: pool(preset), options: options(preset) }, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
  }
}
module.exports = { pool, options };
