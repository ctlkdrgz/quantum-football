'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Match, W, H, TEAM_SIZE, STANCE } = require('../sim');
const { drive, STRATEGIES } = require('../bots');
const { start, parseEnv } = require('../server');

function play(names, secs) {
  const m = new Match(); m.setPresent(0, true); m.setPresent(1, true); m.phase = 'playing';
  m.setParam('threshold', 0.9); // no goals: we only look at where the players go
  for (let k = 0; k < secs * 30; k++) { drive(m, names); m.step(1 / 30); }
  return m;
}
const team = (m, t) => m.players.slice(t * TEAM_SIZE, (t + 1) * TEAM_SIZE);

test('receiver: player 0 waits next to the opposing goal, on both sides', () => {
  const m = play(['receiver', 'receiver'], 15);
  assert.ok(Math.hypot(team(m, 0)[0].x - (W - 8), team(m, 0)[0].y - H / 2) < 3);
  assert.ok(Math.hypot(team(m, 1)[0].x - 8, team(m, 1)[0].y - H / 2) < 3);
  assert.equal(team(m, 0)[3].stance, STANCE.DEFENSE, 'player 3 guards our goal');
});

test('fortress: all four in defense stance around their own goal', () => {
  const m = play(['fortress', 'fortress'], 15);
  for (const p of team(m, 0)) { assert.equal(p.stance, STANCE.DEFENSE); assert.ok(p.x < 14, 'x ' + p.x); }
  for (const p of team(m, 1)) { assert.equal(p.stance, STANCE.DEFENSE); assert.ok(p.x > W - 14); }
});

test('shadow: two players stay between the two most advanced opponents and their goal', () => {
  const m = play(['shadow', 'fortress'], 20); // a steady opponent, so the marks have time to settle
  const foes = team(m, 1).map((p, n) => ({ x: p.x, y: p.y, n })).sort((a, b) => (Math.abs(a.x - b.x) > 1e-6 ? a.x - b.x : a.n - b.n)).slice(0, 2); // ties within a micrometre go by number, like the bot // team 1 attacks left: smallest x = most advanced
  const marks = team(m, 0).slice(0, 2);
  marks.forEach((p) => assert.equal(p.stance, STANCE.DEFENSE));
  for (const f of foes) assert.ok(marks.some((p) => Math.abs(p.x - (f.x - 3)) < 2 && Math.abs(p.y - f.y) < 2), 'foe at ' + f.x.toFixed(1) + ',' + f.y.toFixed(1));
  const mirror = play(['receiver', 'shadow'], 15); // same from the other side
  assert.equal(team(mirror, 1)[0].stance, STANCE.DEFENSE);
});

test('lanes: each player runs sideways inside its own quarter of the length', () => {
  const m = new Match(); m.setPresent(0, true); m.setPresent(1, true); m.phase = 'playing'; m.setParam('threshold', 0.9);
  const ys = [[], [], [], []];
  for (let k = 0; k < 30 * 30; k++) {
    drive(m, ['lanes', 'lanes']); m.step(1 / 30);
    if (k > 30 * 6) team(m, 0).forEach((p, n) => ys[n].push(p.y));
  }
  team(m, 0).forEach((p, n) => {
    assert.ok(Math.abs(p.x - (W / 8 + n * W / 4)) < 3, 'lane ' + n + ' x ' + p.x);
    assert.ok(Math.max(...ys[n]) - Math.min(...ys[n]) > 15, 'sweeps sideways');
  });
  assert.deepEqual(team(m, 0).map((p) => p.stance), [0, 0, 3, 3]); // own half defends, far half dribbles
  assert.deepEqual(team(m, 1).map((p) => p.stance), [0, 0, 3, 3]); // mirrored: player 0 starts nearest its own goal too
});

test('relay: a passer behind the ball and three stones spaced toward the goal', () => {
  const m = play(['relay', 'relay'], 10);
  const c = (q) => [q.x, q.y];
  for (const tm of [0, 1]) {
    const [pa, ...stones] = team(m, tm), d = tm === 0 ? 1 : -1;
    stones.forEach((s) => assert.equal(s.stance, STANCE.DRIBBLE));
    assert.ok(stones.every((s, n) => n === 0 || (s.x - stones[n - 1].x) * d > 3), 'stones ordered toward the goal ' + stones.map((s) => s.x.toFixed(0)));
    assert.ok((stones[0].x - pa.x) * d > 8, 'passer is behind the first stone');
    assert.ok(c(pa).every(Number.isFinite));
  }
});

