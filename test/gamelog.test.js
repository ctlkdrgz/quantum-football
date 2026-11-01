'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Match, W, H, N } = require('../sim');
const { GameLog, ballMoments } = require('../gamelog');
const { load, summary, csv, at } = require('../tools/postmortem');
const { start } = require('../server');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qf-log-'));

test('ball moments: a single hot cell, and a two-cell ball', () => {
  const rho = new Float64Array(N);
  rho[10 * W + 20] = 1;
  assert.deepEqual(ballMoments(rho), { x: 20.5, y: 10.5, sx: 0, sy: 0, cxy: 0, px: 20.5, py: 10.5, peak: 1 });
  rho[10 * W + 22] = 1;
  const b = ballMoments(rho);
  assert.deepEqual([b.x, b.y, b.sx, b.sy], [21.5, 10.5, 1, 0]);
  assert.equal(ballMoments(new Float64Array(N)), null, 'no ball: null, not NaN');
});

test('a match logs a header, frames with all eight players, a goal event and a density record at the goal', async () => {
  const dir = tmp(), m = new Match();
  m.setPresent(0, true); m.setPresent(1, true);
  const log = new GameLog(dir, { preset: 'test', params: { ...m.params }, bots: ['idle', 'idle'] }, { densEvery: 1e9 });
  const tick = () => { m.step(1 / 30); log.frame(m, 1 / 30); };
  for (let k = 0; k < 4 * 30; k++) tick(); // the countdown, then 1 s of play
  Object.assign(m, { phase: 'goal', lastScorer: 0, timer: 2.5 }); m.score[0]++; // what checkGoals does (the physics takes too long to score)
  for (let k = 0; k < 10; k++) tick();
  await log.close();
  const L = load(log.file);
  assert.equal(path.dirname(log.file), dir);
  assert.equal(L.head.preset, 'test');
  assert.deepEqual([L.head.W, L.head.H], [W, H]);
  assert.ok(L.f.length > 10);
  assert.equal(L.f[0].players.length, 8);
  assert.equal(L.f[0].players[0].length, 7, 'x y hx hy vx vy stance');
  const goal = L.ev.find((e) => e.e === 'goal');
  assert.ok(goal, 'the goal is an event');
  assert.ok(L.ev.some((e) => e.e === 'phase' && e.from === 'countdown' && e.to === 'playing'));
  assert.equal(L.dens.length, 2, 'the first frame and the goal (densEvery is huge)');
  assert.equal(Buffer.from(L.dens[1].d, 'base64').length, N);
  assert.equal(L.ev[L.ev.length - 1].e, 'end');
  assert.match(summary(L), /goal/);
  assert.equal(csv(L).split('\n').length, L.f.length + 1);
  assert.equal(at(L, goal.t).split('\n').length, 1 + 2 + H / 2);
});

test('the server logs joins and commands, and closes the log with the server', async () => {
  const dir = tmp();
  const s = await start(0, { host: '127.0.0.1', graceMs: 50, bots: [null, 'idle'], paused: false, logDir: dir });
  const ws = new WebSocket('ws://127.0.0.1:' + s.address().port + '/ws');
  let states = 0;
  ws.onmessage = (e) => { if (JSON.parse(e.data).t === 'state') states++; };
  await new Promise((r) => { ws.onopen = r; });
  ws.send(JSON.stringify({ t: 'stance', p: 1, s: 3 }));
  ws.send(JSON.stringify({ t: 'order', p: 9, vx: 1, vy: 0 })); // not one of ours: not logged
  for (let i = 0; i < 100 && states < 10; i++) await new Promise((r) => setTimeout(r, 30));
  ws.close();
  s.close(); s.closeAllConnections();
  await s.gameLog.close();
  const L = load(s.gameLog.file);
  assert.deepEqual(L.head.bots, [null, 'idle']);
  assert.ok(L.ev.some((e) => e.e === 'join' && e.name === 'Client 1' && e.slot === 0));
  assert.deepEqual(L.ev.filter((e) => e.e === 'stance' || e.e === 'order').map((e) => [e.e, e.i, e.s]), [['stance', 1, 3]]);
  assert.ok(L.f.length > 0, 'frames while the match runs');
});