test('plow: four walls advance abreast toward the goal and keep 12 m behind the ball', () => {
  const m = new Match(); m.setPresent(0, true); m.setPresent(1, true); m.phase = 'playing'; m.setParam('threshold', 0.9);
  const start = [team(m, 0)[0].x, team(m, 1)[0].x];
  for (let k = 0; k < 30 * 5; k++) { drive(m, ['plow', 'plow']); m.step(1 / 30); }
  assert.ok(team(m, 0)[0].x > start[0] + 5 && team(m, 1)[0].x < start[1] - 5, 'advancing');
  for (let k = 0; k < 30 * 30; k++) { drive(m, ['plow', 'plow']); m.step(1 / 30); }
  for (const tm of [0, 1]) {
    const xs = team(m, tm).map((p) => p.x);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 3, 'abreast ' + xs);
    team(m, tm).forEach((p) => assert.equal(p.stance, STANCE.DEFENSE));
  }
  assert.ok(team(m, 0)[0].y < 10 && team(m, 0)[3].y > 40, 'spread over the width');
  const mk = new Match(); mk.setPresent(0, true); mk.setPresent(1, true); mk.phase = 'playing';
  mk.players[0].x = 84; drive(mk, ['plow', null]); assert.equal(mk.players[0].vx, 0, 'holds at the stop line'); // 14 m from the goal
});

test('turns: a scripted match with the default settings runs without trouble and the wave stays valid', () => {
  const m = play(['turns', 'fortress'], 40);
  assert.ok(m.R.every(Number.isFinite));
  assert.deepEqual(Object.keys(STRATEGIES).sort(), ['fortress', 'lanes', 'plow', 'random', 'receiver', 'relay', 'shadow', 'turns']);
  drive(m); // default: turns vs turns
  drive(m, [null, 'lanes']); // a null team is left alone
});

test('BOTS / DEMO environment parsing', () => {
  assert.deepEqual(parseEnv({ BOTS: 'receiver,-' }), { bots: ['receiver', null], preset: 'default', params: {} });
  assert.deepEqual(parseEnv({ BOTS: 'lanes,shadow' }), { bots: ['lanes', 'shadow'], preset: 'default', params: {} });
  assert.deepEqual(parseEnv({ DEMO: '1' }), { bots: ['turns', 'turns'], preset: 'default', params: {} });
  assert.deepEqual(parseEnv({}), { bots: ['random', 'random'], preset: 'default', params: {} });
  assert.deepEqual(parseEnv({ PARAMS: '{"kick":0.5}' }).params, { kick: 0.5 });
  assert.deepEqual(parseEnv({ PRESET: 'additive', PARAMS: '{"kick":1}' }).params, { additive: 1, kick: 1 });
  assert.equal(parseEnv({ PRESET: 'waves' }).preset, 'waves'); assert.equal(parseEnv({ PRESET: 'waves', PARAMS: '{}' }).preset, 'waves+');
  assert.throws(() => parseEnv({ PRESET: 'nope' }), /unknown preset/);
  assert.throws(() => parseEnv({ BOTS: 'nope,-' }), /unknown bot nope/);
});

test('random: orders change over time and stay valid', () => {
  const m = play(['random', 'random'], 10);
  assert.ok(m.R.every(Number.isFinite));
  assert.ok(m.players.some((p) => p.vx || p.vy));
});

test('a human plays the free team against a bot; both-bot matches take no players', async () => {
  const open = (port) => new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:' + port + '/ws'); const c = { ws, hello: null, last: null };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'hello') c.hello = m; if (m.t === 'state') c.last = m; };
    ws.onopen = () => resolve(c);
  });
  const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 30)); assert.ok(f()); };
  const s1 = await start(0, { bots: ['fortress', null] });
  const h = await open(s1.address().port);
  await until(() => h.hello && h.last);
  assert.equal(h.hello.slot, 1, 'the human gets the team the bot does not run');
  await until(() => h.last.phase === 'countdown'); // match starts at once: the bot team is already present
  h.ws.close(); s1.close(); s1.closeAllConnections();
  const s2 = await start(0, { bots: ['lanes', 'shadow'], preset: 'default', params: {} });
  const w = await open(s2.address().port);
  await until(() => w.hello);
  assert.equal(w.hello.slot, -1);
  await until(() => w.last && w.last.phase === 'playing' && w.last.params === undefined);
  w.ws.close(); s2.close(); s2.closeAllConnections();
});

test('symmetry [asymmetry fix]: every strategy except turns plays as an exact mirror image of itself', () => {
  const err = (m) => { const D = m.density(); let e = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) e = Math.max(e, Math.abs(D[y * W + x] - D[y * W + (W - 1 - x)])); return e; };
  for (const s of Object.keys(STRATEGIES).filter((n) => n !== 'turns' && n !== 'random')) { // turns: someone has to attack first; random: random, by design
    const m = new Match(); m.setPresent(0, true); m.setPresent(1, true); m.phase = 'playing'; m.setParam('threshold', 0.9);
    let worst = 0;
    for (let k = 0; k < 30 * 20; k++) { drive(m, [s, s]); m.step(1 / 30); worst = Math.max(worst, err(m)); }
    assert.ok(worst < 1e-9, s + ' ' + worst);
  }
});

